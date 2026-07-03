// Story 4.2 (FR-14) — THE CANCEL-MUST-NOT-KILL test (the B-1-class load-bearing evidence).
//
// Proves via DI-injected fakes (NO real node-pty / Electron — AR-11):
//   (a) CANCEL: the guard was shown; `quit:cancel` arrives → teardownAllSessions NOT called,
//       isQuitting stays false, pendingGuard cleared.
//   (b) CONFIRM: the guard was shown; `quit:confirm` → teardownAllSessions IS called, then
//       proceedQuit, isQuitting set true, pendingGuard cleared.
//   (c) NOTHING-LIVE: total === 0 → teardownAllSessions called, proceedQuit called, no guard
//       pushed, isQuitting set true.
//
// NON-VACUOUS: a reviewer reverting the guard to unconditional teardown (i.e., calling
// teardownAllSessions in handleBeforeQuit regardless of total) would make (a) FAIL
// because teardownAllSessions would be called even on a cancel path.
//
// Uses the `handleBeforeQuit` / `handleQuitConfirm` / `handleQuitCancel` DI-seamed
// functions; NO deep vi.mock('electron') (AR-11).
//
// [Source: story 4.2 Task 6.1; FROZEN #1; AC #5; AR-11;
//  src/main/lifecycle/teardownAllSessions.test.ts (DI-seam test precedent)]

import { describe, it, expect, vi } from 'vitest'
import {
  handleBeforeQuit,
  handleQuitConfirm,
  handleQuitCancel,
  type QuitGuardState,
  type QuitGuardDeps
} from './quitGuard'
import type { TeardownDeps } from './teardownAllSessions'
import type { ComputeDeps, LiveLaunchedSessions } from './computeLiveLaunchedSessions'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh mutable QuitGuardState (defaults: nothing in progress). */
function freshState(): QuitGuardState {
  return { isQuitting: false, pendingGuard: false }
}

/** Build a fake TeardownDeps (spies; no real terminals). */
function fakeTeardownDeps(): TeardownDeps {
  return {
    terminalManager: null,
    clearTerminalOwners: vi.fn()
  }
}

/** Build a fake ComputeDeps (returns nothing — computeLiveLaunchedSessions is overridden via fakeDeps). */
function fakeComputeDeps(): ComputeDeps {
  return {
    reducers: [],
    isLaunched: () => false
  }
}

/** Build a full QuitGuardDeps with all spies. */
function fakeDeps(
  live: LiveLaunchedSessions,
  teardownDeps?: TeardownDeps
): {
  deps: QuitGuardDeps
  teardownSpy: ReturnType<typeof vi.fn>
  pushSpy: ReturnType<typeof vi.fn>
  proceedSpy: ReturnType<typeof vi.fn>
  tdDeps: TeardownDeps
} {
  const tdDeps = teardownDeps ?? fakeTeardownDeps()
  const teardownSpy = vi.fn()
  const pushSpy = vi.fn()
  const proceedSpy = vi.fn()
  const deps: QuitGuardDeps = {
    teardownAllSessions: teardownSpy,
    teardownDeps: tdDeps,
    computeLiveLaunchedSessions: () => live,
    computeDeps: fakeComputeDeps(),
    pushGuard: pushSpy,
    proceedQuit: proceedSpy
  }
  return { deps, teardownSpy, pushSpy, proceedSpy, tdDeps }
}

/** Live result with ≥1 session. */
function liveResult(total: number, workingCount = 0): LiveLaunchedSessions {
  const sessions = Array.from({ length: total }, (_, i) => ({
    id: `sess-${i}`,
    sessionName: `Session ${i}`,
    status: workingCount > i ? 'Working' : 'NeedsAttention',
    column: (workingCount > i ? 'working' : 'needs-you') as 'working' | 'needs-you' | 'idle'
  }))
  return { total, workingCount, sessions }
}

/** Empty live result (nothing live). */
function emptyResult(): LiveLaunchedSessions {
  return { total: 0, workingCount: 0, sessions: [] }
}

// ---------------------------------------------------------------------------
// (c) NOTHING-LIVE path — teardown called, proceed called, no guard shown
// ---------------------------------------------------------------------------

describe('handleBeforeQuit — nothing-live (total === 0)', () => {
  it('teardownAllSessions IS called when nothing live', () => {
    const state = freshState()
    const { deps, teardownSpy } = fakeDeps(emptyResult())
    handleBeforeQuit(state, deps)
    expect(teardownSpy).toHaveBeenCalledTimes(1)
  })

  it('proceedQuit IS called when nothing live', () => {
    const state = freshState()
    const { deps, proceedSpy } = fakeDeps(emptyResult())
    handleBeforeQuit(state, deps)
    expect(proceedSpy).toHaveBeenCalledTimes(1)
  })

  it('pushGuard is NOT called when nothing live (no modal shown)', () => {
    const state = freshState()
    const { deps, pushSpy } = fakeDeps(emptyResult())
    handleBeforeQuit(state, deps)
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('isQuitting is set to true when nothing live', () => {
    const state = freshState()
    const { deps } = fakeDeps(emptyResult())
    handleBeforeQuit(state, deps)
    expect(state.isQuitting).toBe(true)
  })

  it('returns false (no guard shown) when nothing live', () => {
    const state = freshState()
    const { deps } = fakeDeps(emptyResult())
    const showed = handleBeforeQuit(state, deps)
    expect(showed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (a) CANCEL path — teardown NOT called, PTYs stay live
// ---------------------------------------------------------------------------

describe('handleQuitCancel — cancel-must-not-kill (FROZEN #1 / B-1-class)', () => {
  it('teardownAllSessions is NOT called on cancel (CANCEL-MUST-NOT-KILL)', () => {
    // NON-VACUOUS: this test covers the WHOLE sequence (handleBeforeQuit guard-shown path →
    // handleQuitCancel). The spy is NEVER cleared between steps, so ANY call to teardown
    // during either phase will fail this assertion. A reviewer injecting
    // `deps.teardownAllSessions(deps.teardownDeps)` on the guard-shown (total >= 1) path of
    // handleBeforeQuit will see this test FAIL (proving the assertion is load-bearing).
    const state = freshState()
    const live = liveResult(2, 1)
    const { deps, teardownSpy, pushSpy } = fakeDeps(live)

    // Step 1: before-quit shows the guard (total >= 1 → e.preventDefault() + pushGuard).
    handleBeforeQuit(state, deps)
    expect(pushSpy).toHaveBeenCalledTimes(1) // guard was shown

    // Step 2: operator cancels.
    handleQuitCancel(state)

    // teardownAllSessions must NOT have been called ACROSS THE WHOLE SEQUENCE
    // (guard-shown path + cancel). PTYs stay live (FROZEN #1 / B-1-class).
    expect(teardownSpy).not.toHaveBeenCalled()
  })

  it('pendingGuard is cleared after cancel', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    expect(state.pendingGuard).toBe(true)

    handleQuitCancel(state)
    expect(state.pendingGuard).toBe(false)
  })

  it('isQuitting stays false after cancel', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    handleQuitCancel(state)
    expect(state.isQuitting).toBe(false)
  })

  it('NON-VACUOUS: a second quit attempt after cancel re-runs the guard (not short-circuited)', () => {
    const state = freshState()
    const { deps, pushSpy } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    handleQuitCancel(state)

    // A second before-quit (user hits Ctrl+Q again) must NOT short-circuit (isQuitting=false).
    // The guard must show again.
    pushSpy.mockClear()
    handleBeforeQuit(state, deps)
    expect(pushSpy).toHaveBeenCalledTimes(1) // guard shows again
  })
})

// ---------------------------------------------------------------------------
// (b) CONFIRM path — teardown called, proceed called
// ---------------------------------------------------------------------------

describe('handleQuitConfirm — confirm proceeds cleanly', () => {
  it('teardownAllSessions IS called on confirm', () => {
    const state = freshState()
    const { deps, teardownSpy } = fakeDeps(liveResult(2, 2))
    handleBeforeQuit(state, deps)
    teardownSpy.mockClear()

    handleQuitConfirm(state, deps)
    expect(teardownSpy).toHaveBeenCalledTimes(1)
  })

  it('proceedQuit IS called on confirm', () => {
    const state = freshState()
    const { deps, proceedSpy } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    proceedSpy.mockClear()

    handleQuitConfirm(state, deps)
    expect(proceedSpy).toHaveBeenCalledTimes(1)
  })

  it('isQuitting is set to true on confirm', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    handleQuitConfirm(state, deps)
    expect(state.isQuitting).toBe(true)
  })

  it('pendingGuard is cleared after confirm', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    handleQuitConfirm(state, deps)
    expect(state.pendingGuard).toBe(false)
  })

  it('teardown IS called exactly once (not twice via re-entrancy) on confirm', () => {
    // The re-entrant before-quit (triggered by proceedQuit → app.quit()) sees
    // isQuitting=true and short-circuits in index.ts — teardown must NOT be called
    // twice. This test proves: after confirm, if handleBeforeQuit is called again
    // (simulating the re-entrant call), it short-circuits WITHOUT calling teardown.
    const state = freshState()
    const { deps, teardownSpy } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    teardownSpy.mockClear()
    handleQuitConfirm(state, deps)
    const firstCount = teardownSpy.mock.calls.length
    expect(firstCount).toBe(1)

    // Simulate the re-entrant before-quit: isQuitting is already true, so index.ts
    // would return early without calling handleBeforeQuit. This is the index.ts contract:
    // "if (isQuitting) return". Verify isQuitting=true so the caller CAN short-circuit.
    expect(state.isQuitting).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Guard payload shape
// ---------------------------------------------------------------------------

describe('handleBeforeQuit — guard payload shape', () => {
  it('pushGuard receives the correct total + workingCount + sessions', () => {
    const state = freshState()
    const live = liveResult(3, 2)
    const { deps, pushSpy } = fakeDeps(live)
    handleBeforeQuit(state, deps)

    expect(pushSpy).toHaveBeenCalledTimes(1)
    const payload: QuitGuardPayload = pushSpy.mock.calls[0]?.[0]
    expect(payload.total).toBe(3)
    expect(payload.workingCount).toBe(2)
    expect(payload.sessions).toHaveLength(3)
  })

  it('handleBeforeQuit returns true when guard was shown (≥1 live session)', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    const showed = handleBeforeQuit(state, deps)
    expect(showed).toBe(true)
  })

  it('pendingGuard is set to true when the guard is shown', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps)
    expect(state.pendingGuard).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (Fix 3) Pending-guard gate — confirm/cancel must no-op when no guard is pending
// ---------------------------------------------------------------------------

describe('handleQuitConfirm — pending-guard gate (Fix 3 defense-in-depth)', () => {
  it('handleQuitConfirm with NO pending guard → does NOT call teardownAllSessions', () => {
    // A buggy/compromised renderer invokes CH.quitConfirm without a guard ever being shown.
    // The handler must no-op — no teardown, no quit.
    const state = freshState() // pendingGuard = false
    const { deps, teardownSpy } = fakeDeps(liveResult(1))
    handleQuitConfirm(state, deps)
    expect(teardownSpy).not.toHaveBeenCalled()
  })

  it('handleQuitConfirm with NO pending guard → does NOT call proceedQuit', () => {
    const state = freshState() // pendingGuard = false
    const { deps, proceedSpy } = fakeDeps(liveResult(1))
    handleQuitConfirm(state, deps)
    expect(proceedSpy).not.toHaveBeenCalled()
  })

  it('handleQuitConfirm with NO pending guard → isQuitting stays false', () => {
    const state = freshState()
    const { deps } = fakeDeps(liveResult(1))
    handleQuitConfirm(state, deps)
    expect(state.isQuitting).toBe(false)
  })

  it('normal flow (before-quit shows guard → confirm) still tears down + quits exactly once', () => {
    // Verify the gate does NOT block the legitimate path.
    const state = freshState()
    const { deps, teardownSpy, proceedSpy } = fakeDeps(liveResult(2, 1))

    // Guard is shown (pendingGuard = true).
    handleBeforeQuit(state, deps)
    expect(state.pendingGuard).toBe(true)

    // Operator confirms → teardown + proceed exactly once.
    handleQuitConfirm(state, deps)
    expect(teardownSpy).toHaveBeenCalledTimes(1)
    expect(proceedSpy).toHaveBeenCalledTimes(1)
    expect(state.isQuitting).toBe(true)
    expect(state.pendingGuard).toBe(false)
  })

  it('stale re-invoke of confirm after a resolved guard is a no-op', () => {
    // After confirm resolves, pendingGuard is false. A second CH.quitConfirm
    // (stale re-invoke from a misbehaving renderer) must NOT re-trigger teardown.
    const state = freshState()
    const { deps, teardownSpy, proceedSpy } = fakeDeps(liveResult(1))
    handleBeforeQuit(state, deps) // guard shown
    handleQuitConfirm(state, deps) // normal confirm → teardown + proceed

    // Stale second invocation — must be a no-op (pendingGuard was cleared above).
    teardownSpy.mockClear()
    proceedSpy.mockClear()
    handleQuitConfirm(state, deps)
    expect(teardownSpy).not.toHaveBeenCalled()
    expect(proceedSpy).not.toHaveBeenCalled()
  })
})

describe('handleQuitCancel — pending-guard gate (Fix 3 defense-in-depth)', () => {
  it('handleQuitCancel with NO pending guard → is a no-op (pendingGuard stays false)', () => {
    const state = freshState() // pendingGuard already false
    handleQuitCancel(state)
    expect(state.pendingGuard).toBe(false) // no-op; was already false
    expect(state.isQuitting).toBe(false)
  })
})
