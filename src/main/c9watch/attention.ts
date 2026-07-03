// Story 1.2 — the column-transition TRACKER (main process only).
//
// Layered ON TOP of Story 1.1's reducer. It consumes the reducer's already-
// validated, epoch-framed `SessionDelta`s (`session.updated`/`session.removed`)
// plus the reducer's current `Map<id, Session>`, holds each session's CURRENT
// column (keyed by the stable `id`, never `pid`), and emits the entry-transition
// `attention.raised` events. It does NOT re-parse c9watch JSON (parse-once
// boundary): it reads the already-parsed `Session` for the human-facing fields.
//
// never-crash (PRECEDENCE #2): the tracker has NO new external boundary (it reads
// validated data), but one weird session's column change must never take the board
// down — there is no throw path here. never-log-the-parsed-value: the tracker logs
// NOTHING containing a session value; the emitted `attention.raised` carries
// sessionName/projectPath/pendingToolName over IPC BY DESIGN (the contract), but
// those values never hit a log.
//
// FROZEN decisions implemented here (see story Dev Notes — CORRECTED 2026-06-18;
// the prior inverted mapping is SUPERSEDED, contract §4):
//   D1 — three LIVE columns: `working` (Working/Connecting), `needs-you`
//        (NeedsAttention/NeedsPermission/unknown), `idle` (WaitingForInput).
//   D2 — an EXITED session VANISHES. A `session.removed` delta drops the id from
//        the tracker's column map and emits NO synthetic event (the reducer's
//        `session.removed` IS the vanish signal Epic 2 consumes). There is NO
//        "done" column; a present session is never placed in one.
//   D3 — `attention.raised` is LEVEL-TRIGGERED on the `needs-you` ENTRY edge ONLY,
//        not a replay. Entering `idle` or `working` raises NOTHING. The FIRST
//        observation of an id establishes its baseline and SUPPRESSES raises (no
//        launch storm). (The historical reconnect-reconcile re-raise died with the
//        Story-6.4 c9watch retirement: the reducer's epoch is a constant 0 — there is
//        no snapshot reconcile — and a session can only be first-seen via
//        `upsertLaunched`, which is always `Connecting` → working, never needs-you.)
//   D4 — `enteredColumnAt` is stamped via injected `now()` (epoch-millis) on every
//        column change — the UX-DR10 sort key (the SORT/RENDER is Story 1.4).
//   D5 — a short, time-based, injected emission debounce: a session that leaves
//        `needs-you` (into idle OR working) and re-enters within the window has its
//        duplicate raise SUPPRESSED (protects Epic 2 from a notification storm).
//
// [Source: story 1.2 Tasks 2/3; D1-D5; c9watch-0.8.1-contract.md §4;
//  .claude/rules/{zod-boundaries,state,ipc}.md]
import { columnForStatus, type Column } from './columns'
import type { Session } from '../../shared/schemas/session'
import type { AttentionRaisedEvent, ReducerWatchEventsPayload } from '../../shared/ipc/contract'

/** One epoch-framed reducer delta — exactly the `watch:events` payload. The tracker
 *  consumes the reducer's output; the reducer only ever produces session.updated /
 *  session.removed, but the payload type now also admits attention.raised (Story
 *  1.2 widening) — the tracker ignores that case (it is the one PRODUCING it). */
type SessionDelta = ReducerWatchEventsPayload

/** Default emission-debounce window (D5). Short + time-based; injected for tests.
 *  ~700ms collapses a rapid 0↔1 needs-you flap into a single raise without
 *  swallowing a genuine re-entry the operator should hear about. */
export const ATTENTION_DEBOUNCE_MS = 700

/** Per-session tracker state — keyed by the stable `id` (never `pid`). */
interface TrackedColumn {
  /** The session's CURRENT column. */
  column: Column
  /** Epoch-millis the session ENTERED its current column (D4 — UX-DR10 sort key). */
  enteredColumnAt: number
  /** Epoch-millis it last LEFT `needs-you` (into idle OR working), for the D5
   *  debounce. Undefined until it has left needs-you at least once. */
  leftNeedsYouAt?: number
}

export interface AttentionTrackerOptions {
  /** Epoch-millis clock — inject for determinism; defaults to Date.now. */
  now?: () => number
  /** Emission-debounce window in ms (D5). Defaults to ATTENTION_DEBOUNCE_MS. */
  debounceMs?: number
}

export interface AttentionTracker {
  /** Feed ONE reducer delta + the reducer's current map. Returns any
   *  `attention.raised` produced for this edge (empty for working/idle entries and
   *  removals). Never throws. */
  onDelta(delta: SessionDelta, sessionsById: ReadonlyMap<string, Session>): AttentionRaisedEvent[]
  /** The tracked current column for an id (undefined if untracked / removed). */
  columnOf(id: string): Column | undefined
  /** The tracked time-entered-column stamp for an id (undefined if untracked). */
  enteredColumnAt(id: string): number | undefined
}

export function createAttentionTracker(options: AttentionTrackerOptions = {}): AttentionTracker {
  const now = options.now ?? Date.now
  const debounceMs = options.debounceMs ?? ATTENTION_DEBOUNCE_MS

  /** id → tracked column state. Keyed by the stable `id`. */
  const tracked = new Map<string, TrackedColumn>()

  /** Build the frozen `attention.raised` from the already-validated Session (D3).
   *  pendingToolName is included ONLY when present (it is optional on both the
   *  Session and the union — never synthesize one). timestamp = injected now(),
   *  NOT a re-parsed c9watch time. Shape is EXACTLY the frozen union; no extra
   *  fields (privacy — no firstPrompt/latestMessage/pendingToolInput leak). */
  function buildRaised(session: Session, at: number): AttentionRaisedEvent {
    // Build with a spread for the optional field so the shape is fixed in ONE place
    // (canonical under exactOptionalPropertyTypes — no post-construction mutation that
    // could land `string | undefined` into the optional-`string` slot).
    return {
      type: 'attention.raised',
      id: session.id,
      sessionName: session.sessionName,
      projectPath: session.projectPath,
      status: session.status,
      timestamp: at,
      ...(session.pendingToolName !== undefined ? { pendingToolName: session.pendingToolName } : {})
    }
  }

  function onDelta(
    delta: SessionDelta,
    sessionsById: ReadonlyMap<string, Session>
  ): AttentionRaisedEvent[] {
    const { event } = delta

    // D2 — an exited session VANISHES. The reducer's session.removed (from a watch
    // `stopped` line OR absence-from-`list`-reconcile) IS the vanish signal Epic 2
    // consumes. Emit NO synthetic event; just drop the tracked column. There is no
    // "done" column — a present session is never placed in one.
    if (event.type === 'session.removed') {
      tracked.delete(event.id)
      return []
    }

    // The payload type also admits `attention.raised` (Story 1.2 widened
    // WatchEventsPayload), but the tracker is the PRODUCER of those — the reducer it
    // consumes never emits one. Ignore it defensively so a future re-route can't make
    // the tracker react to its own output (no double-raise; never throws).
    if (event.type === 'attention.raised') {
      return []
    }

    // Only session.updated remains (the reducer emits exactly updated/removed). It
    // carries id/sessionName/projectPath/status; the full Session (for pendingToolName)
    // is read from the reducer's already-validated map — parse-once, never re-parsed.
    const id = event.id
    const newColumn = columnForStatus(event.status)
    const prior = tracked.get(id)
    const at = now()

    // First time the tracker sees this id — establish the baseline and SUPPRESS (D3:
    // no launch storm). In the native engine an id can only be first-seen via
    // `upsertLaunched` (always `Connecting` → working; hooks for unknown ids no-op), so
    // a first observation is never a needs-you entry edge anyway.
    if (prior === undefined) {
      tracked.set(id, { column: newColumn, enteredColumnAt: at })
      return []
    }

    // Known id: detect the ENTRY edge against the prior column.
    if (newColumn === prior.column) {
      // No column change → no entry edge (level-triggered on the edge only) and no
      // re-stamp of enteredColumnAt (D4: stamp only on a CHANGE). status may have
      // shifted WITHIN the same column (e.g. NeedsAttention→NeedsPermission, both
      // needs-you) — that is NOT a new entry and must NOT re-raise.
      return []
    }

    // A real column change → stamp the new entry time (D4).
    const fromNeedsYou = prior.column === 'needs-you'
    prior.column = newColumn
    prior.enteredColumnAt = at

    if (newColumn !== 'needs-you') {
      // Entered idle OR working → NO attention event (AC-4: entry into idle/working
      // raises nothing). If we just LEFT needs-you, record the leave time for the D5
      // debounce so a quick bounce back into needs-you is suppressed.
      if (fromNeedsYou) prior.leftNeedsYouAt = at
      return []
    }

    // Entered needs-you from another column (idle or working) → the attention entry
    // edge (D3), subject to the D5 debounce.
    return raiseIfNotDebounced(id, sessionsById, at, prior)
  }

  /** Emit the raise unless a recent leave-then-reenter falls inside the debounce
   *  window (D5). `state` is the tracked entry (its `leftNeedsYouAt` anchors the
   *  window; a session that never left needs-you has none recorded → always raises). */
  function raiseIfNotDebounced(
    id: string,
    sessionsById: ReadonlyMap<string, Session>,
    at: number,
    state: TrackedColumn
  ): AttentionRaisedEvent[] {
    if (state.leftNeedsYouAt !== undefined && at - state.leftNeedsYouAt < debounceMs) {
      // Rapid flap: left needs-you and came back inside the window → suppress the
      // duplicate raise (the operator already has the card surfaced).
      return []
    }
    const session = sessionsById.get(id)
    if (session === undefined) {
      // Defensive: the delta said updated but the map has no session for this id. This
      // should not happen (the reducer sets the map before emitting the delta), but we
      // never throw — skip the raise rather than crash the board. Log the id + a code
      // ONLY (the id is an opaque UUID, never session content) so a missed raise is not
      // an invisible blind spot for Epic-2. [.claude/rules/zod-boundaries.md#Never-log
      // forbids session VALUES/content, not the identity key.]
      console.warn(`[c9watch][tracker] no session in map for raise id=${id} code=session_missing`)
      return []
    }
    return [buildRaised(session, at)]
  }

  return {
    onDelta,
    columnOf: (id) => tracked.get(id)?.column,
    enteredColumnAt: (id) => tracked.get(id)?.enteredColumnAt
  }
}
