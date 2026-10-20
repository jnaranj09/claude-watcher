// The Goals sheet's one mapping from a thrown IPC error to the operator's words (never
// `error.message`: it is a code today, but an unknown string stays off the screen too).
import { STORE_WRITE_FAILED } from '../../../shared/schemas/storageHealth'
import { LAUNCH_CANCELLED } from '../../../shared/schemas/goal'
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
 *  like a cancelled `+ New session` pick), the launch copy for `folder_missing` / `claude_version`,
 *  else `Could not start sessions.` (a task gone or closed meanwhile included). */
export function goalStartErrorCopy(err: unknown): string | null {
  const text = err instanceof Error ? err.message : ''
  if (text.includes(LAUNCH_CANCELLED)) return null
  return launchErrorCopy(err, GOAL_TERMS.startFailed)
}
