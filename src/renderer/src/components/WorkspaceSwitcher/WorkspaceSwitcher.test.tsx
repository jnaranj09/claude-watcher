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

  // Review finding 3 — the aria-label is screen-reader text; "1 sessions" reads wrong.
  it('pluralizes the badge aria-label correctly for exactly one', () => {
    seedNeedsYou('w1', 'b')
    const r = renderSwitcher()
    const badge = q(r, '[data-testid="workspace-elsewhere-badge"]')
    expect(badge.getAttribute('aria-label')).toBe('1 session needs you in other workspaces')
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
