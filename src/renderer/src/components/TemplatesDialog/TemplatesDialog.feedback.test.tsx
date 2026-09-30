// Action feedback (spec 2026-09-29 §2.5) — Templates Browse… is busy while the native picker is
// open, and a picker that fails says so on the form's error line (it was a console line).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred, type Deferred } from '../../test/deferred'
import { TemplatesDialog } from './TemplatesDialog'
import { templatesStore } from '../../stores/templatesStore'
import { workspacesStore } from '../../stores/workspacesStore'

let r: RenderResult | undefined
let pick: ReturnType<typeof vi.fn>
let pending: Deferred<string | null>

beforeEach(() => {
  pending = deferred<string | null>()
  pick = vi.fn(() => pending.promise)
  ;(window as unknown as { launch: unknown }).launch = { pickDirectory: pick }
  act(() => {
    templatesStore.getState().hydrate([])
    workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: true })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  vi.restoreAllMocks()
})

function el<T extends Element = HTMLElement>(id: string): T {
  const found = r?.container.querySelector<T>(`[data-testid="${id}"]`)
  if (found === null || found === undefined) throw new Error(`missing ${id}`)
  return found
}

describe('TemplatesDialog — Browse…', () => {
  it('is busy while the picker is open, and a failed picker says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    r = renderComponent(<TemplatesDialog onClose={() => {}} />)
    act(() => el('template-new').click())
    act(() => el('template-browse').click())
    expect(el('template-browse').getAttribute('aria-busy')).toBe('true')
    act(() => el('template-browse').click())
    expect(pick).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('dbus'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(el('template-error').textContent).toBe('Could not open the folder picker.')
  })
})
