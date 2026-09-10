// Workspaces — the Manage-workspaces dialog. Harness: this repo does NOT have
// @testing-library/react (declined, Story 1.3) — render via `renderComponent`
// (react-dom/client + React's `act`) and query with `container.querySelector`, mirroring
// TemplatesDialog.test.tsx (the closest sibling: q<T>(r, sel) helper, afterEach unmount
// discipline, the act()-wrapped async-settling `flush()` idiom in place of `waitFor`).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { WorkspacesDialog } from './WorkspacesDialog'
import { workspacesStore } from '../../stores/workspacesStore'
import type { Workspace, WorkspaceSaveRequest } from '../../../../shared/ipc/contract'

const ROWS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: '/home/j/ops' }
]

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
// The two list bridges `loadTemplates`/`loadShortcuts` call — stubbed so the re-read after a
// committed delete is observable end-to-end (the real store functions run; only IPC is faked).
let templatesList: ReturnType<typeof vi.fn>
let shortcutsList: ReturnType<typeof vi.fn>

beforeEach(() => {
  save = vi.fn((req: WorkspaceSaveRequest) => {
    const saved: Workspace = {
      id: req.id ?? 'new',
      name: req.name,
      color: req.color,
      defaultCwd: req.defaultCwd
    }
    return Promise.resolve({ saved, activeId: 'default', workspaces: [...ROWS, saved] })
  })
  remove = vi.fn(() => Promise.resolve({ activeId: 'default', workspaces: [ROWS[0]] }))
  templatesList = vi.fn(() => Promise.resolve([]))
  shortcutsList = vi.fn(() => Promise.resolve([]))
  ;(window as unknown as { workspaces: unknown }).workspaces = { save, remove }
  ;(window as unknown as { templates: unknown }).templates = { list: templatesList }
  ;(window as unknown as { shortcuts: unknown }).shortcuts = { list: shortcutsList }
  act(() => workspacesStore.setState({ workspaces: ROWS, activeId: 'default', loaded: true }))
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  act(() => workspacesStore.setState({ workspaces: [], activeId: 'default', loaded: false }))
  vi.restoreAllMocks()
})

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(): { r: RenderResult; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const r = renderComponent(<WorkspacesDialog onClose={onClose} />)
  cleanup = r.unmount
  return { r, onClose }
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function type(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const click = (el: Element): void => act(() => (el as HTMLElement).click())

describe('WorkspacesDialog', () => {
  // Real assertion: the two seeded rows each render their own testid'd item AND carry their
  // own name text — a stub that rendered one shared list node, or swapped the names, would
  // fail this just as surely as rendering nothing.
  it('lists every workspace', () => {
    const { r } = render()
    expect(q(r, '[data-testid="workspace-item-default"]').textContent).toContain('Default')
    expect(q(r, '[data-testid="workspace-item-w1"]').textContent).toContain('Ops')
  })

  it('creates a workspace from the form', async () => {
    const { r } = render()
    click(q(r, '[data-testid="workspace-new"]'))
    type(q(r, '[data-testid="workspace-name-input"]'), 'Side')
    click(q(r, '[data-testid="workspace-submit"]'))
    await flush()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Side' }))
  })

  // Rejects with the WRAPPED shape Electron actually delivers — `Error invoking remote method
  // '…': Error: <code>` — not the bare code. A bare code makes an exact-key lookup pass in
  // jsdom while production always falls through to the generic sentence, so the wrapped shape
  // is what makes this test able to fail at all.
  it('shows the operator-facing copy when a delete is blocked by live sessions', async () => {
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'workspaces:delete': Error: workspace_has_sessions")
    )
    const { r } = render()
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(
      /still has running sessions/i
    )
  })

  // Wrapped shape, same reasoning as the delete case above.
  it('shows the name-taken copy on a duplicate', async () => {
    save.mockRejectedValueOnce(
      new Error("Error invoking remote method 'workspaces:save': Error: workspace_name_taken")
    )
    const { r } = render()
    click(q(r, '[data-testid="workspace-new"]'))
    type(q(r, '[data-testid="workspace-name-input"]'), 'Ops')
    click(q(r, '[data-testid="workspace-submit"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(/already/i)
  })

  // Deleting a workspace CASCADES its scoped templates and shortcuts in main; the renderer's
  // two projections only load at startup, so without an explicit re-read they keep showing the
  // deleted rows (filed under `(no workspace)`, where saving one throws template_not_found).
  //
  // Non-vacuous: both spies start at zero call count and the seeded delete is the only thing in
  // the test that could reach them — dropping the `Promise.all([loadTemplates(), loadShortcuts()])`
  // line leaves both at 0 and turns both assertions red.
  it('re-reads templates and shortcuts after a committed delete', async () => {
    const { r } = render()
    expect(templatesList).not.toHaveBeenCalled()
    expect(shortcutsList).not.toHaveBeenCalled()
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(remove).toHaveBeenCalledWith('w1')
    expect(templatesList).toHaveBeenCalledTimes(1)
    expect(shortcutsList).toHaveBeenCalledTimes(1)
  })

  // The other half of the same rule: a REFUSED delete cascaded nothing in main, so re-reading
  // would be pointless work. This pins the re-read to the success path — moving the two loads
  // out of the try (or into a finally) turns this red while the test above stays green.
  it('does NOT re-read templates and shortcuts when the delete was refused', async () => {
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'workspaces:delete': Error: workspace_has_sessions")
    )
    const { r } = render()
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(/still has running/i)
    expect(templatesList).not.toHaveBeenCalled()
    expect(shortcutsList).not.toHaveBeenCalled()
  })

  it('offers no delete for the Default workspace', () => {
    const { r } = render()
    expect(r.container.querySelector('[data-testid="workspace-delete-default"]')).toBeNull()
  })

  it('warns that scoped templates and shortcuts go with the workspace', () => {
    const { r } = render()
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    expect(q(r, '[data-testid="workspace-delete-confirm-text"]').textContent).toMatch(
      /templates and shortcuts scoped to it/i
    )
  })

  it('closes on Escape', () => {
    const { r, onClose } = render()
    act(() => {
      q(r, '[data-testid="workspaces-overlay"]').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onClose).toHaveBeenCalled()
  })
})
