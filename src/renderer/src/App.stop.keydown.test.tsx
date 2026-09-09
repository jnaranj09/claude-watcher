// Story 4.3 (FR-15) — App-level Ctrl+W keydown tests + Esc-Stop-confirm disambiguation.
//
// A NEW test file (rather than extending App.keydown.test.tsx) to avoid touching the green 4-2
// guardrail tests. The 4-2 App.keydown.test.tsx assertions STAY UNCHANGED.
//
// Asserts:
//   (a) Ctrl+W while a session is focused opens the Stop-confirm (showStopConfirm called /
//       boardStore.stopConfirm is non-null) AND e.preventDefault() fired (window does NOT close).
//   (b) Ctrl+W on the board (viewMode='board') is a no-op (stopConfirm stays null) but
//       preventDefault() still fires (the window does NOT close in any case).
//   (c) Ctrl+W while the Quit-guard is open does NOT open a second modal (single-modal rule
//       UX-DR14; stopConfirm stays null).
//   (d) Ctrl+W while a Stop-confirm is already open does NOT open a second one (single-modal).
//   (e) Esc-while-Stop-confirm-open cancels the Stop-confirm (clearStopConfirm) and does NOT
//       also call showBoard (the Stop-confirm is the topmost layer; Esc disambiguates).
//   (f) Esc-with-Stop-confirm-open does NOT call window.quit.cancel.
//
// Does NOT modify App.keydown.test.tsx (the B-1 guardrail for 4-2 must stay unchanged — F6).
//
// [Source: story 4.3 Task 5; UX-DR14/21; src/renderer/src/App.tsx keydown effect;
//  src/renderer/src/App.keydown.test.tsx (pattern reference — DO NOT MODIFY)]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from './test/renderComponent'
import App from './App'
import { boardStore } from './stores/boardStore'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

// ---------------------------------------------------------------------------
// Fake window bridges (same pattern as App.keydown.test.tsx)
// ---------------------------------------------------------------------------

interface QuitBridge {
  requestQuit: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
  onGuardShow: (cb: (p: QuitGuardPayload) => void) => () => void
}

let cancelSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubQuit(): void {
  cancelSpy = vi.fn().mockResolvedValue(undefined)
  const bridge: QuitBridge = {
    requestQuit: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
    confirm: vi.fn().mockResolvedValue(undefined) as unknown as () => Promise<void>,
    cancel: cancelSpy as unknown as () => Promise<void>,
    onGuardShow: vi.fn(() => () => {})
  }
  ;(window as unknown as { quit: QuitBridge }).quit = bridge
}

function makeGuardPayload(): QuitGuardPayload {
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
  // Reset the singleton store between tests.
  boardStore.setState({
    viewMode: 'board',
    focusedTerminalId: null,
    selectedId: null,
    sessionsById: {},
    acknowledgedById: {},
    terminalIdBySessionId: {},
    quitGuard: null,
    stopConfirm: null
  })

  // xterm shims (jsdom omits these)
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

  // Minimal window bridge shims
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
    launch: vi.fn(() => Promise.resolve({ terminalId: 'term-1', workspaceId: 'default' })),
    launchFromTemplate: vi.fn(() =>
      Promise.resolve({ terminalId: 'term-1', workspaceId: 'default' })
    ),
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
  act(() => {
    boardStore.setState({ stopConfirm: null, quitGuard: null })
  })
})

async function renderApp(): Promise<RenderResult> {
  const r = renderComponent(<App />)
  cleanup = r.unmount
  await flush() // resolve smokeConfig → board view
  return r
}

// ---------------------------------------------------------------------------
// (a) Ctrl+W while focused opens the Stop-confirm + preventDefault fires
// ---------------------------------------------------------------------------

describe('App keydown — Ctrl+W (Story 4.3 Task 5)', () => {
  it('(a) Ctrl+W while focused opens the Stop-confirm (stopConfirm !== null)', async () => {
    await renderApp()
    // Enter the focused view with a known terminal.
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-ctrl-w' })
    })

    let preventDefaultCalled = false
    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true })
    Object.defineProperty(event, 'preventDefault', {
      value: () => {
        preventDefaultCalled = true
      }
    })

    await act(async () => {
      window.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(preventDefaultCalled).toBe(true)
    expect(boardStore.getState().stopConfirm).not.toBeNull()
    expect(boardStore.getState().stopConfirm?.terminalId).toBe('term-ctrl-w')
  })

  // Hazard 1 again: Ctrl+Alt+W must not open the Stop-confirm now that Ctrl+Alt is the
  // phrase-shortcut namespace.
  it('(a) Ctrl+Alt+W does NOT open the Stop-confirm', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-ctrl-alt-w' })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, altKey: true }))
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('(a) Ctrl+W (uppercase W) also opens the Stop-confirm', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-w-upper' })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm).not.toBeNull()
  })

  it('(a) Ctrl+W includes the focused terminalId in the Stop-confirm payload', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-payload-check' })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm?.terminalId).toBe('term-payload-check')
  })

  // ---------------------------------------------------------------------------
  // (b) Ctrl+W on the board = no-op (stopConfirm stays null), but preventDefault fires
  // ---------------------------------------------------------------------------

  it('(b) Ctrl+W on the board does NOT open the Stop-confirm (no-op)', async () => {
    await renderApp()
    // Ensure we are on the board.
    expect(boardStore.getState().viewMode).toBe('board')

    let preventDefaultCalled = false
    const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true })
    Object.defineProperty(event, 'preventDefault', {
      value: () => {
        preventDefaultCalled = true
      }
    })

    await act(async () => {
      window.dispatchEvent(event)
      await Promise.resolve()
    })

    // preventDefault still fires (window NEVER closes on Ctrl+W — UX-DR21).
    expect(preventDefaultCalled).toBe(true)
    // But the modal does NOT open.
    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // (c) Ctrl+W while Quit-guard is open = single-modal rule (stopConfirm stays null)
  // ---------------------------------------------------------------------------

  it('(c) Ctrl+W while Quit-guard is open does NOT open Stop-confirm (single-modal)', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-guard-open' })
      boardStore.getState().showQuitGuard(makeGuardPayload())
    })
    expect(boardStore.getState().quitGuard).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }))
      await Promise.resolve()
    })

    // Stop-confirm must NOT open while the Quit-guard is open.
    expect(boardStore.getState().stopConfirm).toBeNull()
    // The Quit-guard stays open.
    expect(boardStore.getState().quitGuard).not.toBeNull()
  })

  // ---------------------------------------------------------------------------
  // (d) Ctrl+W while Stop-confirm already open = no second modal
  // ---------------------------------------------------------------------------

  it('(d) Ctrl+W while Stop-confirm is already open does NOT open a second one', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-already-open' })
      boardStore
        .getState()
        .showStopConfirm({ terminalId: 'term-already-open', sessionName: 'test' })
    })
    const firstConfirm = boardStore.getState().stopConfirm

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }))
      await Promise.resolve()
    })

    // The stopConfirm payload must be unchanged (no second modal).
    expect(boardStore.getState().stopConfirm).toBe(firstConfirm)
  })
})

// ---------------------------------------------------------------------------
// (e) Esc-while-Stop-confirm-open cancels it (clearStopConfirm) + does NOT call showBoard
// ---------------------------------------------------------------------------

describe('App keydown — Esc with Stop-confirm open (Story 4.3)', () => {
  it('(e) Esc with stopConfirm open clears the Stop-confirm', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-test' })
      boardStore.getState().showStopConfirm({ terminalId: 'term-esc-test', sessionName: 'test' })
    })
    expect(boardStore.getState().stopConfirm).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('(e) Esc with stopConfirm open does NOT call showBoard (Stop-confirm is topmost)', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-no-board' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-esc-no-board',
        sessionName: 'test'
      })
    })

    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    // Stop-confirm Esc intercepts before showBoard — showBoard must NOT be called.
    expect(showBoardSpy).not.toHaveBeenCalled()
    // Still in focused view (the Stop-confirm was dismissed, not the session).
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  // ---------------------------------------------------------------------------
  // (f) Esc-with-Stop-confirm-open does NOT call window.quit.cancel
  // ---------------------------------------------------------------------------

  it('(f) Esc with stopConfirm open does NOT call window.quit.cancel', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-no-quit' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-esc-no-quit',
        sessionName: 'test'
      })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(cancelSpy).not.toHaveBeenCalled()
  })
})
