// Story 4.3 (FR-15) → Past sessions (D-3/D-5) — App-level Ctrl+W keydown tests + Esc-confirm
// disambiguation.
//
// A separate file from App.keydown.test.tsx, which covers the quit keys (Ctrl+Q, Esc on the
// guard).
//
// D-3/D-5 made Ctrl+W archive directly; R27 (2026-09-28) took that away — a delete-word typed
// with focus off the terminal archived the session. Ctrl+W now does nothing app-side (the Archive
// button is the only path; App.terminalKeys.test.tsx). Delete is reached only through
// the card's/focused bar's own button, which opens this same confirm modal (boardStore.stopConfirm)
// for the ONE exit that is NOT reversible.
//
// Asserts:
//   (a) Ctrl+W while a session is focused archives NOTHING (R27 — the Archive button is the only
//       path) and leaves stopConfirm null, AND e.preventDefault() fired (window does NOT close).
//   (b) Ctrl+W on the board (viewMode='board') is a no-op (archiveSession NOT called) but
//       preventDefault() still fires (the window does NOT close in any case).
//   (c) Ctrl+W while the Quit-guard is open does NOT archive (single-modal rule UX-DR14).
//   (d) Ctrl+W while a Delete-confirm (stopConfirm) is already open does NOT archive either
//       (single-modal).
//   (e) Esc-while-Delete-confirm-open cancels it (clearStopConfirm) and does NOT also call
//       showBoard (the confirm is the topmost layer; Esc disambiguates).
//   (f) Esc-with-Delete-confirm-open does NOT call window.quit.cancel.
//
// [Source: story 4.3 Task 5; UX-DR14/21; src/renderer/src/App.tsx keydown effect]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { renderApp, resetBoardView, stubAppBridges, unmountApp } from './test/appHarness'
import { boardStore } from './stores/boardStore'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// The window.quit spies (the rest of the fake preload is the shared App harness)
// ---------------------------------------------------------------------------

let cancelSpy: ReturnType<typeof vi.fn>
let guardShow: ((p: QuitGuardPayload) => void) | undefined

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
  resetBoardView()
  cancelSpy = vi.fn().mockResolvedValue(undefined)
  stubAppBridges({
    quit: {
      cancel: cancelSpy,
      onGuardShow: vi.fn((cb: (p: QuitGuardPayload) => void) => {
        guardShow = cb
        return () => {}
      })
    }
  })
})

afterEach(() => {
  unmountApp()
  vi.restoreAllMocks()
  act(() => {
    boardStore.setState({ stopConfirm: null, quitGuard: null })
  })
})

// ---------------------------------------------------------------------------
// (a) Ctrl+W while focused archives NOTHING (R27) + preventDefault fires
// ---------------------------------------------------------------------------

describe('App keydown — Ctrl+W archives NOTHING (R27; was D-3/D-5 Task 10)', () => {
  it('(a) Ctrl+W while focused does NOT archive, opens no confirm, and still preventDefaults', async () => {
    await renderApp()
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
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('(a) Ctrl+W (uppercase W) does NOT archive either', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-w-upper' })
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true }))
      await Promise.resolve()
    })

    expect(window.launch.archiveSession).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // (b) Ctrl+W on the board = no-op (archiveSession NOT called), but preventDefault fires
  // ---------------------------------------------------------------------------

  it('(b) Ctrl+W on the board does NOT archive (no-op)', async () => {
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
    // But nothing was archived.
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // (c) Ctrl+W while Quit-guard is open = single-modal rule (no archive)
  // ---------------------------------------------------------------------------

  it('(c) Ctrl+W while Quit-guard is open does NOT archive (single-modal)', async () => {
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

    // Nothing archived while the Quit-guard is open.
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
    // The Quit-guard stays open.
    expect(boardStore.getState().quitGuard).not.toBeNull()
  })

  // ---------------------------------------------------------------------------
  // (d) Ctrl+W while a Delete-confirm (stopConfirm) is already open = no archive either
  // ---------------------------------------------------------------------------

  it('(d) Ctrl+W while the Delete-confirm is already open does NOT archive', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-already-open' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-already-open',
        sessionId: 'sess-already-open',
        sessionName: 'test'
      })
    })
    const firstConfirm = boardStore.getState().stopConfirm

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }))
      await Promise.resolve()
    })

    // Nothing archived, and the confirm payload is unchanged (no second modal).
    expect(window.launch.archiveSession).not.toHaveBeenCalled()
    expect(boardStore.getState().stopConfirm).toBe(firstConfirm)
  })
})

// ---------------------------------------------------------------------------
// (e) Esc-while-Delete-confirm-open cancels it (clearStopConfirm) + does NOT call showBoard
// ---------------------------------------------------------------------------

describe('App keydown — Esc with the Delete-confirm open (D-5)', () => {
  it('(e) Esc with stopConfirm open clears it', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-test' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-esc-test',
        sessionId: 'sess-esc-test',
        sessionName: 'test'
      })
    })
    expect(boardStore.getState().stopConfirm).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('(e) Esc with stopConfirm open does NOT call showBoard (the confirm is topmost)', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-no-board' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-esc-no-board',
        sessionId: 'sess-esc-no-board',
        sessionName: 'test'
      })
    })

    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve()
    })

    // The confirm's Esc intercepts before showBoard — showBoard must NOT be called.
    expect(showBoardSpy).not.toHaveBeenCalled()
    // Still in focused view (the confirm was dismissed, not the session).
    expect(boardStore.getState().viewMode).toBe('focused')
  })

  // ---------------------------------------------------------------------------
  // (f) Esc-with-Delete-confirm-open does NOT call window.quit.cancel
  // ---------------------------------------------------------------------------

  it('(f) Esc with stopConfirm open does NOT call window.quit.cancel', async () => {
    await renderApp()
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-esc-no-quit' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-esc-no-quit',
        sessionId: 'sess-esc-no-quit',
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

// ---------------------------------------------------------------------------
// R9 — the Delete confirm and the Quit guard are modals too (UX-DR14 single-modal rule)
// ---------------------------------------------------------------------------

describe('App — the Delete confirm and Quit guard join the single-modal rule (R9)', () => {
  function openConfirm(): void {
    act(() => {
      boardStore.setState({ viewMode: 'focused', focusedTerminalId: 'term-r9' })
      boardStore.getState().showStopConfirm({
        terminalId: 'term-r9',
        sessionId: 'sess-r9',
        sessionName: 'r9'
      })
    })
  }

  it('Ctrl+N opens nothing over the Delete confirm', async () => {
    await renderApp()
    openConfirm()
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })
      )
      await Promise.resolve()
    })
    expect(window.launch.pickDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
  })

  it('Ctrl+N opens nothing over the Quit guard', async () => {
    await renderApp()
    act(() => boardStore.getState().showQuitGuard(makeGuardPayload()))
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })
      )
      await Promise.resolve()
    })
    expect(window.launch.pickDirectory).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="new-session-menu"]')).toBeNull()
  })

  it('the header behind the Delete confirm is inert, so Tab cannot walk out to the terminal', async () => {
    const r = await renderApp()
    openConfirm()
    const header = r.container.querySelector('[data-testid="app-header"]')
    expect(header?.hasAttribute('inert')).toBe(true)
  })

  it('the header behind the Quit guard is inert', async () => {
    const r = await renderApp()
    act(() => boardStore.getState().showQuitGuard(makeGuardPayload()))
    const header = r.container.querySelector('[data-testid="app-header"]')
    expect(header?.hasAttribute('inert')).toBe(true)
  })

  it('the Quit guard closes an open Delete confirm (never two stacked)', async () => {
    await renderApp()
    openConfirm()
    act(() => guardShow?.(makeGuardPayload()))
    expect(boardStore.getState().quitGuard).not.toBeNull()
    expect(boardStore.getState().stopConfirm).toBeNull()
  })
})
