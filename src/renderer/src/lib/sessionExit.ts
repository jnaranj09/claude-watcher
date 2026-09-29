// Past sessions (D-3/D-5) — the renderer side of the two exits, in ONE place so the card, the
// focused bar and the Delete confirm cannot drift on the ordering that StopConfirm.tsx
// froze (F1): the explicit main-side stop FIRST, then the renderer's own view-state.
import { boardStore } from '../stores/boardStore'

const LOG_PREFIX = '[claude-watcher][exit]'

/** The session id the renderer knows for a terminal, or null before the binding landed. */
export function sessionIdForTerminal(terminalId: string): string | null {
  const entry = Object.entries(boardStore.getState().terminalIdBySessionId).find(
    ([, tid]) => tid === terminalId
  )
  return entry?.[0] ?? null
}

/** Archive: no confirmation (reversible through Past sessions…). */
export function archiveTerminal(terminalId: string): void {
  void window.launch.archiveSession(terminalId).catch(() => {
    console.warn(`${LOG_PREFIX} code=archive_failed`) // never the value
  })
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  boardStore.getState().showBoard()
}

/** Delete: called by the confirm's Delete button only. */
export function deleteTerminal(terminalId: string, sessionId: string | null): void {
  void window.launch.deleteSession(terminalId, sessionId).catch(() => {
    console.warn(`${LOG_PREFIX} code=delete_failed`)
  })
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  boardStore.getState().clearStopConfirm()
  boardStore.getState().showBoard()
}
