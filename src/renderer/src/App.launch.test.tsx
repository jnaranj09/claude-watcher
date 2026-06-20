// Story 3.2 (FR-11) — the App launch-flow wiring tests (AC: #1, #5).
//
// Drives the picker → launch → Focused-session flow through the App component with FAKE window
// bridges (no Electron). Asserts:
//   - `+ New session` opens the native picker (window.launch.pickDirectory) → on a pick, launches
//     (window.launch.launch) in the picked cwd → drops into the Focused-session by terminalId;
//   - CANCEL (picker returns null) is a NO-OP (no launch call, no view change);
//   - Ctrl+N triggers the same flow; Esc returns Focused → Board (UX-DR21);
//   - the EmbeddedTerminal is rendered in the focused view (reused as-is) — keyed by terminalId.
// The byte/PTY path is packaged-smoke-only; here the terminal is the Story-3.1 component with the
// window.terminal fakes (it just wires open()).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'

/** Resolve a microtask/Promise chain inside act() so async effects settle before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let cleanup: (() => void) | undefined
let pickResult: { current: string | null }
let launchResult: { current: { terminalId: string } }
let pickSpy: ReturnType<typeof vi.fn>
let launchSpy: ReturnType<typeof vi.fn>
let terminalStopSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Reset the singleton store view-state between cases (App uses the app singleton boardStore).
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {}
  })

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both) so the
  // EmbeddedTerminal mounts in the focused view.
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

  pickResult = { current: '/home/op/project' }
  launchResult = { current: { terminalId: 'launch-term-xyz' } }
  pickSpy = vi.fn(() => Promise.resolve(pickResult.current))
  launchSpy = vi.fn(() => Promise.resolve(launchResult.current))

  // The full window bridge surface App + Board + EmbeddedTerminal touch.
  ;(window as unknown as { pty: unknown }).pty = {
    smokeConfig: vi.fn(() => Promise.resolve({ enabled: false, electron: '', abi: '', node: '' }))
  }
  ;(window as unknown as { watch: unknown }).watch = {
    onEvents: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {})
  }
  ;(window as unknown as { attention: unknown }).attention = { onActivate: vi.fn(() => () => {}) }
  ;(window as unknown as { settings: unknown }).settings = {
    get: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 })),
    set: vi.fn(() => Promise.resolve({ version: 1, soundEnabled: true, terminalFontSize: 14 }))
  }
  terminalStopSpy = vi.fn(() => Promise.resolve())
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: terminalStopSpy,
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: pickSpy,
    launch: launchSpy,
    // Story 3.4 — App subscribes to the launch-correlation push; the fake returns an unsubscribe.
    onCorrelated: vi.fn(() => () => {})
  }
  // Ensure no leftover hash from a prior test steers the terminal-host view.
  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush() // resolve smokeConfig → board view
  return r
}

describe('App — Story 3.2 launch flow (AC-1, AC-5)', () => {
  it('+ New session → picker → launch in the picked cwd → drops into the Focused-session', async () => {
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    expect(button).not.toBeNull()

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()

    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(launchSpy).toHaveBeenCalledWith('/home/op/project')
    // Dropped into the Focused-session showing the launched terminal.
    expect(boardStore.getState().viewMode).toBe('focused')
    expect(boardStore.getState().focusedTerminalId).toBe('launch-term-xyz')
    expect(r.container.querySelector('[data-testid="focused-session"]')).not.toBeNull()
    expect(r.container.querySelector('[data-testid="embedded-terminal"]')).not.toBeNull()
  })

  it('CANCEL (picker returns null) is a NO-OP — no launch, no view change', async () => {
    pickResult.current = null
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()

    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(launchSpy).not.toHaveBeenCalled() // no PTY spawned
    expect(boardStore.getState().viewMode).toBe('board') // no view change
    expect(r.container.querySelector('[data-testid="board"]')).not.toBeNull()
  })

  it('Ctrl+N triggers the launch flow (UX-DR21)', async () => {
    await renderApp()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
      await Promise.resolve()
    })
    await flush()
    expect(pickSpy).toHaveBeenCalledTimes(1)
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  it('Esc returns Focused → Board (UX-DR21)', async () => {
    const r = await renderApp()
    // Enter the focused view via a launch first.
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('focused')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board')
    expect(r.container.querySelector('[data-testid="board"]')).not.toBeNull()
  })

  it('a launch failure (rejected invoke) does NOT crash — stays on the board', async () => {
    launchSpy.mockImplementation(() => Promise.reject(new Error('spawn failed')))
    const r = await renderApp()
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()
    // Picker + launch were attempted; the rejection is swallowed (code-only log) → board stays.
    expect(launchSpy).toHaveBeenCalled()
    expect(boardStore.getState().viewMode).toBe('board')
  })
})

// Story 3.4 (B-1 regression) — the Board↔Focused view switch is KEPT-ALIVE: it must NEVER unmount
// the EmbeddedTerminal, because unmounting runs the terminal's cleanup effect (term.dispose() +
// window.terminal.stop(terminalId)) which KILLS the live PTY in main. The old JSX ternary
// (`{showFocused ? <FocusedSession/> : <Board/>}`) unmounted FocusedSession on Esc → killed the
// session. This test drives a real focused → board → focused toggle through the App-level switch
// site and asserts the PTY is NOT stopped (window.terminal.stop is never called) on the transition.
//
// NON-VACUOUS: against the pre-fix ternary, pressing Esc unmounts FocusedSession → its
// EmbeddedTerminal cleanup calls window.terminal.stop(terminalId) → this expectation FAILS. With the
// stacked visibility:hidden fix the terminal stays mounted → stop is never called → it PASSES.
describe('App — Story 3.4 B-1: Board↔Focused switch is kept-alive (PTY survives, AC-3 / terminal.md)', () => {
  it('focused → board → focused does NOT stop/dispose the terminal (the live PTY is not killed)', async () => {
    const r = await renderApp()

    // 1) Launch → drop into the focused view (the EmbeddedTerminal mounts + opens its PTY).
    const button = r.container.querySelector<HTMLButtonElement>(
      '[data-testid="header-new-session"]'
    )
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('focused')
    const termEl = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(termEl).not.toBeNull()
    expect(termEl?.getAttribute('data-terminal-id')).toBe('launch-term-xyz')

    // Baseline: opening the terminal must not have stopped anything.
    expect(terminalStopSpy).not.toHaveBeenCalled()

    // 2) Esc → Board. With the OLD ternary this UNMOUNTS FocusedSession → the EmbeddedTerminal
    //    cleanup runs → window.terminal.stop(terminalId) is called → the PTY dies. The fix keeps it
    //    mounted (visibility:hidden), so stop must NOT be called.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('board')

    // 3) Re-enter the focused view (switch back to the SAME terminal — a pure view-state flip).
    await act(async () => {
      boardStore.getState().switchTerminal('launch-term-xyz')
    })
    await flush()
    expect(boardStore.getState().viewMode).toBe('focused')

    // The terminal element is the SAME mounted instance throughout (still present, same id).
    const termAfter = r.container.querySelector('[data-testid="embedded-terminal"]')
    expect(termAfter).not.toBeNull()
    expect(termAfter?.getAttribute('data-terminal-id')).toBe('launch-term-xyz')

    // THE ASSERTION: the PTY was NEVER stopped across focused → board → focused. A view switch is
    // not a session stop — the kept-alive terminal must survive (terminal.md / AC-3).
    expect(terminalStopSpy).not.toHaveBeenCalled()
  })
})
