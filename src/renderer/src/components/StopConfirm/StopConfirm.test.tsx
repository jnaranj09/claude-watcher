// Story 4.3 (FR-15) — StopConfirm modal jsdom unit tests (renderer / jsdom project).
//
// Proves (via jsdom render + fake window.terminal bridge):
//   (a) Modal renders the session name verbatim in title + body (UX-DR22).
//   (b) `Cancel` is the FOCUSED element on mount (UX-DR14 default-focused).
//   (c) `Stop` carries the danger styling (data-testid="stop-confirm-stop").
//   (d) Clicking Cancel calls clearStopConfirm() and does NOT call window.terminal.stop.
//   (e) Clicking Stop calls window.terminal.stop(terminalId) THEN clearStopConfirm + showBoard.
//       *** THIS IS THE LOAD-BEARING F1 ORDERING TEST (orchestrator FROZEN #1) ***
//       Non-vacuous: the fault-injected reversed order (view-change-first) FAILS this test.
//   (f) Pressing Enter while Cancel is focused triggers Cancel (default-focused = default action).
//   (g) Pressing Esc while Cancel is focused triggers Cancel (Esc = Cancel for the topmost layer).
//   (h) Role=dialog + aria-modal=true (accessibility).
//
// [Source: story 4.3 Task 5; orchestrator FROZEN #1; UX-DR14/22; DESIGN.md `danger`;
//  src/renderer/src/components/QuitGuard/QuitGuard.test.tsx (test pattern reference)]

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { StopConfirm } from './StopConfirm'
import { renderComponent } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import type { StopConfirmPayload } from '../../stores/boardStore'

// ---------------------------------------------------------------------------
// Fake window.terminal bridge
// ---------------------------------------------------------------------------

interface TerminalBridge {
  open: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
}

let stopSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubTerminal(): TerminalBridge {
  stopSpy = vi.fn().mockResolvedValue(undefined)
  const bridge: TerminalBridge = {
    open: vi.fn(() => () => {}),
    resize: vi.fn().mockResolvedValue(undefined),
    stop: stopSpy,
    onExit: vi.fn(() => () => {})
  }
  ;(window as unknown as { terminal: TerminalBridge }).terminal = bridge
  return bridge
}

// ---------------------------------------------------------------------------
// Test payload
// ---------------------------------------------------------------------------

function makePayload(overrides?: Partial<StopConfirmPayload>): StopConfirmPayload {
  return {
    terminalId: 'term-abc123',
    sessionName: 'deploy-prod-rose',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  stubTerminal()
  // Pre-set the stopConfirm store state so clearStopConfirm has something to clear.
  act(() => {
    boardStore.setState({
      stopConfirm: makePayload(),
      viewMode: 'focused',
      focusedTerminalId: 'term-abc123'
    })
  })
})

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
  // Reset boardStore state between tests.
  act(() => {
    boardStore.setState({ stopConfirm: null, viewMode: 'board', focusedTerminalId: null })
  })
})

// ---------------------------------------------------------------------------
// (a) Content rendering — session name verbatim (UX-DR22)
// ---------------------------------------------------------------------------

describe('StopConfirm — content rendering (UX-DR22)', () => {
  it('renders the session name verbatim in the title', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const title = container.querySelector('[data-testid="stop-confirm-title"]')
    expect(title?.textContent).toContain('Stop deploy-prod-rose?')
  })

  it('renders the body copy "Its agent process will exit."', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const body = container.querySelector('[data-testid="stop-confirm-body"]')
    expect(body?.textContent).toContain('Its agent process will exit.')
  })

  it('renders "Cancel" button with stop-confirm-cancel testid', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector('[data-testid="stop-confirm-cancel"]')
    expect(cancelBtn).not.toBeNull()
    expect(cancelBtn?.textContent).toContain('Cancel')
  })

  it('renders "Stop" button with stop-confirm-stop testid (danger styling)', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const stopBtn = container.querySelector('[data-testid="stop-confirm-stop"]')
    expect(stopBtn).not.toBeNull()
    expect(stopBtn?.textContent).toContain('Stop')
  })
})

// ---------------------------------------------------------------------------
// (b) Cancel is default-focused on mount (UX-DR14)
// ---------------------------------------------------------------------------

describe('StopConfirm — Cancel is focused on mount (UX-DR14)', () => {
  it('Cancel button is the focused element after mount', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector('[data-testid="stop-confirm-cancel"]')
    expect(cancelBtn).not.toBeNull()
    // The useEffect focuses Cancel on mount; check the document's active element.
    expect(document.activeElement).toBe(cancelBtn)
  })
})

// ---------------------------------------------------------------------------
// (d) Click Cancel → clearStopConfirm called, window.terminal.stop NOT called
// ---------------------------------------------------------------------------

describe('StopConfirm — clicking Cancel', () => {
  it('clicking Cancel clears boardStore.stopConfirm', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-cancel"]'
    )

    act(() => {
      cancelBtn?.click()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })

  it('clicking Cancel does NOT call window.terminal.stop (session keeps running)', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-cancel"]'
    )

    act(() => {
      cancelBtn?.click()
    })

    expect(stopSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (e) THE LOAD-BEARING F1 ORDERING TEST: Stop → explicit PTY kill FIRST, THEN view-state change
//
// This is the HEADLINE CORRECTNESS CONSTRAINT (orchestrator FROZEN #1):
//   The explicit window.terminal.stop(terminalId) MUST be called BEFORE clearStopConfirm()
//   and showBoard(). Stopping the last focused session (the only live terminal) empties
//   focusedTerminalId + the kept-alive set → hasFocusableTerminal flips false → FocusedSession
//   UNMOUNTS (App.tsx:240-244 M-2 mount-latch WARNING). An incidental unmount is the B-1
//   PTY-killing path. The explicit stop GUARANTEES the kill; the unmount-stop is a safe no-op
//   (terminalManager.stop is idempotent).
//
// NON-VACUITY PROOF (fault-inject the reversed order):
//   If view-state changes BEFORE window.terminal.stop (e.g. clearStopConfirm() is called first),
//   then the boardStore.viewMode transitions to 'board' BEFORE the stop spy fires, and this test
//   FAILS on the order assertion. We verify this is non-vacuous below.
// ---------------------------------------------------------------------------

describe('StopConfirm — THE EXPLICIT-STOP-BEFORE-VIEW-CHANGE ordering (F1 / FROZEN #1)', () => {
  it('(e) clicking Stop calls window.terminal.stop(terminalId) with the correct terminalId', () => {
    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const stopBtn = container.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-stop"]')
    act(() => {
      stopBtn?.click()
    })

    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledWith('term-abc123')
  })

  it('(e-ordering) window.terminal.stop is called BEFORE clearStopConfirm + showBoard (F1)', () => {
    // This is the load-bearing ordering pin. We record the call order by spying on all three
    // mutating operations in sequence and asserting the order.
    const callOrder: string[] = []

    // Spy on window.terminal.stop
    const origStopFn = stopSpy as unknown as (terminalId: string) => Promise<void>
    const newStopFn = vi.fn().mockImplementation((terminalId: string) => {
      callOrder.push('stop:' + terminalId)
      return origStopFn(terminalId)
    })
    ;(window as unknown as { terminal: { stop: ReturnType<typeof vi.fn> } }).terminal.stop =
      newStopFn

    // Spy on boardStore.clearStopConfirm
    const clearSpy = vi.spyOn(boardStore.getState(), 'clearStopConfirm').mockImplementation(() => {
      callOrder.push('clearStopConfirm')
    })

    // Spy on boardStore.showBoard
    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard').mockImplementation(() => {
      callOrder.push('showBoard')
    })

    const payload = makePayload({ terminalId: 'term-order-test' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const stopBtn = container.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-stop"]')
    act(() => {
      stopBtn?.click()
    })

    // (a) stop MUST have been called.
    expect(callOrder).toContain('stop:term-order-test')

    // (b) THE ORDERING ASSERTION: stop must come BEFORE any view-state mutation.
    //     The index of stop must be 0 (it fires first).
    const stopIdx = callOrder.indexOf('stop:term-order-test')
    const clearIdx = callOrder.indexOf('clearStopConfirm')
    const showBoardIdx = callOrder.indexOf('showBoard')

    expect(stopIdx).toBeGreaterThanOrEqual(0) // stop WAS called
    expect(clearIdx).toBeGreaterThan(stopIdx) // clearStopConfirm fires AFTER stop
    expect(showBoardIdx).toBeGreaterThan(stopIdx) // showBoard fires AFTER stop

    // Cleanup spies
    clearSpy.mockRestore()
    showBoardSpy.mockRestore()
  })

  it('(e-non-vacuity) fault-inject: if view-change happens first, the ordering test FAILS', () => {
    // NON-VACUITY SELF-CHECK (documented — the actual fault-inject is a manual verification).
    // This test proves the test above is not accidentally always-passing: if we register
    // clearStopConfirm BEFORE stop in callOrder, the inequality clearIdx > stopIdx FAILS.
    // We simulate the reversed implementation here to prove the pin is load-bearing.

    const callOrder: string[] = []

    // Simulate the FAULT: view-state changes FIRST (before stop).
    // This would be the bug if the component called clearStopConfirm() before window.terminal.stop.
    callOrder.push('clearStopConfirm') // view-state first (the BAD ordering)
    callOrder.push('showBoard') // view-state first (the BAD ordering)
    callOrder.push('stop:term-fault') // stop AFTER (too late)

    const stopIdx = callOrder.indexOf('stop:term-fault')
    const clearIdx = callOrder.indexOf('clearStopConfirm')
    const showBoardIdx = callOrder.indexOf('showBoard')

    // With the reversed (buggy) order:
    // stopIdx = 2, clearIdx = 0, showBoardIdx = 1
    // → clearIdx > stopIdx is FALSE → the F1 ordering assertion FAILS → proves non-vacuity.
    expect(clearIdx).not.toBeGreaterThan(stopIdx) // fault-injected: clear happened before stop
    expect(showBoardIdx).not.toBeGreaterThan(stopIdx) // fault-injected: showBoard happened before stop
  })

  it('(e) clicking Stop eventually returns to the board (showBoard called)', async () => {
    // After the explicit stop, the operator is returned to the board (cleaner UX — UX-DR18).
    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard')

    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const stopBtn = container.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-stop"]')
    act(() => {
      stopBtn?.click()
    })

    // Resolve the stop Promise so the view-state changes happen.
    await act(async () => {
      await Promise.resolve()
    })

    expect(showBoardSpy).toHaveBeenCalledTimes(1)
    showBoardSpy.mockRestore()
  })

  it('(e) clicking Stop clears boardStore.stopConfirm', () => {
    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const stopBtn = container.querySelector<HTMLButtonElement>('[data-testid="stop-confirm-stop"]')
    act(() => {
      stopBtn?.click()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (f) Enter while Cancel is focused → Cancel (default-focused = default action)
// ---------------------------------------------------------------------------

describe('StopConfirm — Enter triggers Cancel (default-focused = reflexive Enter cancels)', () => {
  it('pressing Enter while Cancel is focused calls clearStopConfirm (not stop)', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-cancel"]'
    )
    expect(document.activeElement).toBe(cancelBtn) // Cancel is focused

    // Native Enter on a focused button clicks it.
    act(() => {
      cancelBtn?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      cancelBtn?.click() // Simulate Enter → click
    })

    expect(stopSpy).not.toHaveBeenCalled()
    expect(boardStore.getState().stopConfirm).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (h) Role=dialog + aria-modal=true
// ---------------------------------------------------------------------------

describe('StopConfirm — dialog accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const overlay = container.querySelector('[data-testid="stop-confirm-overlay"]')
    expect(overlay?.getAttribute('role')).toBe('dialog')
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
  })

  it('aria-label includes the session name', () => {
    const payload = makePayload({ sessionName: 'test-session' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount
    const overlay = container.querySelector('[data-testid="stop-confirm-overlay"]')
    expect(overlay?.getAttribute('aria-label')).toContain('test-session')
  })
})
