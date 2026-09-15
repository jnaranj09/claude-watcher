// The Session shape — the reducer-storage + renderer contract (Story 0.2, trimmed in
// Story 6.4 when the c9watch CLI was retired).
//
// HISTORY: this file was born as the Zod identity adapter for the c9watch wire boundary
// (`list` envelope + `watch` NDJSON lines). The native session engine (Epic 6) retired
// that CLI, so the wire schemas (`WatchLineSchema`, `WatchStopLineSchema`,
// `ListEnvelopeSchema`, `parseListKeyedById`, `DuplicateSessionIdError`) are GONE. What
// remains is the `Session` shape itself: the reducer's stored value and the contract the
// enrich/ship stages project to the renderer. The EXTERNAL fail-closed boundary of the
// native engine is the hook-POST adapter (`src/shared/schemas/hookEvent.ts`) — the
// never-log-the-parsed-value discipline lives on there.
//
// Load-bearing decisions that still hold:
//   - Time = epoch millis internally; coerce ISO-8601 -> millis ONCE here via
//     `.transform()`, never per-call.
//   - Key sessions by the stable `id` (UUID), NEVER by `pid` (pid is a wandering
//     claude thread id, not identity).
//   - NEVER log a parsed value / ZodError input — it can leak PTY content. Log
//     error path + code only.
//
// PARSE-ONCE BOUNDARY (Review Decision 2): this adapter is a parse-once boundary.
// Consumers hold the inferred `Session` (where `modified` is already an epoch-millis
// `number`) and must NOT re-validate parsed output — re-running a schema over
// already-transformed data is unsupported by design (the timestamp transform's input
// is a string, not a number). The Story-6.2 launch synthesis CONSTRUCTS a valid
// `Session` from main-owned values (minted uuid, picked cwd, pty pid) — it never runs
// this schema over internal data.

import { z } from 'zod'

/**
 * Coerce an ISO-8601 timestamp to epoch millis — STRICT ISO-8601 WITH tz offset,
 * FAILS CLOSED (Review Decision 1).
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
 */
const IsoToEpochMillis = z.iso.datetime({ offset: true }).transform((value) => Date.parse(value))

/**
 * The session shape (compact + the safe-optional full fields).
 *
 * `status` is intentionally NOT enum-locked: a new status string (hooks or a future
 * source may mint one) must pass through, not fail closed. Keep it `string` + rely
 * on `.passthrough()`.
 *
 * `pid` is kept as a FIELD but is a wandering claude thread id — identity/dedup
 * must key on `id`, never on `pid`. In the native engine the launch synthesis
 * stores the PTY leader pid here (main-owned, stable per terminal).
 */
export const SessionSchema = z
  .object({
    // --- compact shape (always present) ---
    id: z.string().min(1), // stable UUID — the identity key; blank id fails (Decision 3)
    status: z.string(), // e.g. Connecting, Working, WaitingForInput (NOT enum-locked)
    projectPath: z.string(),
    pid: z.number().int().nonnegative(), // wandering thread id, NOT identity; int>=0 (Decision 4)
    pendingToolName: z.string().optional(), // may be absent/empty
    sessionName: z.string(),
    /** Workspaces — the workspace this card belongs to. Session TRUTH, main-owned: stamped at
     *  launch synthesis from main's own active workspace and changed only by
     *  `session:set-workspace`. REQUIRED, not optional: an optional slot would let a launch path
     *  forget it and put a card in no workspace, which the no-"All"-view decision has no way to
     *  render. The compiler forcing `buildLaunchedSession` to supply it IS the guard. */
    workspaceId: z.string().min(1),
    /** Tags — the tags on this card. Session TRUTH, main-owned: written only by `reducer.setTags` /
     *  `reducer.setWorkspace` (and, from Phase 2, the rules engine). REQUIRED for the same reason as
     *  `workspaceId`: the compiler forcing `buildLaunchedSession` to supply it IS the guard. Dies
     *  with the session (spec T-25). */
    tagIds: z.array(z.string().min(1)),
    /** The template this session was launched from, or null for the folder flow. Stamped at launch;
     *  read only by the rules engine's `template` condition (Phase 2). It never crosses the seam —
     *  `enrichDelta` does not copy it. */
    templateId: z.string().min(1).nullable(),
    // --- full shape (safe to mark optional) ---
    firstPrompt: z.string().optional(),
    latestMessage: z.string().optional(),
    messageCount: z.number().optional(),
    modified: IsoToEpochMillis.optional(), // ISO-8601 -> epoch millis
    // POLYMORPHIC by tool (Story 0.3, grounded in the live c9watch 0.8.1 capture
    // 2026-06-18). The shape DEPENDS on `pendingToolName`: for `Agent` it is an
    // OBJECT (`{ description, prompt, subagent_type }`); for `Question` (and other
    // tools) it is a STRING. Accept BOTH observed shapes. Do NOT narrow to
    // `z.record(...)`-only — that just relocates the bug onto the string variant.
    pendingToolInput: z.union([z.string(), z.record(z.string(), z.unknown())]).optional()
  })
  .passthrough() // additions pass through; only known-key malformations fail

/**
 * The session type — INFERRED from the schema (one source of truth, never a
 * hand-written type beside it). [Source: architecture.md#Naming Patterns]
 */
export type Session = z.infer<typeof SessionSchema>
