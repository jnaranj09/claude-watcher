// Past sessions (D-3/D-5) — the renderer side of the two exits, in ONE place so the card, the
// focused bar and the Delete confirm cannot drift on the ordering StopConfirm.tsx froze (F1): the
// main-side stop is SENT first, before any view-state change.
//
// Action feedback (spec 2026-09-29 §2.3): the view still goes to the board at once, but the
// terminal registry WAITS for main's answer — a refused archive/delete keeps the terminal (it used
// to be forgotten before the IPC settled) and says so in a toast. A kept archive toasts
// `Archived "<name>"` with [Resume], the Past sessions Open path, offered only once the record
// exists and only when the pane had a bound session id.
//
// The Sessions dialog uses the CORE of each exit — no toast, no jump to the board; it reports in
// its own message slot (spec 2026-10-03 D).
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

/** The archive CORE: send it (F1 — the main-side stop goes out AT THE CALL, before any await),
 *  wait for main, forget the terminal only once main confirmed. No view change and no toast: the
 *  card wrapper below adds those; the Sessions dialog reports in its message slot. Never rejects. */
export async function archiveTerminalCore(terminalId: string): Promise<boolean> {
  try {
    await window.launch.archiveSession(terminalId)
  } catch {
    console.warn(`${LOG_PREFIX} code=archive_failed`) // never the value
    return false
  }
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  return true
}

/** The delete CORE — same contract as `archiveTerminalCore`. */
export async function deleteTerminalCore(
  terminalId: string,
  sessionId: string | null
): Promise<boolean> {
  try {
    await window.launch.deleteSession(terminalId, sessionId)
  } catch {
    console.warn(`${LOG_PREFIX} code=delete_failed`)
    return false
  }
  boardStore.getState().forgetLaunchedTerminal(terminalId)
  return true
}

export type ExitVerb = 'archive' | 'delete'

export interface ExitOutcome {
  id: string
  name: string
  ok: boolean
}

/** The Sessions dialog's Archive / Delete over one or many sessions (spec 2026-10-03 D): N calls
 *  to the channels the card uses — no new IPC — all SENT before any answer, collected per session.
 *  A session with no terminal binding (it is ending) fails without a call. */
export async function exitSessions(
  verb: ExitVerb,
  sessionIds: readonly string[]
): Promise<ExitOutcome[]> {
  const state = boardStore.getState()
  return Promise.all(
    sessionIds.map(async (id) => {
      const name = state.sessionsById[id]?.sessionName ?? 'session'
      const terminalId = state.terminalIdBySessionId[id]
      if (terminalId === undefined) return { id, name, ok: false }
      const ok =
        verb === 'archive'
          ? await archiveTerminalCore(terminalId)
          : await deleteTerminalCore(terminalId, id)
      return { id, name, ok }
    })
  )
}

/** Archive: no confirmation (reversible through Past sessions and the toast's [Resume]). */
export async function archiveTerminal(terminalId: string): Promise<void> {
  if (archiving.has(terminalId)) return
  archiving.add(terminalId)
  // Read BEFORE the removal: `session.removed` drops the binding and the card.
  const sessionId = sessionIdForTerminal(terminalId)
  const name = nameFor(terminalId, sessionId)
  const sent = archiveTerminalCore(terminalId) // F1: the main-side stop is SENT first
  boardStore.getState().showBoard()
  const ok = await sent
  archiving.delete(terminalId)
  if (!ok) {
    toast.error(`Could not archive "${name}".`)
    return
  }
  toast.success(
    `Archived "${name}"`,
    sessionId === null
      ? {}
      : { action: { label: 'Resume', icon: 'resume', run: () => resumeArchived(sessionId) } }
  )
}

/** Delete: called by the confirm's Delete button only. */
export async function deleteTerminal(
  terminalId: string,
  sessionId: string | null,
  sessionName: string
): Promise<void> {
  const sent = deleteTerminalCore(terminalId, sessionId) // F1: SENT first
  boardStore.getState().showBoard()
  const ok = await sent
  clearOwnConfirm(terminalId)
  if (!ok) toast.error(`Could not delete "${sessionName}".`)
}

/** The confirm may be another card's by the time this delete settles: close only our own. */
function clearOwnConfirm(terminalId: string): void {
  if (boardStore.getState().stopConfirm?.terminalId === terminalId) {
    boardStore.getState().clearStopConfirm()
  }
}
