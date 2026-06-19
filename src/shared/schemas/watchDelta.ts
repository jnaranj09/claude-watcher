// Story 1.4 — validate-at-source for the ENRICHED `session.updated` delta.
//
// main→renderer deltas are validated AT SOURCE before `wc.send` (.claude/rules/
// zod-boundaries.md: "main → renderer delta = validate at source — don't ship
// garbage downstream"). The reducer/tracker are in-process and already typed, but
// the ENRICHMENT step (main reads `tracker.columnOf(id)` / `tracker.enteredColumnAt(id)`
// and folds them onto the delta) can produce a half-formed delta if the tracker has
// no column for an updated id (e.g. an ordering bug, or a session the tracker never
// saw). A half-formed delta would carry `column: undefined` / `enteredColumnAt: undefined`
// past the seam — exactly the "silent wrong state" the fail-closed rule forbids. So we
// assert the enriched member here and FAIL CLOSED (drop + log by PATH/CODE only) rather
// than ship it.
//
// never-log-the-parsed-value: a ZodError stringifies its INPUT, which is a c9watch
// session delta carrying sessionName/projectPath/pendingToolName. So callers log the
// issue PATH + CODE only — never `error`, never the raw delta. This module exposes a
// `safeParse`; the caller (main/index.ts) reads `issues[0].path`/`.code` and logs those.
// [Source: story 1.4 Task 1.2; .claude/rules/zod-boundaries.md]
import { z } from 'zod'

/** The three live columns — mirrors the shared `Column` union (no `done`). */
const ColumnSchema = z.enum(['working', 'needs-you', 'idle'])

/**
 * The ENRICHED `session.updated` member shape. This is a VALIDATE-AT-SOURCE guard
 * (not the c9watch parse boundary — that is `session.ts`, upstream). It asserts the
 * two enrichment fields (`column`, `enteredColumnAt`) AND the native card fields
 * (`pid`, `pendingToolName?`) are well-formed BEFORE the delta crosses the seam.
 *
 * `column`/`enteredColumnAt` are the fields the tracker stamps; an `undefined` here
 * (the tracker had no column for this id) fails closed at `column` / `enteredColumnAt`
 * with a clear path — the half-formed delta is dropped, never shipped.
 */
export const EnrichedSessionUpdatedSchema = z.object({
  type: z.literal('session.updated'),
  id: z.string().min(1),
  sessionName: z.string(),
  projectPath: z.string(),
  status: z.string(),
  column: ColumnSchema,
  enteredColumnAt: z.number().int().nonnegative(),
  pid: z.number().int().nonnegative(),
  pendingToolName: z.string().optional()
})

/**
 * Story 1.4 fix — validate-at-source for the `watch:status` connection-state push.
 * Trivial (a single boolean carries no session content), but we keep the
 * validate-at-source pattern uniform: main asserts the shape BEFORE `wc.send` so a
 * malformed status never crosses the seam. Fails closed on a non-boolean.
 * [Source: .claude/rules/zod-boundaries.md (main→renderer = validate at source)]
 */
export const WatchStatusSchema = z.object({
  reconnecting: z.boolean()
})

/**
 * Story 2.2 (FR-9) — validate-at-source for the `attention:activate` push.
 *
 * The notification's activation handler emits `{ id }` toward the renderer; main asserts
 * the shape BEFORE `wc.send` so a malformed/blank id never crosses the seam (renderer-facing
 * delta = validate at source). The `id` is the stable UUID identity key (blank fails closed,
 * mirroring SessionSchema's `id`). It is an opaque identifier, never session CONTENT — so on
 * a parse miss the caller logs PATH + CODE only (never the value), per zod-boundaries.md.
 * [Source: story 2.2 Task 1.2; .claude/rules/zod-boundaries.md (main→renderer = validate at source)]
 */
export const AttentionActivateSchema = z.object({
  id: z.string().min(1)
})
