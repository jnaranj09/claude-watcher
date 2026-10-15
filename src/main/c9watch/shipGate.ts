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
// TIMING: a launched session enters the launched-set at mint (`launchService.mintSpawn`),
// before its synthesized card's first delta ships, so this gate passes on that first delta.
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

/**
 * Whether an `attention.raised` is EMITTED (the renderer's sound + the OS popup): only for a
 * launched session, and never for the one the operator is looking at right now (UX-13,
 * `kde/viewedSession.ts`). The tracker still COMPUTES the raise; only the alert is skipped.
 */
export function shouldEmitRaise(
  id: string,
  isLaunched: (id: string) => boolean,
  isViewing: (id: string) => boolean
): boolean {
  return isLaunched(id) && !isViewing(id)
}
