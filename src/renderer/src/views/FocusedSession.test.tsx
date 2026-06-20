// Story 3.2 (FR-11 / F6) → Story 3.4 (FR-16) — the Focused-session view tests (AC: #1, #3, #5).
//
// Story 3.4 ADDS the persistent attention rail alongside the terminal and keeps ALL app-launched
// terminals alive (the rail switch is a pure show/hide). The view now reads the visible terminal +
// the kept-alive set from the store (no `terminalId` prop). Asserts: the rail IS present (FR-16);
// the focused terminal renders; "← Board" → onBack; a rail click switches the visible terminal +
// acknowledges (no input sent).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    terminalIdBySessionId: {}
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

function render(onBack: () => void = () => {}): RenderResult {
  const r = renderComponent(<FocusedSession onBack={onBack} />)
  cleanup = r.unmount
  return r
}

describe('FocusedSession — Story 3.4 rail + kept-alive terminals (AC-1, AC-3, AC-5)', () => {
  it('renders the persistent attention RAIL alongside the terminal (FR-16)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1')
    const r = render()
    expect(r.container.querySelector('[data-testid="attention-rail"]')).not.toBeNull()
  })

  it('renders the focused terminal (the optimistic launched terminalId from the store)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1')
    const r = render()
    const term = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(term).not.toBeNull()
    expect(term?.getAttribute('data-terminal-id')).toBe('launch-term-1')
  })

  it('keeps ALL app-launched terminals ALIVE (correlated ∪ focused) — switching never recreates', () => {
    // One correlated session + the currently-focused (just-launched, not-yet-correlated) terminal.
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().addCorrelation('a', 'launch-a')
    boardStore.getState().openLaunchedTerminal('launch-b')
    const r = render()
    const terms = [...r.container.querySelectorAll('[data-testid="embedded-terminal"]')].map((el) =>
      el.getAttribute('data-terminal-id')
    )
    expect(new Set(terms)).toEqual(new Set(['launch-a', 'launch-b']))
  })

  it('the "← Board" affordance calls onBack (Esc-to-Board equivalent)', () => {
    boardStore.getState().openLaunchedTerminal('launch-term-1')
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

  it('a rail row whose binding has NOT landed is alert-only: acknowledges but does NOT switch', () => {
    boardStore.getState().applyWatchEvent(updated(1, 'a', 'needs-you', 100))
    boardStore.getState().openLaunchedTerminal('launch-other') // focused = some other terminal
    // session 'a' has NO terminalIdBySessionId binding yet.
    const r = render()
    const rowA = r.container.querySelector<HTMLButtonElement>('[data-session-id="a"]')
    rowA?.click()
    // Acknowledged (the operator saw it) but the visible terminal did NOT switch (no binding).
    expect(boardStore.getState().acknowledgedById['a']).not.toBeUndefined()
    expect(boardStore.getState().focusedTerminalId).toBe('launch-other')
  })
})
