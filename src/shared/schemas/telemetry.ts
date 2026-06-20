// Story 3.5 — the versioned Zod telemetry schema (SM-2 idle/wait timing).
//
// This is OUR shape, NOT c9watch's — so the fail-closed posture is the OPPOSITE of
// `src/shared/schemas/session.ts`: that adapter uses `.passthrough()` so c9watch
// ADDITIONS pass and only known-key malformations fail (drift-tolerant). Telemetry is
// a shape WE own end-to-end, so it does NOT `.passthrough()` — an unknown/malformed
// blob is treated as corrupt and FAILS CLOSED (the persisted-file boundary then backs
// up the bad file + starts fresh; the IPC-arg boundary throws a typed error). This is
// the deliberate difference from the c9watch additions-pass rule.
// [Source: src/shared/schemas/settings.ts (schema-style precedent — identical posture);
//  .claude/rules/zod-boundaries.md (persisted-file = back up + start fresh; renderer→main
//  IPC arg = parse-and-throw-typed); architecture.md:770; story 3.5 FROZEN-1]
//
// NEVER-LOG-THE-VALUE (Critical Guardrail #6): a ZodError stringifies its INPUT. The
// telemetry event carries session ids and timing data — callers that catch a parse failure
// log the error PATH + CODE only, never the value. The store + IPC handlers follow this.

import { z } from 'zod'

/** The current persisted-telemetry schema version. Bumping this is how a future
 *  migration is introduced (the store reads `version` and migrates older events).
 *  Versioning the shape NOW keeps additions non-breaking. [architecture.md "versioned
 *  persistence"; story 3.5 FROZEN-1] */
export const TELEMETRY_VERSION = 1 as const

/**
 * The v1 telemetry event shape (FROZEN — story 3.5 Dev Notes / FROZEN-1):
 *
 * - `version`: literal 1 — a blob carrying a DIFFERENT version fails THIS schema
 *   (the store treats that as a no-known-migration → corrupt → fresh).
 * - `kind`: literal 'idle-wait' — the SM-2 idle/wait timing event.
 * - `sessionId`: the stable session id (UUID, min 1 char — NEVER pid).
 * - `column`: the waiting column the wait was measured in. ONLY the two waiting
 *   columns ('needs-you' | 'idle') — working NEVER records a wait duration.
 * - `enteredColumnAt`: epoch-millis the session entered this waiting column (the
 *   tracker's authoritative timestamp — main-owned).
 * - `acknowledgedAt`: epoch-millis the operator acknowledged the session.
 * - `waitMs`: the derived wait duration (acknowledgedAt − enteredColumnAt). Must
 *   be >= 0; a negative value is a clock/edge anomaly and FAILS CLOSED (never
 *   stored — the store skips the event, not backs-up).
 * - `launched`: the SM-1 launched-vs-external flag (`launchedSet.has(sessionId)`).
 *   true = the app launched this session; false = external. Post-Story-3.3, the board
 *   only shows app-launched sessions, so this is always true today — recorded for
 *   future-proofing per AC-4.
 *
 * NO `.passthrough()` (this is OUR shape). Unknown keys are stripped, not failed; a
 * MALFORMED known key fails closed — the load-bearing guarantee for AC-2.
 */
export const TelemetryEventSchema = z.object({
  version: z.literal(TELEMETRY_VERSION),
  kind: z.literal('idle-wait'),
  sessionId: z.string().min(1),
  column: z.enum(['needs-you', 'idle']),
  enteredColumnAt: z.number(),
  acknowledgedAt: z.number(),
  waitMs: z.number().min(0),
  launched: z.boolean()
})

/** The telemetry event type — INFERRED from the schema (one source of truth). */
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>

/**
 * Parse an unknown blob into a validated `TelemetryEvent`, or THROW a Zod error on
 * invalid input. Used by the JSONL read recovery (the store catches the throw → backs
 * up + starts fresh). On invalid input the underlying Zod parse throws — callers handle
 * by logging error PATH + CODE only, NEVER the parsed value (Guardrail #6).
 */
export function parseTelemetryEvent(raw: unknown): TelemetryEvent {
  return TelemetryEventSchema.parse(raw)
}

/**
 * The cross-process IPC arg schema for `CH.telemetryAcknowledge` (renderer→main).
 *
 * The renderer signals ONLY `{ sessionId, acknowledgedAt }` — main owns `enteredColumnAt`
 * via the tracker and computes `waitMs` from it. This arg is UNTRUSTED cross-process
 * input → parse-and-throw at the main boundary (zod-boundaries.md IPC-arg row).
 * Never log the arg value beyond path+code — Guardrail #6.
 */
export const TelemetryAcknowledgeSchema = z.object({
  sessionId: z.string().min(1),
  acknowledgedAt: z.number().positive()
})

/** The IPC arg type — INFERRED from the schema. */
export type TelemetryAcknowledgeRequest = z.infer<typeof TelemetryAcknowledgeSchema>
