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
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { Column } from '../../../../shared/ipc/contract'

const rows = [
  { id: 'default', name: 'Default', color: 'slate' as const, defaultCwd: null },
  { id: 'w1', name: 'Ops', color: 'blue' as const, defaultCwd: null }
]

const STATUS_FOR: Record<Column, string> = {
  'needs-you': 'YourTurn',
  working: 'Working',
  idle: 'Idle'
}

function seedCard(workspaceId: string, id: string, column: Column): void {
  act(() => {
    boardStore.getState().applyWatchEvent({
      epoch: 0,
      event: {
        type: 'session.updated',
        id,
        sessionName: id,
        projectPath: '/p',
        status: STATUS_FOR[column],
        column,
        enteredColumnAt: 1,
        pid: 1,
        workspaceId
      }
    })
  })
}

function seedNeedsYou(workspaceId: string, id: string): void {
  seedCard(workspaceId, id, 'needs-you')
}

let cleanup: (() => void) | undefined

// Captured ONCE, before any `vi.spyOn(boardStore.getState(), 'focusWorkspace')` runs — the
// pristine, never-mocked action. Needed because `vi.restoreAllMocks()` restores a spy on the
// OBJECT it was installed on, but `focusWorkspace`'s own real implementation calls `set(...)`,
// and zustand's `set` shallow-merges the CURRENT state (`{ ...get(), ...partial }`) into a NEW
// object — which copies the (still-mocked) `focusWorkspace` property FORWARD onto that new
// object too. `restoreAllMocks` never touches that new object, so the mock silently survives
// as the CURRENT `boardStore.getState().focusWorkspace` after the test that spied on it ends,
// and a LATER test's fresh `vi.spyOn` on the same (already-a-mock) property returns that same
// leftover instance instead of a clean one — its stale call history reads as a false positive
// in the next test. (Found empirically: "does not reconcile…" below failed only when run after
// "reconciles the focused view after a switch", never alone — a debug log confirmed this
// component's own guard was correctly NOT calling `focusWorkspace` in the failing run.)
const pristineFocusWorkspace = boardStore.getState().focusWorkspace

beforeEach(() => {
  workspacesStore.setState({ workspaces: rows, activeId: 'default', loaded: true })
  boardStore.setState({ sessionsById: {}, focusWorkspace: pristineFocusWorkspace })
  window.workspaces = {
    setActive: vi.fn().mockResolvedValue({ activeId: 'w1', workspaces: rows })
  } as never
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Belt-and-suspenders beyond restoreAllMocks — see the comment above `pristineFocusWorkspace`.
  boardStore.setState({ focusWorkspace: pristineFocusWorkspace })
})

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

  // The grey number is the cards that do NOT need you — the pill beside it counts the rest, so
  // "2 sessions, 1 needs you" reads `1 (1)`, never `2 (1)`.
  it('shows the active workspace cards that do not need you, inside the button', () => {
    seedCard('default', 'a', 'needs-you')
    seedCard('default', 'b', 'working')
    seedCard('default', 'c', 'idle')
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    const count = q(r, '[data-testid="workspace-switcher"] [data-testid="workspace-card-count"]')
    expect(count.textContent).toBe('2')
  })

  it('hides the grey count when every active card needs you — the pill alone, never 0 (1)', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-card-count"]')).toBeNull()
    expect(q(r, '[data-testid="workspace-here-badge"]').textContent).toBe('1')
  })

  it('shows 0 when the active workspace has no cards', () => {
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-card-count"]').textContent).toBe('0')
  })

  // The pill INSIDE the button means "this workspace needs you"; the tab BEHIND it means
  // "another one does". The old single badge sat inside and meant the second — which read as
  // the first (it pointed at the workspace on screen while the card was elsewhere).
  it('badges the active workspace inside the button and the OTHER ones on the tab', () => {
    seedNeedsYou('default', 'a')
    seedNeedsYou('w1', 'b')
    seedNeedsYou('w1', 'c')
    const r = renderSwitcher()
    const button = q(r, '[data-testid="workspace-switcher"]')
    expect(q(r, '[data-testid="workspace-here-badge"]').textContent).toBe('1')
    expect(button.contains(q(r, '[data-testid="workspace-here-badge"]'))).toBe(true)
    const tab = q(r, '[data-testid="workspace-elsewhere-tab"]')
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('2')
    expect(tab.contains(q(r, '[data-testid="workspace-elsewhere-badge"]'))).toBe(true)
    expect(button.contains(tab)).toBe(false)
  })

  it('renders no tab when only the active workspace needs you', () => {
    seedNeedsYou('default', 'a')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-elsewhere-tab"]')).toBeNull()
  })

  it('renders no here-badge when only another workspace needs you', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    expect(r.container.querySelector('[data-testid="workspace-here-badge"]')).toBeNull()
  })

  it('puts one dot per OTHER workspace needing you on the tab — list order, at most 3', () => {
    workspacesStore.setState({
      workspaces: [
        ...rows,
        { id: 'w2', name: 'Two', color: 'green', defaultCwd: null },
        { id: 'w3', name: 'Three', color: 'rose', defaultCwd: null },
        { id: 'w4', name: 'Four', color: 'violet', defaultCwd: null }
      ]
    })
    seedNeedsYou('w4', 'a')
    seedNeedsYou('w3', 'b')
    seedNeedsYou('default', 'c')
    seedNeedsYou('w1', 'd')
    seedNeedsYou('w2', 'e')
    const r = renderSwitcher()
    const dots = [...r.container.querySelectorAll('[data-testid^="workspace-elsewhere-dot-"]')]
    expect(dots.map((d) => d.getAttribute('data-testid'))).toEqual([
      'workspace-elsewhere-dot-w1',
      'workspace-elsewhere-dot-w2',
      'workspace-elsewhere-dot-w3'
    ])
    // The count still covers all four — the dots are capped, the number is not.
    expect(q(r, '[data-testid="workspace-elsewhere-badge"]').textContent).toBe('4')
  })

  // A card whose workspace was deleted still needs you; it gets the dim orphan dot, after the
  // real workspaces.
  it('gives a needs-you card in a deleted workspace a dot after the real ones', () => {
    seedNeedsYou('gone', 'a')
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    const dots = [...r.container.querySelectorAll('[data-testid^="workspace-elsewhere-dot-"]')]
    expect(dots.map((d) => d.getAttribute('data-testid'))).toEqual([
      'workspace-elsewhere-dot-w1',
      'workspace-elsewhere-dot-gone'
    ])
  })

  it('opens the dropdown from the tab too', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-elsewhere-tab"]'))
    expect(r.container.querySelector('[role="menu"]')).not.toBeNull()
  })

  // The tab is aria-hidden (it is not its own Tab-key stop), so the button's accessible name
  // must carry every count. Review finding 3 — "1 sessions" reads wrong: every noun agrees.
  it('names every count in the button aria-label, singular for exactly one', () => {
    seedNeedsYou('default', 'a')
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').getAttribute('aria-label')).toBe(
      'Default, 1 session, 1 needs you; 1 session needs you in other workspaces'
    )
  })

  it('pluralizes the button aria-label and drops the counts that are zero', () => {
    seedCard('default', 'a', 'working')
    seedCard('default', 'b', 'idle')
    const r = renderSwitcher()
    expect(q(r, '[data-testid="workspace-switcher"]').getAttribute('aria-label')).toBe(
      'Default, 2 sessions'
    )
  })

  it('shows each row its cards that do not need you and a needs-you pill', () => {
    seedCard('w1', 'b', 'needs-you')
    seedCard('w1', 'c', 'working')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(q(r, '[data-testid="workspace-row-count-w1"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-row-needs-w1"]').textContent).toBe('1')
    expect(q(r, '[data-testid="workspace-row-count-default"]').textContent).toBe('0')
    expect(r.container.querySelector('[data-testid="workspace-row-needs-default"]')).toBeNull()
    // Read aloud, the row still gives the TRUE total — "2 sessions, 1 needs you" is accurate.
    expect(q(r, '[data-testid="workspace-row-w1"]').getAttribute('aria-label')).toBe(
      'Ops, 2 sessions, 1 needs you'
    )
  })

  it('hides a row grey count when every card in that workspace needs you', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    expect(r.container.querySelector('[data-testid="workspace-row-count-w1"]')).toBeNull()
    expect(q(r, '[data-testid="workspace-row-needs-w1"]').textContent).toBe('1')
  })

  // The pair reads the same in the button and in every row: grey first, then yellow. The rows
  // once put yellow first, so the same two pills swapped places when the menu opened.
  it('puts the grey count before the needs-you pill in the button and in every row', () => {
    seedCard('default', 'a', 'needs-you')
    seedCard('default', 'b', 'working')
    seedCard('w1', 'c', 'needs-you')
    seedCard('w1', 'd', 'working')
    const r = renderSwitcher()
    const follows = (first: string, second: string): boolean =>
      (q(r, first).compareDocumentPosition(q(r, second)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(
      follows('[data-testid="workspace-card-count"]', '[data-testid="workspace-here-badge"]')
    ).toBe(true)
    click(q(r, '[data-testid="workspace-switcher"]'))
    for (const id of ['default', 'w1']) {
      expect(
        follows(
          `[data-testid="workspace-row-count-${id}"]`,
          `[data-testid="workspace-row-needs-${id}"]`
        )
      ).toBe(true)
    }
  })

  it('lists every workspace with its own count and switches on click', async () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    const row = q(r, '[data-testid="workspace-row-w1"]')
    expect(row.textContent).toContain('Ops')
    expect(row.textContent).toContain('1')
    click(row)
    // `vi.waitFor` (Vitest's own, not RTL's) polls on a REAL timer, so — unlike a fixed
    // microtask-tick count — it cannot under-wait: a timer callback only fires after the
    // ENTIRE current microtask queue (including every `.then()` hop in the chain below) has
    // drained. See the "does not reconcile…" test below for why that matters here.
    await vi.waitFor(() => expect(window.workspaces.setActive).toHaveBeenCalledWith('w1'))
  })

  it('reconciles the focused view after a switch', async () => {
    const spy = vi.spyOn(boardStore.getState(), 'focusWorkspace')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-row-w1"]'))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('w1'))
  })

  // Review finding 1 — `setActiveWorkspace` SWALLOWS an IPC rejection (workspacesStore.ts
  // catches + console.warn's; it never rethrows), so a resolved `.then()` is not proof main
  // confirmed the switch. Reconciling unconditionally would point the focused view at a
  // workspace the board/rail are not showing. Assert the NEGATIVE: on a refused switch,
  // `activeId` stays put and `focusWorkspace` is never called.
  //
  // Waiting for a NEGATIVE can't use `vi.waitFor` directly (there's nothing to poll for that
  // becomes true). Instead: spy `console.warn` (the catch branch's only observable effect —
  // also mocked away so the expected failure doesn't spam test output) and `vi.waitFor` on
  // THAT. Because `console.warn` and the risky `.then()` are both reached inside one
  // continuous microtask chain (no macrotask boundary between them), and `vi.waitFor` only
  // re-checks on a REAL timer, the entire chain — including the `.then()` — is guaranteed to
  // have finished by the time the wait resolves. (This is not a hypothetical: the very first
  // draft of this test used a fixed-tick `flush()` helper instead, and it went red — not
  // from this component, but from a PRIOR test's own under-drained click leaking a real
  // `focusWorkspace('w1')` call into this test's spy. Switching every wait in this file to
  // `vi.waitFor` fixed both the leaker and this test in one move.)
  it('does not reconcile the focused view when main refuses the switch', async () => {
    window.workspaces = {
      setActive: vi.fn().mockRejectedValue(new Error('refused'))
    } as never
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const focusSpy = vi.spyOn(boardStore.getState(), 'focusWorkspace')
    const r = renderSwitcher()
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-row-w1"]'))
    await vi.waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        '[claude-watcher][workspaces] code=workspaces_set_active_failed'
      )
    )
    expect(window.workspaces.setActive).toHaveBeenCalledWith('w1')
    expect(workspacesStore.getState().activeId).toBe('default')
    expect(focusSpy).not.toHaveBeenCalled()
  })

  // Review finding 2 — mirrors NewSessionButton.test.tsx's "Escape closes and returns focus to
  // the button" case for its sibling menu.
  it('closes on Escape and returns focus to the trigger', () => {
    const r = renderSwitcher()
    const trigger = q(r, '[data-testid="workspace-switcher"]')
    click(trigger)
    expect(r.container.querySelector('[role="menu"]')).not.toBeNull()
    fireEvent(q(r, '[role="menu"]'), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(r.container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens the manage dialog from the popover', () => {
    const onManage = vi.fn()
    const r = renderSwitcher(onManage)
    click(q(r, '[data-testid="workspace-switcher"]'))
    click(q(r, '[data-testid="workspace-manage"]'))
    expect(onManage).toHaveBeenCalled()
  })

  // The swatch colors moved to WorkspaceDot.module.css (ONE definition app-wide); the
  // completeness net over WORKSPACE_COLORS lives in WorkspaceDot.test.tsx, where it reads the
  // stylesheet. Indexing an imported `styles` object could never have caught a missing class —
  // vitest resolves a CSS module to a proxy that answers every key.
})
