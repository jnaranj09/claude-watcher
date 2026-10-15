// The Column model + the pure status→column classifier.
//
// A session is placed in EXACTLY ONE of three LIVE columns, all derived directly from the
// session's hook `status`. There is NO "done" column: an exited session VANISHES (the reducer's
// `session.removed` drops it from the board). The classifier here only ever sees a PRESENT
// session, so it only ever returns a live column.
//
// Status → live column:
//   `Working`                    → `working`
//   `Connecting`                 → `idle`      (a just-spawned session waits for the operator's
//                                               FIRST prompt; it is not working)
//   `WaitingForInput`            → `idle`      (a LIVE, calm column — an alive session
//                                               awaiting the operator's NEXT prompt)
//   `NeedsAttention`             → `needs-you`
//   `NeedsPermission`            → `needs-you`
//   `YourTurn`                   → `needs-you` (deliberate — rides the fail-toward-attention
//                                               branch; pinned by test)
//   ANY other / unknown status   → `needs-you` (fail-toward-attention)
//
// "unknown → needs-you" is fail-toward-attention: a status we don't recognize is safer SURFACED
// (needs-you) than silently buried in working/idle. The classifier accepts ANY string and NEVER
// throws — `status` is `z.string()` upstream (NOT enum-locked), so a brand-new status must
// classify, not fail-closed (.claude/rules/zod-boundaries.md "Don't enum-lock status").

/**
 * The three LIVE board columns. All three are derived from a PRESENT session's
 * session `status`. There is no "done" column — an exited session is REMOVED
 * (`session.removed`), it never lands in a column.
 *
 * Story 1.4 — the `Column` union's single definition moved to the SHARED contract
 * (`src/shared/ipc/contract.ts`) so main, preload, AND renderer reference ONE type
 * with no string-literal copy that can drift. This module stays the CLASSIFIER home
 * (`columnForStatus`) and re-exports `Column` for existing main-side importers
 * (`attention.ts`), so no call site changes.
 */
export type { Column } from '../../shared/ipc/contract'
import type { Column } from '../../shared/ipc/contract'

/** The single status that maps to the `working` column: it is CLAUDE'S TURN.
 *  `Connecting` moved OUT of this set post-Epic-6: a just-spawned session is waiting
 *  for the operator's FIRST prompt, so showing it as "working" was a lie inherited
 *  from the old CLI-era semantics. */
const WORKING_STATUSES: ReadonlySet<string> = new Set(['Working'])

/** Statuses that map to the `idle` column: an alive session "waiting for your
 *  next prompt" (`WaitingForInput` = Idle, NOT needs-you — the corrected semantic),
 *  plus `Connecting` (a just-spawned/booting session — the operator hasn't typed yet,
 *  so it is idle-by-truth; it is NOT a "needs you" either). */
const IDLE_STATUSES: ReadonlySet<string> = new Set(['WaitingForInput', 'Connecting'])

/**
 * Classify a PRESENT session's `status` into one of the THREE live columns.
 *
 * `Working` → `working`; `WaitingForInput`/`Connecting` → `idle`;
 * `NeedsAttention`/`NeedsPermission`/`YourTurn` (deterministic-attention floor; pinned by test)/
 * anything-else (incl. unknown/new statuses and `''`) → `needs-you` (fail-toward-attention).
 * Pure + side-effect-free (no `now()`, no map, no logging) so it is trivially testable and
 * cannot crash the board on a weird status — it NEVER throws (status is `z.string()`, not
 * enum-locked).
 *
 * See .claude/rules/zod-boundaries.md (status is not enum-locked).
 */
export function columnForStatus(status: string): Column {
  if (WORKING_STATUSES.has(status)) return 'working'
  if (IDLE_STATUSES.has(status)) return 'idle'
  // NeedsAttention / NeedsPermission / unknown / '' → needs-you (fail-toward-attention).
  return 'needs-you'
}
