// The SESSION REDUCER (main process only) — the authoritative `Map<id, Session>`.
//
// Story 6.4 (native session engine): the c9watch CLI is RETIRED. This module no longer
// parses NDJSON watch lines or `list` snapshots — sessions are born at SPAWN TIME
// (`upsertLaunched`, the Story-6.2 launch-minted `--session-id` identity) and every later
// status transition or removal is HOOK-driven (`applyHookStatus`, fed by the :9279 hook
// ingest) or stop/exit-driven (the Story-6.3 fast removal, which rides the same removed
// path). The directory name `c9watch/` is historical.
//
// The reducer remains the session source of truth (.claude/rules/state.md: "Session
// truth = the MAIN process") and still produces the typed, epoch-framed session deltas
// (frozen `session.updated`/`session.removed`) the renderer consumes. With no snapshot
// reconcile the epoch never advances (a constant 0) — the framing stays purely for the
// renderer's stale-discard contract. Determinism: `now()` is injected; nothing reads
// the wall clock. [Source: spec-native-session-engine.md Story 6.4;
// .claude/rules/{zod-boundaries,state,ipc}.md]
import type { Session } from '../../shared/schemas/session'
import type {
  ReducerSessionUpdatedEvent,
  SessionRemovedEvent,
  ReducerWatchEventsPayload
} from '../../shared/ipc/contract'

/**
 * The discriminated union of hook-driven status changes. Exported so `hookStatus.ts`
 * can import the input contract without the reducer importing the hooks layer.
 * (consistent-type-imports: import type only — the reducer must NOT be a runtime
 * dependency of the hooks layer.)
 */
export type HookStatusChange = { kind: 'status'; status: string } | { kind: 'removed' }

/** A boundary failure record — PATH + CODE only, NEVER the parsed/raw value.
 *  (A ZodError stringifies its INPUT, which can carry PTY content / prompts /
 *  secrets. .claude/rules/zod-boundaries.md#Never-log-the-parsed-value.) */
export interface BoundaryErrorRecord {
  /** Where the failure happened (Zod issue path joined by '.', or a marker). */
  path: string
  /** The issue code (e.g. 'hook_unknown_id'). */
  code: string
}

/** A single epoch-framed session delta — the BARE reducer payload (pre-enrichment).
 *  Story 1.4: the reducer produces the bare `session.updated`; main's `enrichDelta`
 *  ship stage upgrades it to the enriched renderer-facing `WatchEventsPayload`. */
export type SessionDelta = ReducerWatchEventsPayload

/** Options for the reducer factory. `now()` is injected for determinism. */
export interface ReducerOptions {
  /** Epoch-millis clock — inject for deterministic tests; defaults to Date.now. */
  now?: () => number
  /** Boundary-error sink — receives PATH + CODE only. Defaults to a console log. */
  log?: (err: BoundaryErrorRecord) => void
}

/** The public reducer surface consumed by main/index.ts and tests. */
export interface Reducer {
  /**
   * Apply a hook-driven status change (or session removal) for a known session `id`.
   * Returns the deltas produced (a single `session.updated` or `session.removed`).
   *
   * IMPORTANT: unknown `id` + `kind: 'status'` → returns `[]` + logs
   * `{ path: '(hook)', code: 'hook_unknown_id' }`. Hook signals are authority over STATUS
   * for an already-known (app-launched) session only; they must NOT synthesize a card for
   * an unknown session — external sessions stay off the board (Story 3.3 ship gate; the
   * native engine has NO external discovery by design).
   *
   * Unknown `id` + `kind: 'removed'` → returns `[]` SILENTLY (no log). Story 6.3: removal is
   * idempotent — the stop/exit fast-removal path (index.ts) usually beats the belt-and-
   * suspenders SessionEnd hook here, and removing an already-gone id is the
   * "already gone" no-op, not an error (one removal, zero noise).
   */
  applyHookStatus(id: string, change: HookStatusChange): SessionDelta[]
  /**
   * Story 6.2 — synthesize/refresh an APP-LAUNCHED session at spawn time (the launch-minted
   * `--session-id` identity). The input is MAIN-INTERNAL data — main constructed it from values
   * it owns (the launch service's minted uuid, the picked cwd, the pty pid) — NOT external
   * input, so it is deliberately NOT re-run through `SessionSchema` (parse-once boundary:
   * construct a valid `Session` at the call site; re-validation is unsupported by design).
   *
   * UPSERT semantics (deliberate): an unknown `id` INSERTS; an EXISTING `id` is a NORMAL
   * update — never a throw (a Reopen re-spawn under the same frame is a refresh, not an
   * error). The upsert REPLACES the stored session wholesale — a fresh spawn's `Connecting`
   * is the new truth; hooks own every later transition.
   *
   * Emits ONE epoch-framed `session.updated` (the same delta shape every consumer knows)
   * for the caller to route through the SAME `handleDelta` chokepoint (tracker → enrich →
   * ship gate).
   */
  upsertLaunched(session: Session): SessionDelta[]
  /**
   * Session-naming A2 — rename an EXISTING session. Swaps `sessionName` and NOTHING else.
   *
   * Unknown `id` → returns `[]` + logs `{ path: '(rename)', code: 'rename_unknown_id' }`,
   * mirroring the `hook_unknown_id` no-op: a rename must never SYNTHESIZE a card (that would
   * put a session on the board that was never launched by this app — the Story-3.3 ship gate).
   * A rename racing a stop/exit that already removed the card is therefore a quiet no-op.
   *
   * Known `id` → emits ONE `session.updated` through the same `toUpdated`. Deliberately NOT a
   * new delta type: every consumer already reads `sessionName` off that delta, so the rename
   * needs no renderer-side plumbing beyond the existing store reducer.
   *
   * DOES NOT REORDER THE BOARD. `enteredColumnAt` is stamped by `attention.ts` only on a COLUMN
   * change, and this re-emits with an UNCHANGED status — so the sort key survives. Do not add a
   * re-stamp here; a rename is not a state transition.
   *
   * `name` arrives already validated + trimmed by `SessionNameSchema` at the IPC boundary. It is
   * OPERATOR CONTENT — never logged (the unknown-id log above carries a marker path, no value).
   */
  renameSession(id: string, name: string): SessionDelta[]
  /** A defensive COPY of the current authoritative map. */
  snapshotMap(): Map<string, Session>
  /** Current session count. */
  size(): number
  /** The current epoch (a constant 0 in the native engine — kept for the delta-framing
   *  contract the renderer's stale-discard relies on). */
  epoch(): number
  /** Epoch-millis stamp of the last applied delta (null before any apply). */
  lastAppliedAt(): number | null
}

/** Default boundary-error sink — logs PATH + CODE only (never the value). */
function defaultLog(err: BoundaryErrorRecord): void {
  console.warn(`[c9watch][reducer] dropped path=${err.path} code=${err.code}`)
}

/** Build a `session.updated` delta from a Session (validate-at-source: the data is
 *  main-owned/already-validated, so we shape it to the frozen union — NOT a re-parse). */
function toUpdated(session: Session): ReducerSessionUpdatedEvent {
  return {
    type: 'session.updated',
    id: session.id,
    sessionName: session.sessionName,
    projectPath: session.projectPath,
    status: session.status
  }
}

/** Build a `session.removed` delta. Uses the LAST-KNOWN session for the human-
 *  facing fields when available; falls back to the id with empty human fields if
 *  the session was never in the map. */
function toRemoved(id: string, known: Session | undefined): SessionRemovedEvent {
  return {
    type: 'session.removed',
    id,
    sessionName: known?.sessionName ?? '',
    projectPath: known?.projectPath ?? ''
  }
}

export function createReducer(options: ReducerOptions = {}): Reducer {
  const now = options.now ?? Date.now
  const log = options.log ?? defaultLog

  const map = new Map<string, Session>()
  // The epoch is a CONSTANT 0 in the native engine (no snapshot reconcile ever bumps
  // it). Kept in the frame so the renderer's `payload.epoch < state.epoch` stale-drop
  // contract is untouched (0 < 0 is false → every delta applies).
  const currentEpoch = 0
  let lastApplied: number | null = null

  function frame(event: ReducerSessionUpdatedEvent | SessionRemovedEvent): SessionDelta {
    return { epoch: currentEpoch, event }
  }

  /**
   * Apply a hook-driven status change for a KNOWN session.
   * Unknown id + status → return [] + log hook_unknown_id (deliberate no-upsert — see interface).
   * Unknown id + removed → return [] silently (Story 6.3 idempotent removal — see interface).
   */
  function applyHookStatus(id: string, change: HookStatusChange): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      // Story 6.3 — removing an already-gone id is the idempotent no-op (emit nothing,
      // LOG nothing): the stop/exit fast-removal usually beats the SessionEnd hook here,
      // and that late hook must be quiet, not an error.
      if (change.kind === 'removed') return []
      // Unknown id + status: no-op + log. Path = '(hook)' marks the hook boundary.
      log({ path: '(hook)', code: 'hook_unknown_id' })
      return []
    }

    if (change.kind === 'removed') {
      // SessionEnd / stop / exit: remove the session from the map and emit session.removed.
      map.delete(id)
      lastApplied = now()
      return [frame(toRemoved(id, stored))]
    }

    // kind === 'status': hooks own the status — update it, keep the other fields.
    const updated: Session = { ...stored, status: change.status }
    map.set(id, updated)
    lastApplied = now()
    return [frame(toUpdated(updated))]
  }

  /**
   * Story 6.2 — upsert an app-launched session (main-internal input; see the interface doc).
   * Insert-or-replace keyed on the stable `id`; a same-id re-upsert is a normal update.
   */
  function upsertLaunched(session: Session): SessionDelta[] {
    map.set(session.id, session)
    lastApplied = now()
    return [frame(toUpdated(session))]
  }

  /**
   * Session-naming A2 — swap an existing session's `sessionName` (see the interface doc).
   * Unknown id → [] + log rename_unknown_id (never synthesize a card from a rename).
   */
  function renameSession(id: string, name: string): SessionDelta[] {
    const stored = map.get(id)
    if (stored === undefined) {
      // Path = '(rename)' marks the boundary; the NAME is operator content and never logged.
      log({ path: '(rename)', code: 'rename_unknown_id' })
      return []
    }

    // `sessionName` ONLY. Spreading `stored` keeps status/projectPath/pid untouched, which is what
    // makes this safe to emit through `toUpdated` without disturbing the column or the sort key.
    const renamed: Session = { ...stored, sessionName: name }
    map.set(id, renamed)
    lastApplied = now()
    return [frame(toUpdated(renamed))]
  }

  return {
    applyHookStatus,
    upsertLaunched,
    renameSession,
    // A defensive copy so callers can never mutate the authoritative map.
    snapshotMap: (): Map<string, Session> => new Map(map),
    size: () => map.size,
    epoch: () => currentEpoch,
    lastAppliedAt: () => lastApplied
  }
}
