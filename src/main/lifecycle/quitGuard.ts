// Story 4.2 (FR-14) — the QUIT-DECISION helper (the cancel-safe gate).
//
// THE CANCEL-MUST-NOT-KILL property (FROZEN #1 / B-1-class risk):
//   teardownAllSessions runs ONLY when the quit ACTUALLY PROCEEDS:
//     (a) The operator confirmed "Quit anyway" (quitConfirmed path), OR
//     (b) Nothing live (total === 0 → no guard shown).
//   A CANCELLED quit tears down NOTHING — every PTY stays live.
//
// This helper encapsulates the DECISION, extracted from index.ts so it is unit-testable
// without importing Electron (mirrors teardownAllSessions.ts / computeLiveLaunchedSessions.ts
// as the extract-for-coverage precedent — AR-11). The index.ts before-quit handler calls
// into this helper; the IPC handlers (quitConfirm/quitCancel) call proceed/cancel.
//
// DI seam: inject `teardownAllSessions`, `computeLiveLaunchedSessions`, `pushGuard`, and
// `proceedQuit` so tests can assert behavior via spies without any Electron/node-pty.
//
// the guard WRAPS teardown — a cancelled quit tears down NOTHING (FROZEN #1).
//
// [Source: story 4.2 Task 2; Tasks 6.1; FROZEN #1; AC #5; index.ts:990-996 (the 4-1
//  before-quit → refactored into this ONE combined handler);
//  src/main/lifecycle/teardownAllSessions.ts (REUSE AS-IS; injected here);
//  src/main/lifecycle/computeLiveLaunchedSessions.ts (DI-seamed liveness compute);
//  .claude/rules/state.md (session truth = main)]

import type { TeardownDeps } from './teardownAllSessions'
import type { ComputeDeps, LiveLaunchedSessions } from './computeLiveLaunchedSessions'
import type { QuitGuardPayload } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

/** Injectable dependencies for the quit-guard decision. */
export interface QuitGuardDeps {
  /** The teardown function (REUSE; injected for test isolation). */
  teardownAllSessions: (deps: TeardownDeps) => void
  /** The teardown dependencies (terminal manager, clearTerminalOwners). */
  teardownDeps: TeardownDeps
  /** The liveness compute (injected for test isolation). */
  computeLiveLaunchedSessions: (deps: ComputeDeps) => LiveLaunchedSessions
  /** The liveness compute dependencies (reducers, isLaunched). */
  computeDeps: ComputeDeps
  /**
   * Push the guard payload to the renderer (validate-at-source + wc.isDestroyed() re-check
   * already done by the caller; this is the SEND step). Injected so tests can assert that
   * it is called / not called appropriately.
   */
  pushGuard: (payload: QuitGuardPayload) => void
  /**
   * Proceed with the quit: set isQuitting=true (the re-entrant before-quit short-circuits),
   * call teardownAllSessions, then app.quit(). Injected so tests can assert the call.
   */
  proceedQuit: () => void
}

// ---------------------------------------------------------------------------
// State (mutable; owned by this module for testability)
// ---------------------------------------------------------------------------

/** Mutable guard state — owned per decision context. Exposed for testing. */
export interface QuitGuardState {
  /** True while a real quit is proceeding (the guard passed / nothing-live). Set BEFORE
   *  app.quit() so the re-entrant before-quit short-circuits cleanly. */
  isQuitting: boolean
  /** True while a guard is shown and awaiting the operator's decision. */
  pendingGuard: boolean
}

// ---------------------------------------------------------------------------
// The two entry points called from main
// ---------------------------------------------------------------------------

/**
 * Called from the SINGLE `before-quit` handler (after the isQuitting short-circuit check).
 *
 * Flow:
 *   total === 0 → setIsQuitting(true), teardown, proceedQuit (no guard shown).
 *   total >= 1  → e.preventDefault() is assumed by caller; pushGuard (teardown deferred to confirm).
 *
 * The caller is responsible for: (a) the isQuitting short-circuit BEFORE calling this fn,
 * (b) calling `e.preventDefault()` before calling this fn when total >= 1.
 *
 * Why the caller does (a) and (b): `before-quit` is a Node.js event emitter; we can't pass
 * the event object into this DI-seamed fn without coupling it to Electron. The short-circuit
 * and preventDefault are ONE-LINE index.ts idioms; the DECISION logic (compute → branch) is
 * what lives here for testability.
 *
 * Returns `true` when the guard was shown (caller should have already called preventDefault);
 * returns `false` when the quit proceeds immediately (nothing live).
 */
export function handleBeforeQuit(state: QuitGuardState, deps: QuitGuardDeps): boolean {
  const live = deps.computeLiveLaunchedSessions(deps.computeDeps)

  if (live.total === 0) {
    // Nothing live → proceed immediately, no guard shown.
    state.isQuitting = true
    deps.teardownAllSessions(deps.teardownDeps)
    deps.proceedQuit()
    return false
  }

  // ≥1 live session → show the guard, defer teardown.
  // The caller has already called e.preventDefault() before invoking us.
  state.pendingGuard = true
  deps.pushGuard({
    total: live.total,
    workingCount: live.workingCount,
    sessions: live.sessions
  })
  return true
}

/**
 * Called when the renderer invokes `CH.quitConfirm` ("Quit anyway").
 *
 * No-ops unless a guard is actually pending (`state.pendingGuard === true`). This
 * prevents a buggy/compromised renderer from invoking `CH.quitConfirm` directly and
 * killing every PTY without a guard ever being shown (defense-in-depth gate).
 *
 * When pending: sets isQuitting=true, clears pendingGuard, runs teardown, then
 * proceedQuit. The re-entrant before-quit (triggered by proceedQuit → app.quit()) sees
 * isQuitting=true and short-circuits — teardown is NOT called twice.
 */
export function handleQuitConfirm(state: QuitGuardState, deps: QuitGuardDeps): void {
  if (!state.pendingGuard) {
    // No guard shown — this is a stale or rogue invocation; no-op.
    // (Defense-in-depth: a compromised renderer can't bypass the guard this way.)
    return
  }
  state.isQuitting = true
  state.pendingGuard = false
  deps.teardownAllSessions(deps.teardownDeps)
  deps.proceedQuit()
}

/**
 * Called when the renderer invokes `CH.quitCancel`.
 *
 * No-ops unless a guard is actually pending (`state.pendingGuard === true`). Clears
 * the pending guard. NO teardown — every PTY stays live. The before-quit's
 * e.preventDefault() already aborted THIS quit attempt.
 *
 * the guard WRAPS teardown — a cancelled quit tears down NOTHING (FROZEN #1).
 */
export function handleQuitCancel(state: QuitGuardState): void {
  if (!state.pendingGuard) {
    // No guard shown — this is a stale or rogue invocation; no-op.
    return
  }
  state.pendingGuard = false
  // isQuitting stays false — a future quit attempt re-enters the guard.
  // teardownAllSessions is NOT called here — every PTY stays live (FROZEN #1).
}
