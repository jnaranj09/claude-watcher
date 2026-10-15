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
// Renders the real App on the shared App harness (test/appHarness.ts).
//
// [Source: story 4.2 Task 6.4; UX-DR14; UX-DR21; src/renderer/src/App.tsx:167-198
//  (keydown effect); src/renderer/src/App.launch.test.tsx (test pattern reference)]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { unmountRendered } from './test/renderComponent'
import { renderApp, resetBoardView, stubAppBridges } from './test/appHarness'
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
// The window.quit spies (the rest of the fake preload is the shared App harness)
// ---------------------------------------------------------------------------

let requestQuitSpy: ReturnType<typeof vi.fn>
let cancelSpy: ReturnType<typeof vi.fn>

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
  resetBoardView()
  requestQuitSpy = vi.fn().mockResolvedValue(undefined)
  cancelSpy = vi.fn().mockResolvedValue(undefined)
  stubAppBridges({ quit: { requestQuit: requestQuitSpy, cancel: cancelSpy } })
})

afterEach(() => {
  unmountRendered()
  vi.restoreAllMocks()
  // Clear the quitGuard store state between tests.
  act(() => {
    boardStore.setState({ quitGuard: null })
  })
})

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

  // See the design's hazard 1: the guard gained an `!e.altKey` term so the Ctrl+Alt shortcut
  // namespace cannot double-fire the app. Removing that term must turn this red.
  it('Ctrl+Alt+Q does NOT request quit', async () => {
    await renderApp()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, altKey: true }))
      await Promise.resolve()
    })

    expect(requestQuitSpy).not.toHaveBeenCalled()
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
