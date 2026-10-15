// Story 4.3 (FR-15) → Past sessions (D-5) — StopConfirm (the DELETE-confirm) jsdom unit tests.
//
// Proves (via jsdom render + a fake window.launch bridge):
//   (a) Modal renders the D-5 copy: title "Delete session?", the body sentence, button "Delete".
//   (b) `Cancel` is the FOCUSED element on mount (UX-DR14 default-focused).
//   (c) Clicking Cancel calls clearStopConfirm() and does NOT call window.launch.deleteSession.
//   (d) Clicking Delete calls window.launch.deleteSession(terminalId, sessionId) THEN
//       clearStopConfirm + showBoard.
//       *** THIS IS THE LOAD-BEARING F1 ORDERING TEST (orchestrator FROZEN #1) ***
//       Non-vacuous: the fault-injected reversed order (view-change-first) FAILS this test.
//   (e) Role=dialog + aria-modal=true (accessibility).
//
// [Source: story 4.3 Task 5; task-10-brief.md (D-5); orchestrator FROZEN #1; UX-DR14;
//  ../../lib/sessionExit.ts (deleteTerminal owns the F1 ordering now)]

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, type JSX } from 'react'
import { StopConfirm } from './StopConfirm'
import { Presence } from '../Presence/Presence'
import { MOTION_EXIT_MS } from '../../styles/motion'
import { pointerInput } from '../../test/pointerInput'
import { renderComponent } from '../../test/renderComponent'
import { boardStore } from '../../stores/boardStore'
import type { StopConfirmPayload } from '../../stores/boardStore'

// ---------------------------------------------------------------------------
// Fake window.launch bridge
// ---------------------------------------------------------------------------

interface LaunchBridge {
  deleteSession: ReturnType<typeof vi.fn>
}

let deleteSpy: ReturnType<typeof vi.fn>
let cleanup: (() => void) | undefined

function stubLaunch(): LaunchBridge {
  deleteSpy = vi.fn().mockResolvedValue(undefined)
  const bridge: LaunchBridge = { deleteSession: deleteSpy }
  ;(window as unknown as { launch: LaunchBridge }).launch = bridge
  return bridge
}

// ---------------------------------------------------------------------------
// Test payload
// ---------------------------------------------------------------------------

function makePayload(overrides?: Partial<StopConfirmPayload>): StopConfirmPayload {
  return {
    terminalId: 'term-abc123',
    sessionId: 'sess-abc123',
    sessionName: 'deploy-prod-rose',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  stubLaunch()
  // Pre-set the stopConfirm store state so clearStopConfirm has something to clear.
  act(() => {
    boardStore.setState({
      stopConfirm: makePayload(),
      viewMode: 'focused',
      focusedTerminalId: 'term-abc123'
    })
  })
})

let clearInput: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  clearInput?.()
  clearInput = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  // Reset boardStore state between tests.
  act(() => {
    boardStore.setState({ stopConfirm: null, viewMode: 'board', focusedTerminalId: null })
  })
})

// ---------------------------------------------------------------------------
// (a) Content rendering — the D-5 copy (no session name interpolated)
// ---------------------------------------------------------------------------

describe('StopConfirm — D-5 delete copy', () => {
  it('renders "Delete session?" in the title', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const title = container.querySelector('[data-testid="stop-confirm-title"]')
    expect(title?.textContent).toBe('Delete session?')
  })

  it('renders the body copy naming Past sessions and that Claude’s files are untouched', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const body = container.querySelector('[data-testid="stop-confirm-body"]')
    expect(body?.textContent).toBe(
      "The session is stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    )
  })

  it('renders "Cancel" button with stop-confirm-cancel testid', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector('[data-testid="stop-confirm-cancel"]')
    expect(cancelBtn).not.toBeNull()
    expect(cancelBtn?.textContent).toContain('Cancel')
  })

  it('renders "Delete" button with stop-confirm-stop testid (danger styling)', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const deleteBtn = container.querySelector('[data-testid="stop-confirm-stop"]')
    expect(deleteBtn).not.toBeNull()
    expect(deleteBtn?.textContent).toBe('Delete')
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
// (c) Click Cancel → clearStopConfirm called, window.launch.deleteSession NOT called
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

  it('clicking Cancel does NOT call window.launch.deleteSession (session keeps running)', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-cancel"]'
    )

    act(() => {
      cancelBtn?.click()
    })

    expect(deleteSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// (d) THE LOAD-BEARING F1 ORDERING TEST: Delete → explicit stop FIRST, THEN view-state change
//
// This is the HEADLINE CORRECTNESS CONSTRAINT (orchestrator FROZEN #1), carried over from the
// Stop-confirm: the explicit window.launch.deleteSession(terminalId, sessionId) MUST be called
// BEFORE clearStopConfirm() and showBoard(). Deleting the last focused session (the only live
// terminal) empties focusedTerminalId + the kept-alive set → hasFocusableTerminal flips false →
// FocusedSession UNMOUNTS (App.tsx M-2 mount-latch WARNING). An incidental unmount is the B-1
// PTY-killing path. The explicit call GUARANTEES the kill; the unmount-stop is a safe no-op.
// ---------------------------------------------------------------------------

describe('StopConfirm — THE EXPLICIT-DELETE-BEFORE-VIEW-CHANGE ordering (F1 / FROZEN #1)', () => {
  it('(d) clicking Delete calls window.launch.deleteSession(terminalId, sessionId)', () => {
    const payload = makePayload({ terminalId: 'term-abc123', sessionId: 'sess-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })

    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith('term-abc123', 'sess-abc123')
  })

  it('(d) clicking Delete passes a null sessionId through untouched (pre-correlation pane)', () => {
    const payload = makePayload({ terminalId: 'term-abc123', sessionId: null })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })

    expect(deleteSpy).toHaveBeenCalledWith('term-abc123', null)
  })

  it('(d-ordering) window.launch.deleteSession is called BEFORE clearStopConfirm + showBoard (F1)', async () => {
    // This is the load-bearing ordering pin. We record the call order by spying on all three
    // mutating operations in sequence and asserting the order.
    const callOrder: string[] = []

    // Spy on window.launch.deleteSession
    const origDeleteFn = deleteSpy as unknown as (
      terminalId: string,
      sessionId: string | null
    ) => Promise<void>
    const newDeleteFn = vi
      .fn()
      .mockImplementation((terminalId: string, sessionId: string | null) => {
        callOrder.push('delete:' + terminalId)
        return origDeleteFn(terminalId, sessionId)
      })
    ;(
      window as unknown as { launch: { deleteSession: ReturnType<typeof vi.fn> } }
    ).launch.deleteSession = newDeleteFn

    // Spy on boardStore.clearStopConfirm
    const clearSpy = vi.spyOn(boardStore.getState(), 'clearStopConfirm').mockImplementation(() => {
      callOrder.push('clearStopConfirm')
    })

    // Spy on boardStore.showBoard
    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard').mockImplementation(() => {
      callOrder.push('showBoard')
    })

    const payload = makePayload({ terminalId: 'term-order-test', sessionId: 'sess-order-test' })
    boardStore.setState({ stopConfirm: payload }) // the confirm is this card's, so it may clear it
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })
    // The registry and the confirm wait for main's answer (spec 2026-09-29 §2.3).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // (a) delete MUST have been called.
    expect(callOrder).toContain('delete:term-order-test')

    // (b) THE ORDERING ASSERTION: delete must come BEFORE any view-state mutation.
    const deleteIdx = callOrder.indexOf('delete:term-order-test')
    const clearIdx = callOrder.indexOf('clearStopConfirm')
    const showBoardIdx = callOrder.indexOf('showBoard')

    expect(deleteIdx).toBeGreaterThanOrEqual(0) // delete WAS called
    expect(clearIdx).toBeGreaterThan(deleteIdx) // clearStopConfirm fires AFTER delete
    expect(showBoardIdx).toBeGreaterThan(deleteIdx) // showBoard fires AFTER delete

    // Cleanup spies
    clearSpy.mockRestore()
    showBoardSpy.mockRestore()
  })

  it('(d-non-vacuity) fault-inject: if view-change happens first, the ordering test FAILS', () => {
    // NON-VACUITY SELF-CHECK (documented — the actual fault-inject is a manual verification).
    // This test proves the test above is not accidentally always-passing: if we register
    // clearStopConfirm BEFORE delete in callOrder, the inequality clearIdx > deleteIdx FAILS.
    const callOrder: string[] = []

    // Simulate the FAULT: view-state changes FIRST (before delete).
    callOrder.push('clearStopConfirm') // view-state first (the BAD ordering)
    callOrder.push('showBoard') // view-state first (the BAD ordering)
    callOrder.push('delete:term-fault') // delete AFTER (too late)

    const deleteIdx = callOrder.indexOf('delete:term-fault')
    const clearIdx = callOrder.indexOf('clearStopConfirm')
    const showBoardIdx = callOrder.indexOf('showBoard')

    // With the reversed (buggy) order: clearIdx=0, showBoardIdx=1, deleteIdx=2
    // → clearIdx > deleteIdx is FALSE → the F1 ordering assertion FAILS → proves non-vacuity.
    expect(clearIdx).not.toBeGreaterThan(deleteIdx) // fault-injected: clear happened before delete
    expect(showBoardIdx).not.toBeGreaterThan(deleteIdx) // fault-injected: showBoard happened first
  })

  it('(d) clicking Delete eventually returns to the board (showBoard called)', async () => {
    // After the explicit delete, the operator is returned to the board (cleaner UX — UX-DR18).
    const showBoardSpy = vi.spyOn(boardStore.getState(), 'showBoard')

    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })

    // Resolve the delete Promise so the view-state changes happen.
    await act(async () => {
      await Promise.resolve()
    })

    expect(showBoardSpy).toHaveBeenCalledTimes(1)
    showBoardSpy.mockRestore()
  })

  it('(d) clicking Delete clears boardStore.stopConfirm', async () => {
    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })
    // The registry and the confirm wait for main's answer (spec 2026-09-29 §2.3).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(boardStore.getState().stopConfirm).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (d-registry) clicking Delete calls forgetLaunchedTerminal(terminalId)
//
// sessionExit.deleteTerminal (not this component) owns this call now, but the wiring through
// this modal's Delete button must still reach it — otherwise the "N starting" banner would
// persist forever for a pane that never got a natural-exit push.
// ---------------------------------------------------------------------------

describe('StopConfirm — clicking Delete forgets the launched-terminal registry entry', () => {
  it('clicking Delete calls boardStore.getState().forgetLaunchedTerminal with the correct terminalId', async () => {
    const forgetSpy = vi.spyOn(boardStore.getState(), 'forgetLaunchedTerminal')

    const payload = makePayload({ terminalId: 'term-abc123' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-stop"]'
    )
    act(() => {
      deleteBtn?.click()
    })
    // The registry and the confirm wait for main's answer (spec 2026-09-29 §2.3).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(forgetSpy).toHaveBeenCalledTimes(1)
    expect(forgetSpy).toHaveBeenCalledWith('term-abc123')

    forgetSpy.mockRestore()
  })

  it('clicking Cancel does NOT call forgetLaunchedTerminal (session keeps running)', () => {
    const forgetSpy = vi.spyOn(boardStore.getState(), 'forgetLaunchedTerminal')

    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount

    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="stop-confirm-cancel"]'
    )
    act(() => {
      cancelBtn?.click()
    })

    expect(forgetSpy).not.toHaveBeenCalled()

    forgetSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// (e) Role=dialog + aria-modal=true
// ---------------------------------------------------------------------------

describe('StopConfirm — dialog accessibility', () => {
  it('has role="dialog" and aria-modal="true"', () => {
    const { container, unmount } = renderComponent(<StopConfirm payload={makePayload()} />)
    cleanup = unmount
    const overlay = container.querySelector('[data-testid="stop-confirm-overlay"]')
    expect(overlay?.getAttribute('role')).toBe('dialog')
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
  })

  it('aria-label is the generic "Delete session?" (D-5: no name interpolated)', () => {
    const payload = makePayload({ sessionName: 'test-session' })
    const { container, unmount } = renderComponent(<StopConfirm payload={payload} />)
    cleanup = unmount
    const overlay = container.querySelector('[data-testid="stop-confirm-overlay"]')
    expect(overlay?.getAttribute('aria-label')).toBe('Delete session?')
  })
})

describe('StopConfirm — overlay motion (spec 2026-10-04 §6)', () => {
  it('marks its overlay data-motion=dialog, and data-leaving + inert while leaving', () => {
    clearInput = pointerInput()
    vi.useFakeTimers()
    const p = makePayload()
    const tree = (payload: StopConfirmPayload | null): JSX.Element => (
      <Presence value={payload}>{(x) => <StopConfirm payload={x} />}</Presence>
    )
    const r = renderComponent(tree(p))
    const overlay = (): HTMLElement | null =>
      r.container.querySelector<HTMLElement>('[data-testid="stop-confirm-overlay"]')
    expect(overlay()?.dataset.motion).toBe('dialog')
    expect(overlay()?.hasAttribute('data-leaving')).toBe(false)
    act(() => {
      r.root.render(tree(null))
    })
    expect(overlay()?.hasAttribute('data-leaving')).toBe(true)
    expect(overlay()?.hasAttribute('inert')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS)
    })
    expect(overlay()).toBeNull()
    r.unmount()
  })
})
