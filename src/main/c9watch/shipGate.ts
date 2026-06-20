// Story 3.3 (FR-1 amended) — the BOARD-SHIP membership gate (a pure function over the
// stable session `id` + the launched-set membership predicate).
//
// The Board shows ONLY app-launched sessions (the launched-set Story 3.2 BORN + POPULATES).
// A c9watch session that the Cockpit did NOT launch (external / Konsole / a prior run) must
// NEVER become a board card — the gate drops its `session.updated`/`session.removed` at the
// main-side SHIP chokepoint (`registerWatchFeed.onDelta`) so the renderer board store never
// learns of it (it is a pure projection of what main ships — state.md).
//
// PURE + total: it reads ONLY the event `id` + the injected membership predicate; no `now()`,
// no Electron, no logging, never throws. Extracted here (not inline in index.ts) so the board
// gate is unit-testable in the `main-unit` (node) project WITHOUT importing electron — mirrors
// how `enrichDelta`/`computeBadgeCount` are kept pure for the same reason.
//
// IDENTITY = the stable `id` (UUID), NEVER pid (CLAUDE.md identity rule). Both
// `session.updated` and `session.removed` carry `event.id`; the launched-set keys by `id`.
//
// TIMING (F3, the load-bearing reconciliation): a just-launched session enters the launched-set
// only when its `Tgid` correlation join LANDS (a few c9watch scans post-launch). Until then this
// gate returns `false` for it — it is simply not-yet-on-the-board, which is INVISIBLE because
// Story 3.2 dropped the operator INTO the live Focused terminal (the optimism is the focused-view
// + typeable terminal, NOT an optimistic board card). The gate is on the SHIP only — the
// correlation (`launchService.correlateAgainst`) keeps running per delta UNCONDITIONALLY at the
// call site, so the join still lands and the NEXT delta for that id ships as a card.
// [Source: story 3.3 Task 1; AC-2; F1/F3; src/main/pty/launchedSet.ts (has); src/main/index.ts
//  onDelta ship chokepoint; .claude/rules/state.md (renderer = projection)]
import type { AttentionEvent } from '../../shared/ipc/contract'

/**
 * Whether a board delta (`session.updated` / `session.removed` / `attention.raised`) should be
 * SHIPPED to the renderer board — true ONLY when its session `id` is in the launched-set.
 *
 * @param event    the frozen `AttentionEvent` member to ship (keyed by its stable `id`).
 * @param isLaunched the membership predicate (production: `(id) => launchedSet.has(id)`).
 */
export function shouldShipToBoard(
  event: Pick<AttentionEvent, 'id'>,
  isLaunched: (id: string) => boolean
): boolean {
  return isLaunched(event.id)
}
