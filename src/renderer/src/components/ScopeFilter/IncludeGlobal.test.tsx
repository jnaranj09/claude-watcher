// Include global (spec 2026-10-03 H): ONE remembered choice, read and written by every list that
// offers it; hidden where it would do nothing; a refused write puts it back and says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { flush, renderComponent, type RenderResult } from '../../test/renderComponent'
import { stubSettings } from '../../test/settingsBridge'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import { settingsStore } from '../../stores/settingsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { templatesStore } from '../../stores/templatesStore'
import { ShortcutsDialog } from '../ShortcutsDialog/ShortcutsDialog'
import { SessionsDialog } from '../SessionsDialog/SessionsDialog'
import { chooseOption } from '../../test/selectHarness'
import type { Workspace } from '../../../../shared/ipc/contract'

const WS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: null }
]
let cleanup: (() => void) | undefined
beforeEach(() => {
  act(() => {
    settingsStore.getState().hydrate(DEFAULT_SETTINGS)
    workspacesStore.setState({ workspaces: WS, activeId: 'w1', loaded: true })
    shortcutsStore.setState({ shortcuts: [], loaded: true, loadFailed: false })
    templatesStore.setState({ templates: [], loaded: true, loadFailed: false })
  })
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})
const box = (r: RenderResult, id: string): HTMLInputElement | null =>
  r.container.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)

describe('Include global', () => {
  it('shows beside a WORKSPACE scope, checked by default; never in All / Global', () => {
    stubSettings()
    const r = renderComponent(<ShortcutsDialog onClose={() => {}} />)
    cleanup = r.unmount
    expect(box(r, 'shortcut-include-global')?.checked).toBe(true)
    expect(box(r, 'shortcut-include-global')?.closest('label')?.textContent).toBe('Include global')
    chooseOption(r.container, 'shortcut-scope-filter', 'all')
    expect(box(r, 'shortcut-include-global')).toBeNull()
    chooseOption(r.container, 'shortcut-scope-filter', 'global')
    expect(box(r, 'shortcut-include-global')).toBeNull()
  })

  it('one choice for every list: unchecked in Shortcuts, it opens unchecked in Templates', async () => {
    const { setCalls } = stubSettings()
    const first = renderComponent(<ShortcutsDialog onClose={() => {}} />)
    act(() => box(first, 'shortcut-include-global')?.click())
    await flush(4)
    expect(setCalls).toEqual([{ includeGlobal: false }])
    first.unmount()
    const second = renderComponent(
      <SessionsDialog page="templates" onPageChange={() => {}} onClose={() => {}} />
    )
    cleanup = second.unmount
    expect(box(second, 'template-include-global')?.checked).toBe(false)
  })

  it('a refused write puts the box back and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubSettings(() => Promise.reject(new Error('store_write_failed')))
    const r = renderComponent(<ShortcutsDialog onClose={() => {}} />)
    cleanup = r.unmount
    act(() => box(r, 'shortcut-include-global')?.click())
    await flush(4)
    expect(box(r, 'shortcut-include-global')?.checked).toBe(true)
    expect(r.container.querySelector('[data-testid="shortcuts-error"]')?.textContent).toBe(
      'Could not save the Include global choice.'
    )
  })
})
