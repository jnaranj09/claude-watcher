// Action feedback (spec 2026-09-29 §2.2) — what the name prompt's Create / Rename DO, outside React
// so the ordering is testable without App.
//
// The prompt STAYS OPEN and busy while main answers. A refusal keeps the typed name and puts mapped
// copy on the prompt's error line. A launch that has not answered in LAUNCH_GUARD_MS (longer than
// main's synchronous 10 s version probe, index.ts `readClaudeVersionRaw`) closes the prompt and
// says so in a toast. A result that lands after the prompt closed (the guard, or the operator's
// Escape/Cancel) NEVER takes the view: a success is registered like an API launch (registry only,
// `registerLaunchedTerminal`) and toasted with [Open]; a failure is an error toast.
//
// "The prompt" is the payload OBJECT that was submitted: a newer prompt is never touched by an
// older result. Rename has no guard — main's rename handler is synchronous (index.ts).
//
// never-log-the-value: the rejection carries the cwd and the typed name — codes only.
import { boardStore, type SessionNamePromptPayload } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { setActiveWorkspace, workspacesStore } from '../stores/workspacesStore'
import { formatVersion, MIN_CLAUDE_VERSION } from '../../../shared/launch/claudeVersion'

export const LAUNCH_GUARD_MS = 15_000

type CreatePrompt = Extract<SessionNamePromptPayload, { mode: 'create' }>
type RenamePrompt = Extract<SessionNamePromptPayload, { mode: 'rename' }>

export interface PromptTimers {
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const REAL_TIMERS: PromptTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

const LAUNCH_ERROR_COPY: readonly (readonly [string, string])[] = [
  ['folder_missing', 'That folder no longer exists.'],
  [
    'claude_version',
    `Update claude to ${formatVersion(MIN_CLAUDE_VERSION)} or newer to launch from the app.`
  ],
  ['template_not_found', 'That template no longer exists.']
]

/** Matched with `includes`: Electron wraps an invoke rejection as
 *  "Error invoking remote method '…': Error: <code>" (the `copyFor` precedent). */
export function launchErrorCopy(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of LAUNCH_ERROR_COPY) if (text.includes(code)) return copy
  return 'Could not start the session.'
}

export const RENAME_ERROR_COPY = 'Could not rename the session.'

function isOpen(prompt: SessionNamePromptPayload): boolean {
  return boardStore.getState().sessionNamePrompt === prompt
}

/** A late launch's [Open]: take the view to it now — the operator asked. Its workspace becomes the
 *  active one first (the Past sessions Open precedent). A terminal that already exited has nothing
 *  to open, and says so. `setActiveWorkspace` reports its own failure; a switch that did not
 *  happen leaves the view where it is. */
async function openStarted(terminalId: string, name: string, workspaceId: string): Promise<void> {
  if (boardStore.getState().launchedTerminals[terminalId] === undefined) {
    toast.info('That session has ended.')
    return
  }
  if (workspacesStore.getState().activeId !== workspaceId) {
    await setActiveWorkspace(workspaceId)
    if (workspacesStore.getState().activeId !== workspaceId) return
  }
  boardStore.getState().openLaunchedTerminal(terminalId, name, workspaceId)
}

export async function submitLaunch(
  prompt: CreatePrompt,
  name: string,
  timers: PromptTimers = REAL_TIMERS
): Promise<void> {
  if (!isOpen(prompt) || boardStore.getState().sessionNamePromptBusy) return // one per prompt
  boardStore.getState().setSessionNamePromptBusy(true)
  const guard = timers.setTimer(() => {
    if (!isOpen(prompt)) return
    boardStore.getState().clearSessionNamePrompt()
    toast.info(`Still starting "${name}"…`)
  }, LAUNCH_GUARD_MS)
  try {
    const { terminalId, workspaceId } =
      prompt.templateId !== undefined
        ? await window.launch.launchFromTemplate(prompt.templateId, name)
        : await window.launch.launch(prompt.cwd, name)
    timers.clearTimer(guard)
    if (isOpen(prompt)) {
      boardStore.getState().clearSessionNamePrompt()
      // Optimistic drop-into-Focused-session: the terminal is typeable at once; the binding
      // reconciles asynchronously. The label is the operator's name (the card agrees from frame 1).
      boardStore.getState().openLaunchedTerminal(terminalId, name, workspaceId)
      return
    }
    boardStore.getState().registerLaunchedTerminal(terminalId, name, workspaceId)
    toast.success(`Started "${name}"`, {
      action: { label: 'Open', run: () => openStarted(terminalId, name, workspaceId) }
    })
  } catch (err) {
    timers.clearTimer(guard)
    console.warn('[claude-watcher][launch] code=launch_failed')
    const copy = launchErrorCopy(err)
    if (isOpen(prompt)) {
      boardStore.getState().setSessionNamePromptBusy(false)
      boardStore.getState().setSessionNamePromptError(copy)
      return
    }
    toast.error(copy)
  }
}

export async function submitRename(prompt: RenamePrompt, name: string): Promise<void> {
  if (!isOpen(prompt) || boardStore.getState().sessionNamePromptBusy) return
  boardStore.getState().setSessionNamePromptBusy(true)
  try {
    // The retitled card arrives as a `session.updated` delta: session truth is main's.
    await window.launch.rename(prompt.sessionId, name)
    if (isOpen(prompt)) boardStore.getState().clearSessionNamePrompt()
  } catch {
    console.warn('[claude-watcher][launch] code=rename_failed')
    if (isOpen(prompt)) {
      boardStore.getState().setSessionNamePromptBusy(false)
      boardStore.getState().setSessionNamePromptError(RENAME_ERROR_COPY)
      return
    }
    toast.error(RENAME_ERROR_COPY)
  }
}
