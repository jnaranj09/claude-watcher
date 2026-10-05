// Card shell pane (spec 2026-09-30) — the `>_ Shell` flow, in ONE place so the focused bar stays
// thin: the FIRST press asks main for the companion (one invoke; main resolves the folder from its
// own recipe), every later press is a pure show/hide of the kept-alive shell terminal. A refusal is
// a toast with copy mapped from the CODE (design.md Feedback rule 3: no dialog holds this result),
// never the thrown message. Logs a code only — never the folder.
import { boardStore, selectKeptAliveTerminalIds } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { SHELL_TERMS } from '../copy/terms'

const LOG_PREFIX = '[claude-watcher][shell]'

export const SHELL_OPEN_GENERIC_COPY = SHELL_TERMS.openFailedSession

const SHELL_OPEN_ERROR_COPY: readonly (readonly [string, string])[] = [
  ['folder_missing', 'That folder no longer exists.'], // the launch copy (namePromptFlow.ts)
  ['terminal_not_found', SHELL_OPEN_GENERIC_COPY]
]

/** Matched with `includes`: Electron wraps an invoke rejection (the `copyFor` precedent). */
export function shellOpenErrorCopy(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of SHELL_OPEN_ERROR_COPY) if (text.includes(code)) return copy
  return SHELL_OPEN_GENERIC_COPY
}

/** Open the pane on the first press, then toggle it. Never rejects: the caller is a button. */
export async function toggleShellPane(parentTerminalId: string): Promise<void> {
  const pane = boardStore.getState().shellPanes[parentTerminalId]
  if (pane !== undefined) {
    boardStore.getState().setShellPaneVisible(parentTerminalId, !pane.visible)
    return
  }
  // Registered BEFORE the invoke: a registry entry that is gone after it means the card was
  // archived / deleted meanwhile (sessionExit.ts forgets it once main answered). The archive keeps
  // the frame focused (hidden on the board), so the kept-alive check below alone would pass.
  const wasRegistered = boardStore.getState().launchedTerminals[parentTerminalId] !== undefined
  let terminalId: string
  try {
    ;({ terminalId } = await window.shell.open(parentTerminalId))
  } catch (err) {
    console.warn(`${LOG_PREFIX} code=shell_open_failed`)
    toast.error(shellOpenErrorCopy(err))
    return
  }
  // The card may have been archived while main answered: a pane for a terminal that is no longer
  // kept alive would never mount (and its shell would never open) — register nothing. Main's
  // registry entry is dropped by the parent's own stop cascade.
  const state = boardStore.getState()
  if (wasRegistered && state.launchedTerminals[parentTerminalId] === undefined) return
  if (!selectKeptAliveTerminalIds(state).includes(parentTerminalId)) return
  boardStore.getState().openShellPane(parentTerminalId, terminalId)
}
