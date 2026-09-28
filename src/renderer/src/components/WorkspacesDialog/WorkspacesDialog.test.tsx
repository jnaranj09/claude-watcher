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
import { boardStore } from '../../stores/boardStore'
import type { Workspace, WorkspaceSaveRequest } from '../../../../shared/ipc/contract'

const ROWS: Workspace[] = [
  { id: 'default', name: 'Default', color: 'slate', defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue', defaultCwd: '/home/j/ops' }
]

let cleanup: (() => void) | undefined
let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
// The four list bridges `loadTemplates`/`loadShortcuts`/`loadTags`/`loadRules` call — stubbed so
// the re-read after a committed delete is observable end-to-end (the real store functions run; only
// IPC is faked).
let templatesList: ReturnType<typeof vi.fn>
let shortcutsList: ReturnType<typeof vi.fn>
let tagsList: ReturnType<typeof vi.fn>
let rulesList: ReturnType<typeof vi.fn>

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
  tagsList = vi.fn(() => Promise.resolve([]))
  rulesList = vi.fn(() => Promise.resolve({ rules: [], brokenIds: [] }))
  ;(window as unknown as { workspaces: unknown }).workspaces = { save, remove }
  ;(window as unknown as { templates: unknown }).templates = { list: templatesList }
  ;(window as unknown as { shortcuts: unknown }).shortcuts = { list: shortcutsList }
  ;(window as unknown as { tags: unknown }).tags = { list: tagsList }
  ;(window as unknown as { rules: unknown }).rules = { list: rulesList }
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
    click(q(r, '[data-testid="workspace-select-w1"]'))
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(
      /still has running sessions/i
    )
  })

  // Wrapped shape, same reasoning as the delete case above.
  it('UX-06: a save the disk refused says so, not "saved"', async () => {
    save.mockRejectedValueOnce(
      new Error("Error invoking remote method 'workspaces:save': Error: store_write_failed")
    )
    const { r } = render()
    click(q(r, '[data-testid="workspace-new"]'))
    type(q(r, '[data-testid="workspace-name-input"]'), 'Ops')
    click(q(r, '[data-testid="workspace-submit"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(/^Could not save to disk/)
  })

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

  // Deleting a workspace CASCADES its scoped templates, shortcuts, tags and rules in main; the
  // renderer's four projections only load at startup, so without an explicit re-read they keep
  // showing the deleted rows (filed under `(no workspace)`, where saving one throws
  // template_not_found / rule_not_found, and a deleted rule still counts in "Used by N rules").
  //
  // Non-vacuous: all four spies start at zero call count and the seeded delete is the only thing
  // in the test that could reach them — dropping any loader from the `Promise.all([...])` line
  // leaves its spy at 0 and turns the assertions red.
  it('re-reads templates, shortcuts, tags and rules after a committed delete', async () => {
    const { r } = render()
    expect(templatesList).not.toHaveBeenCalled()
    expect(shortcutsList).not.toHaveBeenCalled()
    expect(tagsList).not.toHaveBeenCalled()
    expect(rulesList).not.toHaveBeenCalled()
    click(q(r, '[data-testid="workspace-select-w1"]'))
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(remove).toHaveBeenCalledWith('w1')
    expect(templatesList).toHaveBeenCalledTimes(1)
    expect(shortcutsList).toHaveBeenCalledTimes(1)
    expect(tagsList).toHaveBeenCalledTimes(1)
    expect(rulesList).toHaveBeenCalledTimes(1)
  })

  // The other half of the same rule: a REFUSED delete cascaded nothing in main, so re-reading
  // would be pointless work. This pins the re-read to the success path — moving the loads out of
  // the try (or into a finally) turns this red while the test above stays green.
  it('does NOT re-read templates, shortcuts, tags or rules when the delete was refused', async () => {
    remove.mockRejectedValueOnce(
      new Error("Error invoking remote method 'workspaces:delete': Error: workspace_has_sessions")
    )
    const { r } = render()
    click(q(r, '[data-testid="workspace-select-w1"]'))
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    click(q(r, '[data-testid="workspace-delete-confirm"]'))
    await flush()
    expect(q(r, '[data-testid="workspace-error"]').textContent).toMatch(/still has running/i)
    expect(templatesList).not.toHaveBeenCalled()
    expect(shortcutsList).not.toHaveBeenCalled()
    expect(tagsList).not.toHaveBeenCalled()
    expect(rulesList).not.toHaveBeenCalled()
  })

  // Non-vacuous: Default is SELECTED first, so its form is the one on screen — the assertion
  // fails if the delete control renders for every selected row. Without the select the form
  // would be the empty "new" form, which shows no delete for any workspace.
  it('offers no delete for the Default workspace', () => {
    const { r } = render()
    click(q(r, '[data-testid="workspace-select-default"]'))
    expect(q(r, '[data-testid="workspace-form"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="workspace-delete-default"]')).toBeNull()
  })

  // Placement is the rule, not a detail (.claude/rules/design.md): Delete sits in the form
  // footer beside Save, the way TemplateForm and ShortcutRow do it — never back on the list row.
  // Moving the button into the list turns this red while every behavior test above stays green.
  it('puts Delete in the form footer, not on the list row', () => {
    const { r } = render()
    click(q(r, '[data-testid="workspace-select-w1"]'))
    const del = q(r, '[data-testid="workspace-delete-w1"]')
    expect(del.closest('[data-testid="workspace-form"]')).not.toBeNull()
    expect(del.closest('[data-testid="workspace-item-w1"]')).toBeNull()
  })

  // UX-09: the cascade also takes the rules and every past-session record of the workspace, and
  // the warning used to stop at tags. Each word is asserted on its own so dropping any one fails.
  it('names everything the cascade deletes: templates, shortcuts, tags, rules, past sessions', () => {
    const { r } = render()
    click(q(r, '[data-testid="workspace-select-w1"]'))
    click(q(r, '[data-testid="workspace-delete-w1"]'))
    const text = q(r, '[data-testid="workspace-delete-confirm-text"]').textContent
    for (const word of ['templates', 'shortcuts', 'tags', 'rules', 'past sessions']) {
      expect(text).toContain(word)
    }
  })

  // UX-18: a natural exit removes the session from main, so main allows deleting its workspace
  // while the dead pane is still focused. Deleting the ACTIVE workspace must pull the focused view
  // back into the new active one (Default, here with no terminal → the board).
  describe('the focused view after a delete (UX-18)', () => {
    beforeEach(() => {
      act(() => {
        boardStore.setState({ viewMode: 'board', focusedTerminalId: null, launchedTerminals: {} })
        boardStore.getState().registerLaunchedTerminal('t-dead', 'dead pane', 'w1')
        boardStore.setState({ viewMode: 'focused', focusedTerminalId: 't-dead' })
      })
    })
    afterEach(() => {
      act(() =>
        boardStore.setState({ viewMode: 'board', focusedTerminalId: null, launchedTerminals: {} })
      )
    })

    async function deleteW1(r: RenderResult): Promise<void> {
      click(q(r, '[data-testid="workspace-select-w1"]'))
      click(q(r, '[data-testid="workspace-delete-w1"]'))
      click(q(r, '[data-testid="workspace-delete-confirm"]'))
      await flush()
    }

    it('deleting the active workspace leaves its focused dead pane', async () => {
      act(() => workspacesStore.setState({ activeId: 'w1' }))
      const { r } = render()
      await deleteW1(r)
      expect(boardStore.getState().focusedTerminalId).toBeNull()
      expect(boardStore.getState().viewMode).toBe('board')
    })

    // Focused on the OLDER of two Default panes: an unconditional focusWorkspace would jump to the
    // newest one, so this fails if the reconcile runs for a delete of a non-active workspace.
    it('deleting another workspace leaves the focused view alone', async () => {
      act(() => {
        const { launchedTerminals } = boardStore.getState()
        boardStore.setState({
          launchedTerminals: {
            ...launchedTerminals,
            't-default': {
              terminalId: 't-default',
              launchedAt: 1,
              label: 'a',
              workspaceId: 'default'
            },
            't-newer': { terminalId: 't-newer', launchedAt: 2, label: 'b', workspaceId: 'default' }
          },
          focusedTerminalId: 't-default'
        })
      })
      const { r } = render()
      await deleteW1(r)
      expect(boardStore.getState().focusedTerminalId).toBe('t-default')
      expect(boardStore.getState().viewMode).toBe('focused')
    })

    it('a refused delete leaves the focused view alone', async () => {
      remove.mockRejectedValueOnce(
        new Error("Error invoking remote method 'workspaces:delete': Error: workspace_has_sessions")
      )
      act(() => workspacesStore.setState({ activeId: 'w1' }))
      const { r } = render()
      await deleteW1(r)
      expect(boardStore.getState().focusedTerminalId).toBe('t-dead')
      expect(boardStore.getState().viewMode).toBe('focused')
    })
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
