// Workspaces (Task 9b) — the header switcher tests. jsdom `unit` project.
//
// NOTE: this repo does NOT install `@testing-library/react` (Story 1.3 —
// src/renderer/src/test/renderComponent.ts: "avoids pulling RTL just for a handful of
// presentational components"), and Task 9a's own sibling tests (Board.test.tsx,
// AttentionRail.test.tsx) confirm that convention is still current today. The task-9 brief's
// Step 1 test imports `render`/`screen`/`fireEvent`/`waitFor` from `@testing-library/react`,
// which fails to resolve in this tree — verified with `npx vitest run` before writing this
// file. Same six cases, same assertions and testids, adapted to the existing
// `renderComponent` + native-DOM-event harness instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, fireEvent, type RenderResult } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import { workspacesStore } from '../../stores/workspacesStore'
import { WORKSPACE_COLORS } from '../../../../shared/schemas/workspace'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import styles from './WorkspaceSwitcher.module.css'

const rows = [
  { id: 'default', name: 'Default', color: 'slate' as const, defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }
]

function seedNeedsYou(workspaceId: string, id: string): void {
  act(() => {
    boardStore.getState().applyWatchEvent({
      epoch: 0,
      event: {
        type: 'session.updated',
        id,
        sessionName: id,
        projectPath: '/p',
        status: 'YourTurn',
        column: 'needs-you',
        enteredColumnAt: 1,
        pid: 1,
        workspaceId
      }
    })
  })
}

let cleanup: (() => void) | undefined

beforeEach(() => {
  workspacesStore.setState({ workspaces: rows, activeId: 'default', loaded: true })
  boardStore.setState({ sessionsById: {} })
  window.workspaces = {
    setActive: vi.fn().mockResolvedValue({ activeId: 'w1', workspaces: rows })
  } as never
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

/** Substitute for RTL's `waitFor` — settle the `setActiveWorkspace(...).then(...)` chain. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function renderSwitcher(onManage: () => void = () => {}): RenderResult {
  const r = renderComponent(<WorkspaceSwitcher onManage={onManage} />)
  cleanup = r.unmount
  return r
}

function q<T extends Element>(r: RenderResult, sel: string): T {
  const el = r.container.querySelector<T>(sel)
  if (el === null) throw new Error(`missing ${sel}`)
  return el
}

function click(el: Element): void {
  fireEvent(el, new MouseEvent('click', { bubbles: true }))
}

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace name', () => {
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').textContent).toContain('Default')
  })

  it('badges the OTHER workspaces needs-you total, not the active one', () => {
    seedNeedsYou('default', 'a')
    seedNeedsYou('w1', 'b')
    seedNeedsYou('w1', 'c')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toContain('2')
  })

  it('renders no badge when only the active workspace needs you', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-badge"]')).toBeNull()
  })

  it('lists every workspace with its own count and switches on click', async () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const row = q(r, '[data-testid="workspace-row-w1"]')
    expect(row.textContent).toContain('Ops')
    expect(row.textContent).toContain('1')
    click(row)
    await flush()
    expect(window.workspaces.setActive).toHaveBeenCalledWith('w1')
  })

  it('reconciles the focused view after a switch', async () => {
    const spy = vi.spyOn(boardStore.getState(), 'focusWorkspace')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-row-w1"]'))
    await flush()
    expect(spy).toHaveBeenCalledWith('w1')
  })

  it('opens the manage dialog from the popover', () => {
    const onManage = vi.fn()
    const r = renderSwitcher(onManage)
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-manage"]'))
    expect(onManage).toHaveBeenCalled()
  })

  // "Two things to watch" #2 — a completeness net: iterates the CANONICAL
  // WORKSPACE_COLORS array (never a hand-typed copy) so a future 7th color that gets no CSS
  // class turns this red instead of silently rendering an undefined-class (invisible) dot.
  it('defines a CSS class for every WORKSPACE_COLORS entry', () => {
    for (const color of WORKSPACE_COLORS) {
      expect(styles[color]).toBeTruthy()
    }
  })
})
