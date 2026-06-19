// Story 0.2 — the Zod identity adapter for the c9watch session boundary.
//
// This is the app's hardest external dependency (PRD §9): c9watch's schema can
// drift. We validate at THIS single boundary and infer the TS type from the
// schema (one source of truth). [Source: architecture.md#Layer 1; #Enforcement]
//
// Load-bearing decisions (Critical Guardrails):
//   - `.passthrough()` so c9watch ADDITIONS pass; only malformations of KNOWN
//     keys fail-closed.
//   - Time = epoch millis internally; coerce ISO-8601 -> millis ONCE here via
//     `.transform()`, never per-call.
//   - Key sessions by the stable `id` (UUID), NEVER by `pid` (pid is a wandering
//     claude thread id, not identity).
//   - NEVER log a parsed value / ZodError input — it can leak PTY content. Log
//     error path + code only.
//
// The c9watch 0.8.1 keys are already camelCase, so this is a pure identity
// adapter with NO rename layer. [Source: epics.md#c9watch 0.8.1 Verified Facts]
//
// PARSE-ONCE IPC BOUNDARY (Review Decision 2): this adapter is a parse-once
// boundary. Consumers hold the inferred `Session`/typed value (where `modified`/
// `timestamp` are already epoch-millis `number`s) and must NOT re-validate parsed
// output — re-running a schema over already-transformed data is unsupported by
// design (the timestamp transform's input is a string, not a number).

import { z } from 'zod'

/**
 * Coerce a c9watch ISO-8601 timestamp to epoch millis — STRICT ISO-8601 WITH tz
 * offset, FAILS CLOSED (Review Decision 1).
 *
 * The string is FIRST validated with `z.iso.datetime({ offset: true })`, which
 * requires a real ISO-8601 datetime carrying an explicit tz offset (`Z` or
 * `±HH:MM`) and REJECTS the lenient forms the legacy `Date.parse` accepted —
 * tz-less strings (`"2024-01-15T10:00:00"`), bare years (`"2020"`), free-form
 * dates (`"Jan 1 2020"`), and numeric junk (`"12345"`). Fractional/nanosecond
 * seconds are still accepted (JS `Date` truncates to ms — the intended target).
 * Only AFTER validation is the validated string transformed to epoch millis via
 * `Date.parse` (now guaranteed parseable). On invalid input the schema FAILS
 * with a Zod error — it NEVER coerces. The issue is reported by path + code only
 * (never echoes the value).
 * [Source: epics.md#Verified Facts ("Timestamps are ISO 8601 … coerce once at
 *  the adapter via `.transform()`"); architecture.md#Format Patterns; Review
 *  Decision 1 — "Strict ISO+tz, fail closed."]
 */
const IsoToEpochMillis = z.iso.datetime({ offset: true }).transform((value) => Date.parse(value))

/**
 * The c9watch session shape (compact + the safe-optional full fields).
 *
 * `status` is intentionally NOT enum-locked: c9watch may emit a new status
 * (help lists more than are observed live), and enum-locking would fail-closed
 * a brand-new state. Keep it `string` + rely on `.passthrough()`.
 *
 * `pid` is kept as a FIELD but is a wandering claude thread id — identity/dedup
 * must key on `id` (see `keyById` / the envelope below), never on `pid`.
 * [Source: epics.md#c9watch 0.8.1 Verified Facts; AR-7]
 */
export const SessionSchema = z
  .object({
    // --- compact shape (always present) ---
    id: z.string().min(1), // stable UUID — the identity key; blank id fails (Decision 3)
    status: z.string(), // observed: Working, WaitingForInput (NOT enum-locked)
    projectPath: z.string(),
    pid: z.number().int().nonnegative(), // wandering thread id, NOT identity; int>=0 (Decision 4)
    pendingToolName: z.string().optional(), // may be absent/empty
    sessionName: z.string(),
    // --- full shape (safe to mark optional) ---
    firstPrompt: z.string().optional(),
    latestMessage: z.string().optional(),
    messageCount: z.number().optional(),
    modified: IsoToEpochMillis.optional(), // ISO-8601 -> epoch millis
    // POLYMORPHIC by tool (Story 0.3, grounded in the live c9watch 0.8.1 capture
    // 2026-06-18). The shape DEPENDS on `pendingToolName`: for `Agent` it is an
    // OBJECT (`{ description, prompt, subagent_type }`); for `Question` (and other
    // tools) it is a STRING. `pendingToolInput` is a KNOWN key, and `.passthrough()`
    // only admits UNKNOWN keys — so the previous `z.string().optional()` FAILED
    // CLOSED on the object variant and would DROP every Agent session. Accept BOTH
    // observed shapes. Do NOT narrow to `z.record(...)`-only — that just relocates
    // the bug onto the string (Question/non-Agent) variant.
    // [Source: live `c9watch list` capture 2026-06-18; src/shared/schemas/session.ts
    //  (was line 73); 0-2 Guardrail #3 (.passthrough only covers unknown keys)]
    pendingToolInput: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
    // NOTE (Story 0.5 reconciliation): live `c9watch 0.8.1` also emits an
    // UNDOCUMENTED `customTitle: string` Session field (observed `"epic0"`). It is
    // DELIBERATELY NOT declared here — it is absorbed by `.passthrough()` below
    // (proven: real `list` output parses cleanly through ListEnvelopeSchema with
    // `customTitle` present). Adding an explicit optional field for every new
    // c9watch key defeats the `.passthrough()` design; declare it ONLY if Epic-1
    // needs to READ it. This is the canonical fail-open-on-additions case.
    // [Source: c9watch-0.8.1-contract.md §7; live `c9watch list` 2026-06-19;
    //  .claude/rules/zod-boundaries.md (c9watch ADDITIONS pass)]
  })
  .passthrough() // c9watch additions pass through (e.g. customTitle); only known-key malformations fail

/**
 * The session type — INFERRED from the schema (one source of truth, never a
 * hand-written type beside it). [Source: architecture.md#Naming Patterns]
 */
export type Session = z.infer<typeof SessionSchema>

/**
 * The `list` command envelope: a WRAPPER OBJECT (not a bare array) carrying
 * diagnostics + the sessions array.
 * [Source: epics.md#Verified Facts ("`list` → wrapper object, not a bare array")]
 */
export const ListEnvelopeSchema = z
  .object({
    diagnostics: z
      .object({
        claudeProcessesFound: z.number(),
        fdaLikelyNeeded: z.boolean(),
        processesWithCwd: z.number()
      })
      .passthrough(),
    sessions: z.array(SessionSchema)
  })
  .passthrough()

export type ListEnvelope = z.infer<typeof ListEnvelopeSchema>

/**
 * A `watch` NDJSON line envelope: one object per line. `--changes-only` skips
 * the initial burst and emits change + stop events.
 * [Source: epics.md#Verified Facts ("`watch` → NDJSON, one object per line")]
 */
export const WatchLineSchema = z
  .object({
    event: z.enum(['started', 'changed', 'stopped']),
    session: SessionSchema,
    sessionId: z.string(),
    timestamp: IsoToEpochMillis // ISO-8601 -> epoch millis
  })
  .passthrough()

export type WatchLine = z.infer<typeof WatchLineSchema>

/**
 * A LEAN `stopped` watch line (Story 1.1, Decision R2) — validates a removal off
 * the TOP-LEVEL `sessionId` ONLY, treating the inner `session` body as optional
 * best-effort.
 *
 * Why a second schema rather than loosening `WatchLineSchema`: a realistic minimal
 * stop event (`{ sessionId, event:'stopped', session:{ id } }` — or even with no
 * usable `session` body) does NOT satisfy the full `SessionSchema` that
 * `WatchLineSchema.session` requires, so it would fail-closed and the `map.delete`
 * would be SKIPPED — leaving a stale Done card (violates FR-1 "no missing/stale"
 * and NFR-2 "no missed transition" downstream). The DELETE is identity-by-`id`,
 * and the top-level `sessionId` is the event's authoritative routing key for the
 * removal — it must NOT depend on a fully-valid inner body.
 *
 * Loosening `WatchLineSchema` itself is wrong: it would let a malformed
 * `started`/`changed` through (those still require the full session). So the
 * reducer tries the STRICT `WatchLineSchema` first; for `stopped` specifically it
 * falls back to THIS lean schema so a minimal stop still removes the card. If even
 * the top-level `sessionId` is missing/blank on a `stopped` line → it fails here
 * too (nothing to delete → drop + log; fail-closed).
 *
 * The inner `session` is a loose `.passthrough()` object whose ONLY constrained
 * field is an optional `id` (used by R3 to detect a `sessionId`≠`session.id`
 * mismatch — which is logged but does NOT block the delete on a stop line). The
 * full `SessionSchema` is intentionally NOT applied to the body here.
 * [Source: Story 1.1 Dev Notes#Decision R2/R3; .claude/rules/zod-boundaries.md
 *  (per-boundary fail-closed; identity by `id`); epics.md#FR-1]
 */
export const WatchStopLineSchema = z
  .object({
    event: z.literal('stopped'),
    sessionId: z.string().min(1), // the authoritative removal key; blank fails closed
    session: z.object({ id: z.string().optional() }).passthrough().optional()
  })
  .passthrough()

export type WatchStopLine = z.infer<typeof WatchStopLineSchema>

/**
 * Raised when two sessions share the same `id`. The adapter fails CLOSED (it
 * never silently last-write-wins): a duplicate id would drop a card from the
 * keyed map with zero signal, so we surface it instead. Carries only the
 * offending id (an opaque UUID) — NEVER the parsed session value (Guardrail #6).
 * [Source: Review Decision 3 — "Reject empty, signal on duplicate."]
 */
export class DuplicateSessionIdError extends Error {
  readonly id: string
  constructor(id: string) {
    super(`duplicate session id: ${id}`)
    this.name = 'DuplicateSessionIdError'
    this.id = id
  }
}

/**
 * Key a list of sessions by their stable `id` (UUID) — NEVER by `pid`. This
 * structurally enforces AC-3's "sessions are keyed by `id`": dedup is by id, so
 * the wandering pid can never be used as identity.
 *
 * Blank ids already fail at the schema (`id: z.string().min(1)`). A DUPLICATE
 * id THROWS `DuplicateSessionIdError` rather than silently overwriting (Decision
 * 3 — "signal on duplicate") so no session can silently vanish from the map.
 * [Source: epics.md#Verified Facts; AR-7; AC-3; Review Decision 3]
 */
export function keyById(sessions: readonly Session[]): Map<string, Session> {
  const byId = new Map<string, Session>()
  for (const session of sessions) {
    if (byId.has(session.id)) {
      throw new DuplicateSessionIdError(session.id)
    }
    byId.set(session.id, session)
  }
  return byId
}

/**
 * Parse a `list` envelope and return its sessions keyed by `id` (AC-3).
 * Returns BOTH the validated envelope (for diagnostics) and the id-keyed map.
 * On invalid input the underlying Zod parse throws — callers handle/log by
 * error PATH + CODE only (never the parsed value). [Critical Guardrail #6]
 */
export function parseListKeyedById(raw: unknown): {
  envelope: ListEnvelope
  sessionsById: Map<string, Session>
} {
  const envelope = ListEnvelopeSchema.parse(raw)
  return { envelope, sessionsById: keyById(envelope.sessions) }
}
