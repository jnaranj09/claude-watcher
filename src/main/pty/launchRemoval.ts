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

/** The launch-service surface the Delete needs: the binding pair plus the durable override's
 *  memory of the id the terminal was LAST bound to (structurally satisfied by `LaunchService` —
 *  `LaunchOverride.lastSessionId`, which `unbind` never clears). */
export interface LastSessionSource extends LaunchBindingSource {
  peekSpawnOverride(terminalId: string): { lastSessionId: string | null } | null
}

/**
 * Past sessions (D-3/D-4) — the `CH.sessionDelete` path. Stop the terminal and remove its bound
 * card with the `delete` reason (`removeSession` → the owning window's
 * `removeLaunched(…, 'delete')`, which drops any record for that id), exactly like an Archive but
 * for the reason. THEN drop the history record of the id this terminal last ran, via
 * `removeRecord`.
 *
 * That second step is the only thing that reaches a pane whose claude already EXITED: its exit
 * archived the card and consumed the binding, so `removeSession` never fires, and the renderer —
 * whose card is gone — no longer knows the id either. The launch override does
 * (`lastSessionId`, moved by `rebind` on `/clear`). `hintSessionId` is the renderer's own id for
 * the pane, removed too; every removal here is idempotent, so a live pane that already dropped
 * its record through `removeSession` loses nothing twice.
 */
export function deleteTerminalSession(
  terminalId: string,
  hintSessionId: string | null,
  manager: StoppableTerminalManager,
  launch: LastSessionSource | null,
  removeSession: (sessionId: string) => void,
  removeRecord: (sessionId: string) => void
): void {
  stopTerminalAndRemoveBound(terminalId, undefined, manager, launch, removeSession)
  const recordIds = new Set<string>()
  const last = launch?.peekSpawnOverride(terminalId)?.lastSessionId ?? null
  if (last !== null) recordIds.add(last)
  if (hintSessionId !== null) recordIds.add(hintSessionId)
  for (const id of recordIds) removeRecord(id)
}

/** The launch-service surface `archiveBoundSessions` needs: the binding pair plus the snapshot of
 *  every live binding (structurally satisfied by `LaunchService`). */
export interface BoundSessionsSource extends LaunchBindingSource {
  bindings(): ReadonlyArray<{ terminalId: string; sessionId: string }>
}

/**
 * Past sessions (D-3) — ARCHIVE every bound launched session, for the paths that end sessions
 * WITHOUT an onExit: the app quit (`teardownAllSessions` → `terminalManager.destroyAll()`) and a
 * window close (`teardownWindowTerminals` → `terminalManager.stop()`). Both tear the pty down
 * with its exit listener already disposed, so the pty-exit archive never runs; this step runs
 * FIRST, while the reducer still holds each card and `terminalOwners` still routes to its seam.
 *
 * Each binding goes through `removeBoundSession` (unbind FIRST, then `archiveSession`), so it is
 * idempotent: a second run finds nothing bound and archives nothing, and the store upserts by id
 * anyway. `include` narrows it to one window's terminals (the window-close path).
 *
 * NEVER THROWS — it sits on the quit path, which must always go ahead. A failure on one session is
 * logged by CODE only (never the session id, a name or a path) and the others still archive.
 * Returns the archived session ids.
 */
export function archiveBoundSessions(
  launch: BoundSessionsSource | null,
  archiveSession: (terminalId: string, sessionId: string) => void,
  log: (message: string) => void,
  include: (terminalId: string) => boolean = () => true
): string[] {
  if (launch === null) return []
  const failed = (): void => log('[claude-watcher][past-sessions] code=teardown_archive_failed')
  let bound: ReadonlyArray<{ terminalId: string }>
  try {
    bound = launch.bindings()
  } catch {
    failed()
    return []
  }
  const archived: string[] = []
  for (const { terminalId } of bound) {
    try {
      if (!include(terminalId)) continue
      const id = removeBoundSession(terminalId, launch, (sessionId) =>
        archiveSession(terminalId, sessionId)
      )
      if (id !== null) archived.push(id)
    } catch {
      failed()
    }
  }
  return archived
}
