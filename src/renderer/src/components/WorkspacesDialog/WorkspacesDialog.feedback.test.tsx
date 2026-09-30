// Action feedback (spec 2026-09-29 §2.5) — Workspaces Save is greyed on an unchanged row, and
// Choose… is busy while the native picker is open; a picker that fails says so on the error line.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { deferred, type Deferred } from '../../test/deferred'
import { WorkspacesDialog } from './WorkspacesDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Workspace } from '../../../../shared/ipc/contract'

const ROWS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: '/home/j/ops' }
]

let r: RenderResult | undefined
let pick: ReturnType<typeof vi.fn>
let pending: Deferred<string | null>

beforeEach(() => {
  pending = deferred<string | null>()
  pick = vi.fn(() => pending.promise)
  ;(window as unknown as { launch: unknown }).launch = { pickDirectory: pick }
  ;(window as unknown as { workspaces: unknown }).workspaces = { save: vi.fn(), remove: vi.fn() }
  act(() => workspacesStore.setState({ workspaces: ROWS, activeId: 'default', loaded: true }))
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

describe('WorkspacesDialog — feedback', () => {
  it('Save stays greyed on an unchanged row and wakes on an edit', () => {
    r = renderComponent(<WorkspacesDialog onClose={() => {}} />)
    act(() => el('workspace-select-w1').click())
    expect(el<HTMLButtonElement>('workspace-submit').disabled).toBe(true)
    act(() => el('workspace-color-rose').click())
    expect(el<HTMLButtonElement>('workspace-submit').disabled).toBe(false)
  })

  it('Choose… is busy while the picker is open; a failed picker says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    r = renderComponent(<WorkspacesDialog onClose={() => {}} />)
    act(() => el('workspace-select-w1').click())
    act(() => el('workspace-browse').click())
    expect(el('workspace-browse').getAttribute('aria-busy')).toBe('true')
    act(() => el('workspace-browse').click())
    expect(pick).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.reject(new Error('dbus'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(el('workspace-error').textContent).toBe('Could not open the folder picker.')
  })
})
