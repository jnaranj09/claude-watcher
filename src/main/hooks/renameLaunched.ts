// Session-naming A2 + name-sync — an in-app rename of a launched card. Extracted from index.ts
// because nothing can import index.ts: logic inlined there is unfalsifiable (the titleReadBack.ts
// precedent). The NAME is operator content — never logged here.
import type { Reducer, SessionDelta } from '../c9watch/reducer'
import type { PendingTitles } from './pendingTitles'

export interface RenameLaunchedDeps {
  reducer: Pick<Reducer, 'renameSession'>
  pendingTitles: Pick<PendingTitles, 'set'>
  handleDelta: (delta: SessionDelta) => void
}

/**
 * Rename the card (the `⟳` mark until the push is taken) through the SAME `handleDelta` chokepoint
 * as every other delta, then queue the name for claude: the hook server answers the session's next
 * `UserPromptSubmit` with it (the app cannot rename a running claude any other way).
 */
export function renameLaunched(deps: RenameLaunchedDeps, sessionId: string, name: string): void {
  const deltas = deps.reducer.renameSession(sessionId, name, true)
  deltas.forEach(deps.handleDelta)
  // R17: no delta = no such card (a rename racing a `/clear` re-key or a removal). A push parked
  // under that id would never be taken and would never clear.
  if (deltas.length === 0) return
  deps.pendingTitles.set(sessionId, name)
}
