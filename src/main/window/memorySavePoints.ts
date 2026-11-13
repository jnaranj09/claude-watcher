// Where the session engine meets memory's save points (memory phase 2, Task 11; addendum "Save
// points and the job", R34): the end of the hook callback (keep, save point, archive or status)
// and the removal chokepoint, each in its one order. Moved out of watchFeed.ts so the order is
// tested; the feed only calls these, and the calls go to `extract/extractor.ts`.
//
// The order that matters: an end reads the card's stamp (`sessionMeta`), so it runs while the card
// still holds the id. On `/clear` the kept `SessionEnd` (reason `clear`) of the OLD id ends it
// here, before a hook of the new id adopts the card (`adoptCard` → `moveCardState` → `rebind`); on
// a removal the end runs before the card leaves the board. Memory never moves, adds or delays a
// status transition: a `Stop`'s status is shipped first, then it counts toward a checkpoint.
import type { HookEvent } from '../../shared/schemas/hookEvent'
import type { Extractor } from '../memory/extract/extractor'
import { memoryStep } from '../memory/memoryLaunch'
import type { RemovalReason } from '../pty/launchRemoval'

/** One save point. The extractor never throws; guarded anyway, so memory can never break a hook
 *  or a removal. */
function savePoint(log: (line: string) => void, call: () => void): void {
  memoryStep(log, 'memory_save_point_failed', call)
}

/**
 * The end of the hook callback, for an event the status map knows (`change` not null). A removal
 * (`SessionEnd`) whose pty still lives is KEPT (`keep`, `keepCardOnLiveSessionEnd`; null while the
 * launch service or the terminal manager is not up): a kept `/clear` of a known, launched session
 * ends that id for memory, and nothing else runs. Any other removal is archived (the removal
 * chokepoint, `runRemoval`). Any other change is applied, and a `Stop` of a known, launched session
 * then counts toward a checkpoint. Any other kept `SessionEnd` (an `/exit` before its pty exits)
 * makes no save point: the pty's exit archives the card, and that removal ends it.
 */
export function routeHookEnd(route: {
  sessionId: string
  evt: Pick<HookEvent, 'hook_event_name' | 'reason'>
  /** The status map says `removed` (a `SessionEnd`). */
  removed: boolean
  /** A card for this id is on this board, and the app launched it. */
  knownLaunched: boolean
  keep: (() => boolean) | null
  archive(): void
  apply(): void
  extractor: Pick<Extractor, 'stop' | 'ended'>
  log: (line: string) => void
}): void {
  const { sessionId, evt } = route
  if (route.removed) {
    const kept = route.keep !== null && route.keep()
    if (!kept) {
      route.archive()
      return
    }
    if (route.knownLaunched && evt.hook_event_name === 'SessionEnd' && evt.reason === 'clear') {
      savePoint(route.log, () => route.extractor.ended(sessionId))
    }
    return
  }
  route.apply()
  if (route.knownLaunched && evt.hook_event_name === 'Stop') {
    savePoint(route.log, () => route.extractor.stop(sessionId))
  }
}

/** The removal chokepoint's steps in their one order: the history record, memory's save point (an
 *  archive ends the session's save, a delete forgets it; it reads the card's stamp, so the card
 *  must still be on the board), the card's own state, the board. The memory step runs only when
 *  `onBoard` (the card was still on the board), so a belt-and-suspenders SessionEnd for a card that
 *  already left makes no second `ended` (once per card exit, R34). */
export function runRemoval(removal: {
  sessionId: string
  reason: RemovalReason
  onBoard: boolean
  extractor: Pick<Extractor, 'ended' | 'forget'>
  log: (line: string) => void
  recordRemoval(): void
  dropCardState(): void
  removeFromBoard(): void
}): void {
  removal.recordRemoval()
  if (removal.onBoard) {
    const { extractor, sessionId } = removal
    savePoint(removal.log, () =>
      removal.reason === 'archive' ? extractor.ended(sessionId) : extractor.forget(sessionId)
    )
  }
  removal.dropCardState()
  removal.removeFromBoard()
}
