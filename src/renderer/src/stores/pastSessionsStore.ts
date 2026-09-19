// Past sessions — the renderer PROJECTION of main's history (state.md: main is truth; this is a
// hydrated copy replaced wholesale from every IPC result). Loaded when the dialog opens.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PastSession, PastSessionOpenResult } from '../../../shared/ipc/contract'
import { boardStore } from './boardStore'
import { setActiveWorkspace, workspacesStore } from './workspacesStore'

export interface PastSessionsState {
  sessions: PastSession[]
  loaded: boolean
  hydrate: (sessions: PastSession[]) => void
}
export type PastSessionsStoreApi = StoreApi<PastSessionsState>

export function createPastSessionsViewStore(): PastSessionsStoreApi {
  return createStore<PastSessionsState>((set) => ({
    sessions: [],
    loaded: false,
    hydrate: (sessions) => set({ sessions, loaded: true })
  }))
}

export const pastSessionsStore = createPastSessionsViewStore()

export function usePastSessions<T>(selector: (state: PastSessionsState) => T): T {
  return useStore(pastSessionsStore, selector)
}

export const selectPastSessions = (s: PastSessionsState): PastSession[] => s.sessions
export const selectPastSessionsLoaded = (s: PastSessionsState): boolean => s.loaded

const LOG_PREFIX = '[claude-watcher][past-sessions]'

/** Resolves `false` on a failed load (logged by code; the list already held is kept) so the dialog
 *  can say so on its error line — a swallowed failure left `loaded` false and the rail blank,
 *  indistinguishable from a load still in flight. Never rejects. */
export async function loadPastSessions(): Promise<boolean> {
  try {
    pastSessionsStore.getState().hydrate(await window.pastSessions.list())
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=past_sessions_load_failed`)
    return false
  }
}

/** Rethrows: the dialog maps the code to copy. */
export async function forgetPastSession(id: string): Promise<void> {
  pastSessionsStore.getState().hydrate(await window.pastSessions.forget(id))
}

/**
 * D-1 / D-12 — resume a record IN THE APP and take the view. Main registers the `--resume`
 * recipe and answers with the terminal to open; this opens it exactly like the `+ New session`
 * popover does (`openLaunchedTerminal`: registry + focus). The record's workspace becomes the
 * active one first, or the focused terminal would sit hidden under another workspace's board.
 * Rethrows the code (`not_found` / `folder_missing` / `already_open`) for the dialog's error line
 * (`already_open` first tries `focusLiveSession`).
 */
export async function openPastSession(id: string): Promise<PastSessionOpenResult> {
  const result = await window.pastSessions.open(id)
  if (workspacesStore.getState().activeId !== result.workspaceId) {
    await setActiveWorkspace(result.workspaceId)
  }
  boardStore.getState().openLaunchedTerminal(result.terminalId, result.name, result.workspaceId)
  return result
}

/**
 * Spec Open step 3 — Open was refused `already_open`: the session is live on the board, so take
 * the operator to ITS card instead, exactly like a card click (`activateCard`: select, acknowledge,
 * show its own terminal in the focused view). The card's workspace (session truth, which may
 * differ from the record's: the card can have moved) becomes the active one first, or the terminal
 * would sit hidden under another workspace's board. Resolves `false` — and changes nothing — when
 * the renderer knows no card or no terminal for the id; the dialog then keeps its error line.
 * Never rejects.
 */
export async function focusLiveSession(id: string): Promise<boolean> {
  const board = boardStore.getState()
  const card = board.sessionsById[id]
  const terminalId = board.terminalIdBySessionId[id]
  if (card === undefined || terminalId === undefined) return false
  if (workspacesStore.getState().activeId !== card.workspaceId) {
    await setActiveWorkspace(card.workspaceId)
  }
  boardStore.getState().activateCard(id)
  // `true` means the operator is now looking at it (the card could have left during the await).
  const after = boardStore.getState()
  return after.viewMode === 'focused' && after.focusedTerminalId === terminalId
}
