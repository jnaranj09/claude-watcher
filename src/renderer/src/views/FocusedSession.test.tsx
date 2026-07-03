// Story 3.2 (FR-11 / F6) → Story 3.4 (FR-16) — the Focused-session view tests (AC: #1, #3, #5).
//
// Story 3.4 ADDS the persistent attention rail alongside the terminal and keeps ALL app-launched
// terminals alive (the rail switch is a pure show/hide). The view now reads the visible terminal +
// the kept-alive set from the store (no `terminalId` prop). Asserts: the rail IS present (FR-16);
// the focused terminal renders; "← Board" → onBack; a rail click switches the visible terminal +
// acknowledges (no input sent).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { FocusedSession } from './FocusedSession'
import { boardStore } from '../stores/boardStore'
import type { Column, WatchEventsPayload } from '../../../shared/ipc/contract'

let cleanup: (() => void) | undefined

/** A validated session.updated delta to seed the store (the rail's source). */
function updated(
  epoch: number,
  id: string,
  column: Column,
  enteredColumnAt: number
): WatchEventsPayload {
  return {
    epoch,
    event: {
      type: 'session.updated',
      id,
      sessionName: `s-${id}`,
      projectPath: `/p/${id}`,
      status: column === 'needs-you' ? 'NeedsAttention' : 'Working',
      column,
      enteredColumnAt,
      pid: 1000
    }
  }
}

beforeEach(() => {
  boardStore.setState({
    sessionsById: {},
    epoch: 0,
    viewMode: 'focused',
    focusedTerminalId: null,
    selectedId: null,
    acknowledgedById: {},
    terminalIdBySessionId: {},
    // Story 5.6 — reset the launched-terminals registry between tests (prevents cross-test leakage).
    launchedTerminals: {}
  })
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* no-op shim — jsdom has no layout */
    }
    unobserve(): void {
      /* no-op shim */
    }
    disconnect(): void {
      /* no-op shim */
    }
  }
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 })),
    set: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 }))
  }
  // Story 3.5 (SM-2) — mock the telemetry bridge so acknowledgeSession() does not throw
  // in the test environment (window.telemetry is not wired by the preload in jsdom).
  // The mock just resolves: unit tests for the telemetry IPC are in the main-unit project.
  ;(window as unknown as { telemetry: unknown }).telemetry = {
    acknowledge: vi.fn(() => Promise.resolve())
  }
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function render(onBack: () => void = () => {}, onNewSession: () => void = () => {}): RenderResult {
  const r = renderComponent(<FocusedSession onBack={onBack} onNewSession={onNewSession} />)
  cleanup = r.unmount
  return r
}

describe('FocusedSession — Story 3.4 rail + kept-alive terminals (AC-1, AC-3, AC-5)', () => {
  it('renders the persistent attention RAIL alongside the terminal (FR-16)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1')
    const r = render()
    expect(r.container.querySelector('[data-testid="attention-rail"]')).not.toBeNull()
  })

  it('renders the focused terminal (the optimistic launched terminalId from the store)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1')
    const r = render()
    const term = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(term).not.toBeNull()
    expect(term?.getAttribute('data-terminal-id')).toBe('launch-term-1')
  })

  it('keeps ALL app-launched terminals ALIVE (correlated ∪ focused) — switching never recreates', () => {
    // One correlated session + the currently-focused (just-launched, not-yet-correlated) terminal.
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().openLaunchedTerminal('launch-b', 'b')
    const r = render()
    const terms = [...r.container.querySelectorAll('[data-testid="embedded-terminal"]')].map((el) =>
      el.getAttribute('data-terminal-id')
    )
    expect(new Set(terms)).toEqual(new Set(['launch-a', 'launch-b']))
  })

  it('the "← Board" affordance calls onBack (Esc-to-Board equivalent)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1', 'term-1')
    const onBack = vi.fn()
    const r = render(onBack)
    const back = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-back"]')
    expect(back).not.toBeNull()
    back?.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('a rail-row click SWITCHES the visible terminal + ACKNOWLEDGES (no input sent — AC-3)', () => {
    // Seed two correlated sessions; focus the first.
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().applyWatchEvent(updated(1, 'b', 'needs-you', 200))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().addCorrelation('b', 'launch-b')
    boardStore.getState().switchTerminal('launch-a')
    const r = render()

    // Click the rail row for session 'b'.
    const rowB = r.container.querySelector<HTMLButtonElement>('[data-session-id="b"]')
    expect(rowB).not.toBeNull()
    rowB?.click()

    // The visible terminal switched to b's terminal; b was acknowledged.
    expect(boardStore.getState().focusedTerminalId).toBe('launch-b')
    expect(boardStore.getState().acknowledgedById['b']).not.toBeUndefined()
    // window.terminal had NO input/write call — switching is pure view-state (the open() fake only
    // wires the port; there is no input API on the bridge, by construction — alert-only, FR-9).
  })

  // Story 6.1 — the focused surface threads onNewSession down to EmbeddedTerminal, so the dead
  // pane's ONE "New session" button runs App's launch flow (NOT the plain re-open fallback).
  it('threads onNewSession to the terminal: the dead pane button calls it (Story 6.1)', () => {
    // A capturing onExit fake so the test can flip the terminal into its dead pane.
    const exitCbs: Array<(info: { terminalId: string; exitCode: number }) => void> = []
    ;(window as unknown as { terminal: unknown }).terminal = {
      open: vi.fn(() => () => {}),
      resize: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      onExit: vi.fn((cb: (info: { terminalId: string; exitCode: number }) => void) => {
        exitCbs.push(cb)
        return () => {}
      })
    }
    boardStore.getState().openLaunchedTerminal('launch-dead-thread', 'dead-thread')
    const onNewSession = vi.fn()
    const r = render(() => {}, onNewSession)

    // Exit the focused terminal → its dead pane shows the ONE New-session button.
    act(() => exitCbs.forEach((cb) => cb({ terminalId: 'launch-dead-thread', exitCode: 0 })))
    const btn = r.container.querySelector<HTMLButtonElement>('[data-testid="dead-new-session"]')
    expect(btn).not.toBeNull()

    act(() => {
      btn?.click()
    })
    // The threaded prop fired (App's handleNewSession flow), NOT the re-open fallback.
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('a rail row whose binding has NOT landed is alert-only: acknowledges but does NOT switch', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().openLaunchedTerminal('launch-other', 'other') // focused = some other terminal
    // session 'a' has NO terminalIdBySessionId binding yet.
    const r = render()
    const rowA = r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')
    rowA?.click()
    // Acknowledged (the operator saw it) but the visible terminal did NOT switch (no binding).
    expect(boardStore.getState().acknowledgedById['a']).not.toBeUndefined()
    expect(boardStore.getState().focusedTerminalId).toBe('launch-other')
  })
})

// ---------------------------------------------------------------------------
// Story 4.3 (FR-15) — the ⏹ Stop session header button tests
// ---------------------------------------------------------------------------

describe('FocusedSession — Story 4.3 ⏹ Stop session header button (FR-15)', () => {
  it('renders the ⏹ Stop session button in the focused header', () => {
    boardStore.getState().openLaunchedTerminal('launch-stop-test', 'stop-test')
    const r = render()
    const stopBtn = r.container.querySelector('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()
  })

  it('clicking ⏹ Stop session opens the Stop-confirm with the focused terminalId', () => {
    boardStore.getState().openLaunchedTerminal('launch-stop-click', 'stop-click')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()

    stopBtn?.click()

    // The Stop-confirm should be open with the correct terminalId.
    expect(boardStore.getState().stopConfirm).not.toBeNull()
    expect(boardStore.getState().stopConfirm?.terminalId).toBe('launch-stop-click')
  })

  it('clicking ⏹ Stop session includes a sessionName in the payload (verbatim name or terminalId fallback)', () => {
    // When correlated, the sessionName should be the c9watch name.
    boardStore.getState().applyWatchEvent(updated(1, 'sess-corr', 'working', 100))
    boardStore.getState().addCorrelation('sess-corr', 'launch-corr-term')
    boardStore.getState().switchTerminal('launch-corr-term')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    stopBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).not.toBeNull()
    expect(payload?.terminalId).toBe('launch-corr-term')
    // The session name should be the c9watch name (s-sess-corr from the `updated` helper).
    expect(payload?.sessionName).toBe('s-sess-corr')
  })

  it('clicking ⏹ Stop session degrades gracefully to terminalId when no correlation exists', () => {
    // Pre-correlation: no session bound to this terminal yet → fall back to bare terminalId.
    boardStore.getState().openLaunchedTerminal('launch-pre-corr', 'pre-corr')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    stopBtn?.click()

    const payload = boardStore.getState().stopConfirm
    expect(payload).not.toBeNull()
    // No session correlated → sessionName falls back to bare terminalId (never crashes).
    expect(payload?.sessionName).toBe('launch-pre-corr')
  })

  it('the ⏹ Stop session button is rendered and focusedTerminalId is wired to the payload', () => {
    // The null-guard in handleStopSession is internal; verify the button correctly passes
    // the focused terminalId from the store into the payload (not a hardcoded value).
    boardStore.getState().openLaunchedTerminal('launch-id-wire-check', 'id-wire-check')
    const r = render()
    const stopBtn = r.container.querySelector<HTMLButtonElement>('[data-testid="focused-stop"]')
    expect(stopBtn).not.toBeNull()
    stopBtn?.click()
    // The payload terminalId must match the store's focusedTerminalId exactly.
    expect(boardStore.getState().stopConfirm?.terminalId).toBe(
      boardStore.getState().focusedTerminalId ?? 'launch-id-wire-check'
    )
  })
})

// ---------------------------------------------------------------------------
// Spec: terminal-input-breathing-room — reserved bottom tool strip (2026-06-24)
// ---------------------------------------------------------------------------

describe('FocusedSession — reserved bottom tool strip (breathing room spec)', () => {
  it('renders a .toolStrip sibling AFTER .terminalWrap inside .main (aria-hidden)', () => {
    boardStore.getState().openLaunchedTerminal('launch-strip-test', 'strip-test')
    const r = render()

    // Locate .main by finding the focused-session root and then its second child
    // (index 1 = .main; index 0 = the attention rail).
    const focused = r.container.querySelector('[data-testid="focused-session"]')
    expect(focused).not.toBeNull()

    // .main is the second child of the focused wrapper (after AttentionRail).
    const main = focused?.children[1] as HTMLElement | undefined
    expect(main).not.toBeUndefined()

    // Find .terminalWrap and .toolStrip among .main's direct children.
    const children = main !== undefined ? [...main.children] : []
    const terminalWrapIndex = children.findIndex((el) => el.className.includes('terminalWrap'))
    const toolStripIndex = children.findIndex((el) => el.className.includes('toolStrip'))

    // Both must be present.
    expect(terminalWrapIndex).toBeGreaterThanOrEqual(0)
    expect(toolStripIndex).toBeGreaterThanOrEqual(0)

    // .toolStrip must come AFTER .terminalWrap (sibling, not child).
    expect(toolStripIndex).toBeGreaterThan(terminalWrapIndex)

    // The strip carries aria-hidden="true".
    const toolStrip = children[toolStripIndex]
    expect(toolStrip?.getAttribute('aria-hidden')).toBe('true')
  })

  it('the tool strip is NOT inside .terminalWrap (must stay out of the terminal stacking context)', () => {
    boardStore.getState().openLaunchedTerminal('launch-strip-placement', 'strip-placement')
    const r = render()

    const focused = r.container.querySelector('[data-testid="focused-session"]')
    const main = focused?.children[1] as HTMLElement | undefined
    const terminalWrap =
      main !== undefined
        ? [...main.children].find((el) => el.className.includes('terminalWrap'))
        : undefined

    expect(terminalWrap).not.toBeUndefined()

    // The .toolStrip div must NOT be a descendant of .terminalWrap.
    // (Query by CSS module class substring — it is NOT a child of the wrap.)
    const stripInsideWrap =
      terminalWrap !== undefined
        ? [...terminalWrap.querySelectorAll('*')].find((el) => el.className.includes('toolStrip'))
        : undefined
    expect(stripInsideWrap).toBeUndefined()
  })
})
