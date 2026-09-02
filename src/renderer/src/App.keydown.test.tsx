// Story 4.2 (FR-14) — App-level keydown tests (Task 6.4).
//
// Tests the App.tsx global keydown handler for quit-related key events (non-smoke mode).
// These were explicitly deferred from QuitGuard.test.tsx with "the App-level keydown test
// (Task 6.4)" — this IS that test.
//
// Asserts:
//   (a) Ctrl+Q calls window.quit.requestQuit() (the ONE quit chokepoint — renderer → main).
//   (b) Esc WITH the guard open (quitGuard !== null) calls window.quit.cancel() +
//       clearQuitGuard() and does NOT call showBoard (guard intercepts Esc).
//   (c) Esc WITH the guard closed calls showBoard (the existing Focused→Board behavior)
//       and does NOT call window.quit.cancel.
//
// Does NOT modify App.launch.test.tsx (the B-1 guardrail must stay unchanged — AR-12).
//
// Mirrors App.launch.test.tsx patterns (window bridge stubs, renderComponent, flush).
//
// [Source: story 4.2 Task 6.4; UX-DR14; UX-DR21; src/renderer/src/App.tsx:167-198
//  (keydown effect); src/renderer/src/App.launch.test.tsx (test pattern reference)]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a microtask/Promise chain inside act() so async effects settle before asserting. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// Fake window.quit bridge
// ---------------------------------------------------------------------------

interface QuitBridge {
  requestQuit: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
  onGuardShow: (cb: (p: QuitGuardPayload) => void) => () => void
}

let requestQuitSpy: ReturnType<typeof vi.fn>
let cancelSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubQuit(): void {
  requestQuitSpy = vi.fn().mockResolvedValue(undefined)
  cancelSpy = vi.fn().mockResolvedValue(undefined)
  const bridge: QuitBridge = {
    requestQuit: requestQuitSpy as unknown as () => Promise<void>,
    confirm: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
    cancel: cancelSpy as unknown as () => Promise<void>,
    onGuardShow: vi.fn(() => () => {})
  }
  ;(window as unknown as { quit: QuitBridge }).quit = bridge
}

// ---------------------------------------------------------------------------
// Sample guard payload (for tests that need the guard to be open)
// ---------------------------------------------------------------------------

function makePayload(): QuitGuardPayload {
  return {
    total: 1,
    workingCount: 1,
    sessions: [{ id: 'sess-1', sessionName: 'deploy-prod', status: 'Working', column: 'working' }]
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset the singleton store view-state between tests.
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    quitGuard: null
  })

  // xterm assumes a real browser: shim matchMedia + ResizeObserver (jsdom omits both)
  // so EmbeddedTerminal can mount in the focused view (mirrors App.launch.test.tsx).
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

  // Minimal window bridge shims (mirrors App.launch.test.tsx).
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
  ;(window as unknown as { terminal: unknown }).terminal = {
    open: vi.fn(() => () => {}),
    resize: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { launch: unknown }).launch = {
    pickDirectory: vi.fn(() => Promise.resolve(null)),
    launch: vi.fn(() => Promise.resolve({ terminalId: 'term-1' })),
    launchFromTemplate: vi.fn(() => Promise.resolve({ terminalId: 'term-1' })),
    onCorrelated: vi.fn(() => () => {}),
    markSeen: vi.fn(() => Promise.resolve(undefined))
  }
  // Session templates: loadTemplates() now runs on every App mount — stub it so it never
  // console.warns a code (App.templates.test.tsx amendment #2).
  ;(window as unknown as { templates: unknown }).templates = {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(),
    remove: vi.fn()
  }
  stubQuit()

  window.location.hash = ''
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Clear the quitGuard store state between tests.
  act(() => {
    boardStore.setState({ quitGuard: null })
  })
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush() // resolve smokeConfig → board view
  return r
}

// ---------------------------------------------------------------------------
// (a) Ctrl+Q calls window.quit.requestQuit()
// ---------------------------------------------------------------------------

describe('App keydown — Ctrl+Q (Task 6.4a)', () => {
  it('Ctrl+Q calls window.quit.requestQuit()', async () => {
    await renderApp()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(requestQuitSpy).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Q (uppercase Q) also calls window.quit.requestQuit()', async () => {
    await renderApp()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Q', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(requestQuitSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// (b) Esc WITH the guard open → cancel the guard, NOT showBoard
// ---------------------------------------------------------------------------

describe('App keydown — Esc with guard open (Task 6.4b)', () => {
  it('Esc with quitGuard open calls window.quit.cancel()', async () => {
    await renderApp()
    // Pre-open the guard via store.
    act(() => {
      boardStore.getState().showQuitGuard(makePayload())
    })
    expect(boardStore.getState().quitGuard).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })

  it('Esc with quitGuard open clears the guard (clearQuitGuard)', async () => {
    await renderApp()
    act(() => {
      boardStore.getState().showQuitGuard(makePayload())
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(boardStore.getState().quitGuard).toBeNull()
  })

  it('Esc with quitGuard open does NOT call showBoard (guard intercepts Esc)', async () => {
    await renderApp()
    // Enter focused view first so showBoard would have a visible effect.
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-x' })
    })
    // Now open the guard.
    act(() => {
      boardStore.getState().showQuitGuard(makePayload())
    })

    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    // Guard intercepts Esc — showBoard must NOT be called.
    expect(showBoardSpy).not.toHaveBeenCalled()
    // Still in focused view (guard was dismissed but viewMode unchanged — the cancel
    // is a quit abort, not a Board navigation).
    expect(boardStore.getState().viewMode).toBe('focused')
  })
})

// ---------------------------------------------------------------------------
// (c) Esc WITH the guard closed → showBoard (the existing Focused→Board behavior)
// ---------------------------------------------------------------------------

describe('App keydown — Esc with guard closed (Task 6.4c)', () => {
  it('Esc with quitGuard closed calls showBoard (Focused→Board navigation)', async () => {
    await renderApp()
    // Enter focused view.
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-x' })
    })
    // Confirm guard is closed.
    expect(boardStore.getState().quitGuard).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()

    // showBoard navigates back to the board.
    expect(boardStore.getState().viewMode).toBe('board')
  })

  it('Esc with quitGuard closed does NOT call window.quit.cancel', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-x' })
    })
    expect(boardStore.getState().quitGuard).toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await flush()

    expect(cancelSpy).not.toHaveBeenCalled()
  })
})
