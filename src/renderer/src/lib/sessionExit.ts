// Past sessions (D-3/D-5) — the renderer side of the two exits, in ONE place so the card, the
// focused bar and the Delete confirm cannot drift on the ordering StopConfirm.tsx froze (F1): the
// main-side stop is SENT first, before any view-state change.
//
// Action feedback (spec 2026-09-29 §2.3): the view still goes to the board at once, but the
// terminal registry WAITS for main's answer — a refused archive/delete keeps the terminal (it used
// to be forgotten before the IPC settled) and says so in a toast. A kept archive toasts
// `Archived "<name>"` with [Resume], the Past sessions Open path, offered only once the record
// exists and only when the pane had a bound session id.
import { boardStore } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { focusLiveSession, openPastSession } from '../stores/pastSessionsStore'
import {
  isAlreadyOpenError,
  pastSessionErrorMessage
} from '../components/PastSessionsDialog/pastSessionsView'

const LOG_PREFIX = '[claude-watcher][exit]'

/** The session id the renderer knows for a terminal, or null before the binding landed. */
export function sessionIdForTerminal(terminalId: string): string | null {
  const entry = Object.entries(boardStore.getState().terminalIdBySessionId).find(
    ([, tid]) => tid === terminalId
  )
  return entry?.[0] ?? null
}

/** The name a toast shows: the card's, else the launch label (a pane with no card yet). */
function nameFor(terminalId: string, sessionId: string | null): string {
  const state = boardStore.getState()
  const fromCard = sessionId !== null ? state.sessionsById[sessionId]?.sessionName : undefined
  return fromCard ?? state.launchedTerminals[terminalId]?.label ?? 'session'
}

/** Right after an archive, `session_running_elsewhere` most likely means the stopped claude is
 *  still exiting (the stop is `pty.kill()`, and the check is `kill(pid, 0)`). */
export const STILL_CLOSING_COPY = 'Claude is still closing. Open it from Past sessions in a moment.'

export function resumeFromToastCopy(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  return text.includes('session_running_elsewhere')
    ? STILL_CLOSING_COPY
    : pastSessionErrorMessage(err)
}

/** The archive toast's [Resume]. Owns its errors (the toast store never catches): `already_open`
 *  takes the view to that live card (the dialog's precedent); anything else is an error toast. */
export async function resumeArchived(sessionId: string): Promise<void> {
  try {
    await openPastSession(sessionId)
  } catch (err) {
    if (isAlreadyOpenError(err) && (await focusLiveSession(sessionId))) return
    console.warn(`${LOG_PREFIX} code=resume_from_toast_failed`) // never the value
    toast.error(resumeFromToastCopy(err))
  }
}

/** One archive per terminal at a time — the card and the bar can both fire. */
const archiving = new Set<string>()

/** Archive: no confirmation (reversible through Past sessions… and the toast's [Resume]). */
export async function archiveTerminal(terminalId: string): Promise<void> {
  if (archiving.has(terminalId)) return
  archiving.add(terminalId)
  // Read BEFORE the removal: `session.removed` drops the binding and the card.
  const sessionId = sessionIdForTerminal(terminalId)
  const name = nameFor(terminalId, sessionId)
  const sent = window.launch.archiveSession(terminalId) // F1: the main-side stop is SENT first
  boardStore.getState().showBoard()
  try {
    await sent
  } catch {
    console.warn(`${LOG_PREFIX} code=archive_failed`) // never the value
    toast.error(`Could not archive "${name}".`)
    return
  } finally {
    archiving.delete(terminalId)
  }
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  toast.success(
    `Archived "${name}"`,
    sessionId === null ? {} : { action: { label: 'Resume', run: () => resumeArchived(sessionId) } }
  )
}

/** Delete: called by the confirm's Delete button only. */
export async function deleteTerminal(
  terminalId: string,
  sessionId: string | null,
  sessionName: string
): Promise<void> {
  const sent = window.launch.deleteSession(terminalId, sessionId) // F1: SENT first
  boardStore.getState().showBoard()
  try {
    await sent
  } catch {
    console.warn(`${LOG_PREFIX} code=delete_failed`)
    boardStore.getState().clearStopConfirm()
    toast.error(`Could not delete "${sessionName}".`)
    return
  }
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  boardStore.getState().clearStopConfirm()
}
