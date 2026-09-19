// Story 6.3 — FAST REMOVAL: stopping (CH.terminalStop) or exiting (terminalManager onExit)
// a launched terminal removes its board card IMMEDIATELY — no dependency on any external
// event (no SessionEnd hook, no c9watch `stopped` line, no staleness sweep).
//
// This module is the extracted, injectable REMOVAL DECISION so it is unit-testable without
// Electron (index.ts wiring itself is untestable in main-unit). index.ts wires it twice:
//   - the CH.terminalStop handler → `stopTerminalAndRemoveBound` (stop + gated removal),
//   - the terminalManager onExit callback → `removeBoundSession` (the pty already died —
//     the double-ctrl+c case; no gate needed).
// The `removeSession` callback is the per-window routing seam: index.ts resolves the owning
// window and dispatches `reducer.applyHookStatus(id, { kind: 'removed' })` deltas through the
// SAME handleDelta chokepoint every c9watch/hook delta rides (REUSE — no new reducer API).
//
// IDEMPOTENT BY CONSTRUCTION: the binding is cleared (unbind) BEFORE the removal is
// dispatched, so a second trigger for the same terminal resolves no binding and no-ops, and
// a later belt-and-suspenders SessionEnd hook for the already-removed id emits [] silently
// (the reducer's removed-path treats an unknown id as "already gone", mirroring applyStop).
// [Source: spec-native-session-engine.md Story 6.3; .claude/rules/state.md one-way flow]

/** Past sessions (D-3) — why a card leaves the board. `archive` writes a history record (the
 *  default: Stop/Archive, Ctrl+C twice, `/exit`, a pty exit, a late SessionEnd); `delete` writes
 *  none and removes any earlier record for that id (after the Delete confirm). */
export type RemovalReason = 'archive' | 'delete'

/** The minimal launch-service surface the removal needs (structurally satisfied by
 *  `LaunchService` — see launchSession.ts `sessionIdFor`/`unbind`). */
export interface LaunchBindingSource {
  /** The exact terminalId → sessionId binding from the most recent actual spawn. */
  sessionIdFor(terminalId: string): string | null
  /** Clear the binding once a removal consumed it (idempotent). */
  unbind(terminalId: string): void
}

/** The minimal terminal-manager surface the stop path needs (structurally satisfied by
 *  `TerminalManager` — see terminalManager.ts `has`/`stop`). */
export interface StoppableTerminalManager {
  has(terminalId: string): boolean
  /** Story 5.6 token-aware stop: a provided-but-stale openToken is a NO-OP. */
  stop(terminalId: string, openToken?: string): void
}

/**
 * Remove the launched session bound to `terminalId` (the pty is ALREADY gone — natural exit,
 * or a stop that verifiably landed). Resolves the exact spawn-time binding, clears it FIRST
 * (so a re-entrant/second trigger no-ops), then hands the sessionId to `removeSession`
 * (index.ts routes it through the owning window's reducer → handleDelta → `session.removed`).
 *
 * Returns the removed sessionId, or null when there was nothing bound (a plain-shell
 * terminal, a never-minted launch, or an already-consumed binding). Never throws for a
 * missing binding — removal is idempotent.
 */
export function removeBoundSession(
  terminalId: string,
  launch: LaunchBindingSource,
  removeSession: (sessionId: string) => void
): string | null {
  const sessionId = launch.sessionIdFor(terminalId)
  if (sessionId === null) return null
  launch.unbind(terminalId)
  removeSession(sessionId)
  return sessionId
}

/**
 * The CH.terminalStop path: stop the terminal, then remove the bound launched session IFF
 * THIS stop actually tore the pty down. The gate is decisive against the two no-removal
 * stops:
 *   - a STALE-TOKEN stop (a superseded StrictMode dev cleanup-stop — Story 5.6): the manager
 *     no-ops and the terminal stays live → the surviving mount's card MUST stay;
 *   - an ALREADY-DEAD terminal (the pty exited earlier): the onExit path already removed +
 *     unbound → nothing to do here.
 * Both are detected by the live-before/live-after check around the (synchronous) stop call.
 *
 * `launch` may be null (a stop racing app-ready before the launch service exists) — the stop
 * still executes; only the removal is skipped. Returns the removed sessionId or null.
 */
export function stopTerminalAndRemoveBound(
  terminalId: string,
  openToken: string | undefined,
  manager: StoppableTerminalManager,
  launch: LaunchBindingSource | null,
  removeSession: (sessionId: string) => void
): string | null {
  const wasLive = manager.has(terminalId)
  manager.stop(terminalId, openToken)
  if (!wasLive || manager.has(terminalId)) return null // already-dead OR stale-token no-op
  if (launch === null) return null
  return removeBoundSession(terminalId, launch, removeSession)
}
