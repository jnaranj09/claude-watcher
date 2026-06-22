// Story 1.1 — the c9watch REDUCER (main process only).
//
// Folds validated `watch` deltas + `list` snapshots into the authoritative
// `Map<string, Session>` keyed by the STABLE `id` (never `pid`). This is the
// session source of truth (.claude/rules/state.md: "Session truth = the MAIN
// process"). It owns:
//   - the JSON + Zod boundary for `watch` NDJSON lines (fail-closed: drop+log a
//     bad line by PATH/CODE only, never the value — one bad line never poisons the
//     stream),
//   - the three FROZEN reducer decisions R1/R2/R3 (see Story 1.1 Dev Notes),
//   - `list` snapshot seed/reconcile with a MONOTONIC epoch + diff-not-replay,
//   - producing typed session deltas (frozen `session.updated`/`session.removed`,
//     epoch-framed) for the renderer.
//
// It does NOT spawn anything (that is feed.ts) and does NOT emit `attention.raised`
// or compute columns (that is Story 1.2). Determinism: `now()` is injected; nothing
// reads the wall clock. [Source: story 1.1 Tasks 2/3; architecture.md#c9watch
// Adapter; .claude/rules/{zod-boundaries,state,ipc}.md]
import {
  WatchLineSchema,
  WatchStopLineSchema,
  parseListKeyedById,
  type Session
} from '../../shared/schemas/session'
import type {
  ReducerSessionUpdatedEvent,
  SessionRemovedEvent,
  ReducerWatchEventsPayload
} from '../../shared/ipc/contract'

/** A boundary failure record — PATH + CODE only, NEVER the parsed/raw value.
 *  (A ZodError stringifies its INPUT, which can carry PTY content / prompts /
 *  secrets. .claude/rules/zod-boundaries.md#Never-log-the-parsed-value.) */
export interface BoundaryErrorRecord {
  /** Where the failure happened (Zod issue path joined by '.', or a marker). */
  path: string
  /** The issue code (e.g. 'invalid_type', 'invalid_json', 'unknown_id_changed'). */
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

/** The public reducer surface consumed by feed.ts, main/index.ts, and tests. */
export interface Reducer {
  /** Parse + validate + apply ONE raw `watch` NDJSON line; returns the deltas it
   *  produced (empty if the line was dropped or was a no-op). Never throws. */
  applyLine(rawLine: string): SessionDelta[]
  /** Parse a `list` snapshot (THROWS on a malformed envelope — the caller decides
   *  reconnect/back-off), bump the monotonic epoch, diff vs the current map, and
   *  return the reconcile deltas. Idempotent: re-applying the same snapshot
   *  converges to the same map and emits no deltas. */
  seedFromSnapshot(raw: unknown): { deltas: SessionDelta[]; epoch: number }
  /** Like seedFromSnapshot but also returns the freshly-parsed id-keyed map (a
   *  convenience for tests/seed inspection). Same throw semantics. */
  seedFromSnapshotRaw(raw: unknown): {
    deltas: SessionDelta[]
    epoch: number
    sessionsById: Map<string, Session>
  }
  /** A defensive COPY of the current authoritative map. */
  snapshotMap(): Map<string, Session>
  /** Current session count. */
  size(): number
  /** The current monotonic epoch (0 before the first snapshot). */
  epoch(): number
  /** Epoch-millis stamp of the last applied delta (null before any apply). */
  lastAppliedAt(): number | null
}

/** Default boundary-error sink — logs PATH + CODE only (never the value). */
function defaultLog(err: BoundaryErrorRecord): void {
  console.warn(`[c9watch][reducer] dropped line path=${err.path} code=${err.code}`)
}

/** Parse JSON WITHOUT ever letting the value leak. A bare `JSON.parse` of a
 *  malformed line throws a V8 `SyntaxError` whose message can EMBED a window of the
 *  raw input (which carries prompts / PTY content / secrets). So we swallow it and
 *  return a value-free failure marker. Mirrors the Story-0.5 `parseJsonOrDrift`.
 *  [.claude/rules/zod-boundaries.md#Never-log; deferred-work.md 0.5 patch #1] */
function parseJsonValueFree(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

/** Build a `session.updated` delta from a parsed Session (validate-at-source: the
 *  data is already parsed, so we shape it to the frozen union — NOT a re-parse). */
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
 *  facing fields when available (a lean stop may carry none); falls back to the id
 *  with empty human fields if the session was never in the map. */
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
  let currentEpoch = 0
  let lastApplied: number | null = null

  function frame(event: ReducerSessionUpdatedEvent | SessionRemovedEvent): SessionDelta {
    return { epoch: currentEpoch, event }
  }

  function applyLine(rawLine: string): SessionDelta[] {
    // 1) JSON boundary — a corrupt/truncated line is dropped + logged by marker.
    const parsed = parseJsonValueFree(rawLine)
    if (!parsed.ok) {
      log({ path: '(line)', code: 'invalid_json' })
      return []
    }
    const json = parsed.value

    // The line must be a non-null object before we can read `.event` from it. A line
    // that is valid JSON but NOT an object (`null`, an array, a number/string/bool)
    // is a malformation → fail closed (drop + log). NOTE `null` specifically: reading
    // `.event` off `null` throws a TypeError, which would escape applyLine (its
    // contract says it NEVER throws) and propagate out of the unguarded stdout 'data'
    // handler in feed.ts — an uncaught main-process crash from one bad line. Guard it.
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      log({ path: '(line)', code: 'not_an_object' })
      return []
    }

    // Peek the event WITHOUT trusting the rest of the shape: `stopped` routes to the
    // lean-stop path (R2) so a minimal stop still removes the card; everything else
    // goes through the strict full schema. SAFE cast: `json` is now a non-null object
    // and we read ONLY `event` (typed `unknown`) for routing — the full schema
    // re-validates every field below before any value is consumed, so no type
    // information is laundered.
    const event = (json as { event?: unknown }).event

    if (event === 'stopped') {
      return applyStop(json)
    }

    // 2) Schema boundary (started/changed) — strict full WatchLineSchema.
    const result = WatchLineSchema.safeParse(json)
    if (!result.success) {
      const issue = result.error.issues[0]
      log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
      return []
    }
    const line = result.data

    // R3 — top-level sessionId must equal the inner session.id for started/changed.
    // A disagreement is a known-key inconsistency → DROP + log (do not guess which
    // is authoritative; picking wrong keys a card under the wrong identity).
    if (line.sessionId !== line.session.id) {
      log({ path: 'sessionId', code: 'id_mismatch' })
      return []
    }

    // R1 — apply per event semantics. `WatchLineSchema.event` is typed
    // `'started' | 'changed' | 'status_changed' | 'stopped'`, but `stopped` was
    // already routed to `applyStop` above (peek at line ~145), so only
    // `started`/`changed`/`status_changed` reach here.
    // We branch EXPLICITLY on each accepted value so a future schema/routing drift
    // cannot silently fold an unexpected event into the update path (the reviewer's
    // H2 concern). `status_changed` is the real c9watch 0.8.1 event value for live
    // transitions; `changed` is kept as a harmless alias (Story 5.2).
    const session = line.session
    if (line.event === 'started') {
      // a started event is the genuine birth of a session → upsert.
      map.set(session.id, session)
      lastApplied = now()
      return [frame(toUpdated(session))]
    }

    if (line.event === 'changed' || line.event === 'status_changed') {
      if (!map.has(session.id)) {
        // DESYNC: a `changed`/`status_changed` for an id we have no baseline for
        // (missed its `started`, e.g. across a gap). Do NOT invent a card from a
        // partial signal — the next `list` reconcile heals it idempotently +
        // level-triggered. DROP + log.
        log({ path: '(desync)', code: 'unknown_id_changed' })
        return []
      }
      map.set(session.id, session) // normal update
      lastApplied = now()
      return [frame(toUpdated(session))]
    }

    // Unreachable in production: `stopped` was peeled off before the strict parse,
    // and the enum admits only `started | changed | status_changed` here (stopped
    // already routed to applyStop). Fail closed (drop + log) rather than silently
    // misroute, should routing/schema ever drift apart.
    log({ path: 'event', code: 'unexpected_event' })
    return []
  }

  /** R2 — a LEAN `stopped` line: delete keyed off the TOP-LEVEL `sessionId`, never
   *  the inner session body (which may fail the full SessionSchema). */
  function applyStop(json: unknown): SessionDelta[] {
    const result = WatchStopLineSchema.safeParse(json)
    if (!result.success) {
      // missing/blank top-level sessionId → nothing to delete → drop + log.
      const issue = result.error.issues[0]
      log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
      return []
    }
    const { sessionId, session } = result.data

    // R3 (stop variant): a mismatch between the routing sessionId and the inner
    // session.id is still LOGGED, but the delete keys off the authoritative
    // top-level sessionId (R2) — a stale Done card lingering is the worse state.
    if (session?.id !== undefined && session.id !== sessionId) {
      log({ path: 'sessionId', code: 'id_mismatch' })
    }

    if (!map.has(sessionId)) {
      // already gone (idempotent — e.g. a stop arriving twice, or after a reconcile
      // already removed it). Not an error; emit nothing.
      return []
    }
    const known = map.get(sessionId)
    map.delete(sessionId)
    lastApplied = now()
    return [frame(toRemoved(sessionId, known))]
  }

  function seedFromSnapshotRaw(raw: unknown): {
    deltas: SessionDelta[]
    epoch: number
    sessionsById: Map<string, Session>
  } {
    // `list` boundary: a malformed snapshot THROWS (parseListKeyedById) — the caller
    // decides reconnect/back-off. This is the correct per-boundary failure mode
    // (different from a watch line, which drops). [.claude/rules/zod-boundaries.md]
    const { sessionsById } = parseListKeyedById(raw)

    // Monotonic epoch: only ever increases. We derive it from the injected clock but
    // GUARANTEE strict monotonicity even if now() returns an equal/earlier value
    // (deterministic tests inject a FIXED now()), so each reconcile is distinguishable.
    currentEpoch = Math.max(currentEpoch + 1, now())

    const deltas: SessionDelta[] = []

    // Reconcile = diff (added/updated/removed), NOT blind replay. Idempotent: an
    // unchanged session emits no delta, so re-applying the same snapshot converges.
    for (const [id, fresh] of sessionsById) {
      const prev = map.get(id)
      if (prev === undefined) {
        map.set(id, fresh)
        deltas.push(frame(toUpdated(fresh))) // added
      } else if (!sessionEquivalent(prev, fresh)) {
        map.set(id, fresh)
        deltas.push(frame(toUpdated(fresh))) // updated
      }
      // else: unchanged → no delta (idempotent apply).
    }

    // A session present in the map but ABSENT from the fresh list is removed —
    // this is how a stop missed across a reconnect gap is healed level-triggered.
    for (const id of [...map.keys()]) {
      if (!sessionsById.has(id)) {
        const known = map.get(id)
        map.delete(id)
        deltas.push(frame(toRemoved(id, known)))
      }
    }

    if (deltas.length > 0) lastApplied = now()
    return { deltas, epoch: currentEpoch, sessionsById }
  }

  function seedFromSnapshot(raw: unknown): { deltas: SessionDelta[]; epoch: number } {
    const { deltas, epoch } = seedFromSnapshotRaw(raw)
    return { deltas, epoch }
  }

  return {
    applyLine,
    seedFromSnapshot,
    seedFromSnapshotRaw,
    snapshotMap: () => new Map(map),
    size: () => map.size,
    epoch: () => currentEpoch,
    lastAppliedAt: () => lastApplied
  }
}

/** Structural equivalence for reconcile diffing. The renderer only renders the
 *  fields the delta carries (id/sessionName/projectPath/status) PLUS the reducer
 *  keeps the FULL session in its map; we compare the full session by value so any
 *  field change (e.g. latestMessage, pendingToolName) triggers an update. We avoid
 *  logging/serializing the value anywhere — this comparison is in-memory only. */
function sessionEquivalent(a: Session, b: Session): boolean {
  // The sessions are already-parsed plain objects (parse-once boundary). A stable
  // structural compare over their JSON is sufficient and keeps the diff cheap +
  // deterministic. (Never logged — this string never leaves memory.)
  return stableStringify(a) === stableStringify(b)
}

/** Deterministic JSON with sorted keys (so key-order does not spuriously diff). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = obj[k]
          return acc
        }, {})
    }
    return val
  })
}
