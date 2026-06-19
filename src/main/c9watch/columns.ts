// Story 1.2 — the Column model + the pure status→column classifier (D1).
//
// A session is placed in EXACTLY ONE of three LIVE columns (FR-2), all derived
// directly from c9watch `status` (contract §4.3 — the authoritative mapping). There
// is NO "done" column: an exited session VANISHES (the reducer's `session.removed`
// drops it from the board — D2). The classifier here only ever sees a PRESENT
// session, so it only ever returns a live column.
//
// D1 — status → live column (CORRECTED 2026-06-18; the prior inverted mapping is
// SUPERSEDED — see the story banner + c9watch-0.8.1-contract.md §4):
//   `Working`                    → `working`
//   `Connecting`                 → `working`   (transient startup; an alive session
//                                               coming up — group with working)
//   `NeedsAttention`             → `needs-you`
//   `NeedsPermission`            → `needs-you`
//   `WaitingForInput`            → `idle`      (a LIVE, calm column — an alive session
//                                               awaiting the operator's NEXT prompt;
//                                               this is the IDLE bucket, NOT needs-you)
//   ANY other / unknown status   → `needs-you` (fail-toward-attention)
//
// "unknown → needs-you" is fail-toward-attention: a status we don't recognize is
// safer SURFACED (needs-you) than silently buried in working/idle. The classifier
// accepts ANY string and NEVER throws — `status` is `z.string()` upstream (NOT
// enum-locked), so a brand-new c9watch status must classify, not fail-closed.
// [Source: c9watch-0.8.1-contract.md §4.1–§4.3 (authoritative mapping); epics.md#FR-2;
// D1; .claude/rules/zod-boundaries.md ("Don't enum-lock status"); .claude/rules/state.md]

/**
 * The three LIVE board columns. All three are derived from a PRESENT session's
 * c9watch `status` (D1). There is no "done" column — an exited session is REMOVED
 * (`session.removed`), it never lands in a column (D2).
 *
 * Story 1.4 — the `Column` union's single definition moved to the SHARED contract
 * (`src/shared/ipc/contract.ts`) so main, preload, AND renderer reference ONE type
 * with no string-literal copy that can drift. This module stays the CLASSIFIER home
 * (`columnForStatus`) and re-exports `Column` for existing main-side importers
 * (`attention.ts`), so no call site changes. [Source: story 1.4 Task 1.1]
 */
export type { Column } from '../../shared/ipc/contract'
import type { Column } from '../../shared/ipc/contract'

/** Statuses that map to the `working` column (D1): actively working, or the
 *  transient startup state coming up. `Connecting` groups WITH working — an alive
 *  session attaching is not yet a "needs you". */
const WORKING_STATUSES: ReadonlySet<string> = new Set(['Working', 'Connecting'])

/** The single status that maps to the `idle` column (D1): the IDLE bucket — an
 *  alive session "waiting for your next prompt". This is the CORRECTED semantic
 *  (`WaitingForInput` = Idle, NOT needs-you). */
const IDLE_STATUS = 'WaitingForInput' as const

/**
 * Classify a PRESENT session's c9watch `status` into one of the THREE live columns.
 *
 * `Working`/`Connecting` → `working`; `WaitingForInput` → `idle`;
 * `NeedsAttention`/`NeedsPermission`/anything-else (incl. unknown/new statuses and
 * `''`) → `needs-you` (fail-toward-attention). Pure + side-effect-free (no `now()`,
 * no map, no logging) so it is trivially testable and cannot crash the board on a
 * weird status — it NEVER throws (status is `z.string()`, not enum-locked).
 *
 * [Source: D1; contract §4.3; FR-2; .claude/rules/zod-boundaries.md (status not enum-locked)]
 */
export function columnForStatus(status: string): Column {
  if (WORKING_STATUSES.has(status)) return 'working'
  if (status === IDLE_STATUS) return 'idle'
  // NeedsAttention / NeedsPermission / unknown / '' → needs-you (fail-toward-attention).
  return 'needs-you'
}
