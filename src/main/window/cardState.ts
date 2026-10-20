// What a launched card carries beside the reducer: its pending rename (pendingTitles.ts) and its
// Context setup (mods/sessionSetup.ts). Both follow the card when a `/clear` re-keys it, and both
// go when it is removed. A seam moved out of watchFeed.ts so the pairing is tested.
import type { PendingTitles } from '../hooks/pendingTitles'
import type { SessionSetup } from '../mods/sessionSetup'

interface CardStateDeps {
  pendingTitles: Pick<PendingTitles, 'rebind' | 'forget'>
  sessionSetup: Pick<SessionSetup, 'rebind' | 'forget'>
}

export function moveCardState(deps: CardStateDeps, oldId: string, newId: string): void {
  deps.pendingTitles.rebind(oldId, newId)
  deps.sessionSetup.rebind(oldId, newId)
}

export function dropCardState(deps: CardStateDeps, sessionId: string): void {
  deps.pendingTitles.forget(sessionId)
  deps.sessionSetup.forget(sessionId)
}
