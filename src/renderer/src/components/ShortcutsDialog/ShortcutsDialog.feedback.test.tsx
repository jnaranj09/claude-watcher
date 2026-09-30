// Action feedback (spec 2026-09-29 §2.5) — Shortcuts Save and Delete are busy while main answers:
// a double Enter used to save twice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred, type Deferred } from '../../test/deferred'
import { ShortcutsDialog } from './ShortcutsDialog'
import { shortcutsStore } from '../../stores/shortcutsStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { settingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../../shared/schemas/settings'
import { DEFAULT_WORKSPACE_ID } from '../../../../shared/schemas/workspace'

const A = {
  id: 'sc-1',
  name: 'approve',
  alias: 'ap',
  text: 'I explicitly approve',
  workspaceId: null
}

let pending: Deferred<unknown>
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
let r: RenderResult | undefined

beforeEach(() => {
  pending = deferred<unknown>()
  save = vi.fn(() => pending.promise)
  remove = vi.fn(() => pending.promise)
  ;(window as unknown as { shortcuts: unknown }).shortcuts = { list: vi.fn(), save, remove }
  act(() => {
    shortcutsStore.setState({ shortcuts: [A], loaded: true })
    settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS })
    workspacesStore.setState({ activeId: DEFAULT_WORKSPACE_ID, workspaces: [], loaded: true })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  act(() => shortcutsStore.getState().hydrate([]))
  vi.restoreAllMocks()
})

function el<T extends Element = HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`[data-testid="${id}"]`)
  if (found === null) throw new Error(`missing ${id}`)
  return found
}

function type(id: string, value: string): void {
  const input = el<HTMLInputElement>(id)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ShortcutsDialog — busy Save and Delete', () => {
  it('Save is busy while main saves; a second Enter saves nothing', async () => {
    r = renderComponent(<ShortcutsDialog onClose={() => {}} />)
    act(() => el('shortcut-new').click())
    type('shortcut-name-input', 'hello')
    type('shortcut-alias-input', 'hi')
    type('shortcut-text-input', 'Hello there')
    const submit = (): void =>
      act(() => {
        el('shortcut-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    submit()
    expect(el('shortcut-save').getAttribute('aria-busy')).toBe('true')
    submit()
    expect(save).toHaveBeenCalledTimes(1)
    pending.resolve({ saved: { ...A, id: 'sc-2', name: 'hello', alias: 'hi' }, shortcuts: [A] })
    await settle()
  })

  it('Delete is busy while main deletes; a second confirm deletes nothing', async () => {
    r = renderComponent(<ShortcutsDialog onClose={() => {}} />)
    act(() => el('shortcut-select-sc-1').click())
    act(() => el<HTMLButtonElement>('shortcut-delete').click()) // arm
    act(() => el<HTMLButtonElement>('shortcut-delete').click()) // confirm
    expect(el('shortcut-delete').getAttribute('aria-busy')).toBe('true')
    act(() => el<HTMLButtonElement>('shortcut-delete').click())
    expect(remove).toHaveBeenCalledTimes(1)
    pending.resolve([])
    await settle()
  })
})
