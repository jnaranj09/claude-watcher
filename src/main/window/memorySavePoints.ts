// Where the session engine meets memory's save points (memory phase 2, Task 11; addendum "Save
// points and the job", R34): which hook event of a launched session is a save point, what a
// removal means for memory, and the removal chokepoint's one order. Pure decisions, moved out of
// watchFeed.ts so they are tested; the feed makes the calls (`extract/extractor.ts`).
//
// The order that matters: an end reads the card's stamp (`sessionMeta`), so it runs while the card
// still holds the id. On `/clear` the kept `SessionEnd` (reason `clear`) of the OLD id ends it
// before a hook of the new id adopts the card (`adoptCard` → `moveCardState` → `rebind`); on a
// removal the end runs before the card leaves the board.
import type { HookEvent } from '../../shared/schemas/hookEvent'
import type { RemovalReason } from '../pty/launchRemoval'

/** What a hook event of a KNOWN, LAUNCHED session means for memory: a `Stop` → 'stop'; a `SessionEnd`
 *  with reason `clear` that kept the card → 'clear'; else null. */
export function savePointForHook(
  evt: Pick<HookEvent, 'hook_event_name' | 'reason'>,
  keptCard: boolean
): 'stop' | 'clear' | null {
  if (evt.hook_event_name === 'Stop') return 'stop'
  if (evt.hook_event_name === 'SessionEnd' && evt.reason === 'clear' && keptCard) return 'clear'
  return null
}

/** A removal: `archive` → 'ended', `delete` → 'forget'. */
export function savePointForRemoval(reason: RemovalReason): 'ended' | 'forget' {
  return reason === 'archive' ? 'ended' : 'forget'
}

/** The removal chokepoint's steps in their one order: the history record, memory's save point (it reads
 *  the card's stamp, so the card must still be on the board), the card's own state, the board. The memory
 *  step runs only when `onBoard` (the card was still on the board), so a belt-and-suspenders SessionEnd for a
 *  card that already left makes no second `ended` (once per card exit, R34). A seam moved out of
 *  watchFeed.ts so the order is tested. */
export function runRemoval(steps: {
  onBoard: boolean
  recordRemoval(): void
  memorySavePoint(): void
  dropCardState(): void
  removeFromBoard(): void
}): void {
  steps.recordRemoval()
  if (steps.onBoard) steps.memorySavePoint()
  steps.dropCardState()
  steps.removeFromBoard()
}
