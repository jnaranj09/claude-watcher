// The Goals sheet's one mapping from a thrown IPC error to the operator's words (never
// `error.message`: it is a code today, but an unknown string stays off the screen too).
import { STORE_WRITE_FAILED } from '../../../shared/schemas/storageHealth'
import {
  FOLDER_CANCELLED,
  GOAL_FOLDER_MISSING,
  HOOKS_UNAVAILABLE,
  LAUNCH_CANCELLED,
  type GoalsFileProblemCode
} from '../../../shared/schemas/goal'
import { GOAL_TERMS } from '../copy/terms'
import { launchErrorCopy } from './namePromptFlow'
import { STORE_WRITE_FAILED_COPY } from './storageHealthCopy'

/** The disk refused the write: its sentence. Any other failure: `fallback`, the surface's own
 *  `Could not save …` line. The code travels inside Electron's wrapped message (`Error invoking
 *  remote method …: Error: <code>`), so it is matched with `includes`, like the sibling dialogs. */
export function goalErrorCopy(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : ''
  return text.includes(STORE_WRITE_FAILED) ? STORE_WRITE_FAILED_COPY : fallback
}

/** `Start session`'s refusal: null for a cancelled folder pick (nothing launched, nothing to say,
 *  like a cancelled `+ New session` pick), `No folder yet…` for a goal with no folder, the launch copy for `folder_missing` / `claude_version`,
 *  else `Could not start sessions.` (a task gone or closed meanwhile included). */
export function goalStartErrorCopy(err: unknown): string | null {
  const text = err instanceof Error ? err.message : ''
  if (text.includes(LAUNCH_CANCELLED)) return null
  // Before the launch copy: `goal_folder_missing` holds `folder_missing`.
  if (text.includes(GOAL_FOLDER_MISSING)) return GOAL_TERMS.noFolderYet
  return launchErrorCopy(err, GOAL_TERMS.startFailed)
}

/** `Plan with Claude`'s refusal: null for a cancelled folder pick, the session-status line while
 *  the hook port is not ours (the banner at the top says why), `No folder yet…` for a goal with no
 *  folder, the launch copy for
 *  `folder_missing` / `claude_version`, else `Could not plan with Claude.` */
export function goalPlanErrorCopy(err: unknown): string | null {
  const text = err instanceof Error ? err.message : ''
  if (text.includes(LAUNCH_CANCELLED)) return null
  if (text.includes(HOOKS_UNAVAILABLE)) return GOAL_TERMS.planNeedsStatus
  if (text.includes(GOAL_FOLDER_MISSING)) return GOAL_TERMS.noFolderYet
  return launchErrorCopy(err, GOAL_TERMS.planFailed)
}

/** A NEW goal's folder picker was cancelled: nothing was created, and nothing is said. */
export function isFolderCancelled(err: unknown): boolean {
  return err instanceof Error && err.message.includes(FOLDER_CANCELLED)
}

const FILE_PROBLEM_COPY: Record<GoalsFileProblemCode, string> = {
  goals_file_not_ours:
    'GOALS.md in this folder was not made by claude-watcher. Rename or move it, then try again.',
  folder_missing: 'Its folder no longer exists.',
  goals_file_write_failed:
    'Could not write GOALS.md. Check free space and folder permissions, then try again.'
}

/** Why a goal's `GOALS.md` did not follow its last change (main's `fileProblems`). */
export function goalFileProblemCopy(code: GoalsFileProblemCode): string {
  return FILE_PROBLEM_COPY[code]
}
