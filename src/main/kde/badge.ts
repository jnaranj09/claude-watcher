// Story 2.3 — the tray-badge COUNT (a pure function over main-side session truth).
//
// The badge mirrors, on the OS tray icon, how many sessions are in the `needs-you` live state
// (AC-1, FR-6, UX-DR12). NEEDS-YOU ONLY (Jose's decision 2026-06-19): the badge counts ONLY
// genuine needs-you sessions — `idle` and `working` are both EXCLUDED. This honors UX-DR3
// (gold is reserved exclusively for genuine needs-you signals) and removes the urgency
// dilution of counting calm idle sessions in the gold chip. It is derived from the SAME
// session map (`reducer.snapshotMap()`) and the SAME `columnForStatus` classifier the board
// uses, so the badge can NEVER drift from the board (single source of truth, AC-3 / state.md).
//
// Story 3.3 (FR-1 amended) — the badge counts ONLY launched-set members. The Cockpit alerts
// the operator only about the sessions IT launched ("never miss an agent the cockpit launched");
// an external/Konsole needs-you session must NOT bump the tray badge (AC-3). The launched-vs-
// external decision rides in via an injected `isLaunched(id)` predicate — the SAME membership
// source (`launchedSet.has`) that narrows the board + attention, so the three can never diverge.
//
// PURE: no `now()`, no Electron, no map mutation, no logging — it NEVER throws. (A `Session`
// always carries a `status: string`, and `columnForStatus` accepts any string and never
// throws, so neither does this; the injected `isLaunched` is a plain `(id) => boolean`.)
//
// Why reuse `columnForStatus` rather than a private status list: `columnForStatus` maps
// `Working`/`Connecting` → `working`; `WaitingForInput` → `idle`; everything else (incl.
// unknown/'' — fail-toward-attention) → `needs-you`. Counting `column === 'needs-you'`
// therefore counts exactly the genuine needs-you sessions AND inherits the board's
// fail-toward-attention placement of unknown statuses for free — they can never diverge. Do
// NOT re-enumerate statuses here.
// [Source: story 2.3 Task 1; AC-1/3/7; FROZEN #2/#6; src/main/c9watch/columns.ts:63;
//  UX-DR3 (one-reserved-hue); .claude/rules/state.md (tray count derives from session truth)]
import { columnForStatus } from '../c9watch/columns'
import type { Session } from '../../shared/schemas/session'

/**
 * Count the sessions the tray badge should show: those in the `needs-you` column (genuine
 * needs-you ONLY — `idle` and `working` are both EXCLUDED, per Jose 2026-06-19 / UX-DR3),
 * classified by the shipped `columnForStatus`, AND launched by the Cockpit (`isLaunched(id)` —
 * Story 3.3). Pure + total — never throws, never mutates the input.
 *
 * @param sessionsById the post-delta session map (e.g. `reducer.snapshotMap()`); only the
 *   PRESENT sessions are counted (an exited/removed session is already gone from the map).
 * @param isLaunched the app-launched-vs-external membership predicate (production:
 *   `(id) => launchedSet.has(id)`). A non-member (external/Konsole) is NOT counted (AC-3).
 */
export function computeBadgeCount(
  sessionsById: ReadonlyMap<string, Session>,
  isLaunched: (id: string) => boolean
): number {
  let count = 0
  for (const session of sessionsById.values()) {
    // Story 3.3 — count ONLY launched-set members; an external needs-you session is skipped so
    // it never bumps the badge (the same membership source as the board + attention).
    if (!isLaunched(session.id)) continue
    // SAME classifier the board uses → the count can never diverge from the columns (AC-3).
    if (columnForStatus(session.status) === 'needs-you') count++
  }
  return count
}
