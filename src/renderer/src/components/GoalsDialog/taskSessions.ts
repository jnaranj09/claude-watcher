// Which live sessions a Goals sheet task row shows and offers (spec 2026-10-29 task ↔ session
// link). Derived from the board store, never stored: a session that ends drops out on its own.
// Pure, so each rule is tested without rendering.
import type { Task } from '../../../../shared/schemas/goal'
import type { BoardSession } from '../../stores/boardStore'
import { byAttention } from '../SessionsDialog/activeSessionsView'

/** `Link session`'s menu: the live sessions of the task's workspace not linked to it yet, Needs
 *  you first (main refuses any other). */
export function linkCandidates(task: Task, sessions: readonly BoardSession[]): BoardSession[] {
  return sessions
    .filter((s) => s.workspaceId === task.workspaceId && !task.sessionIds.includes(s.id))
    .sort(byAttention)
}

/** The row's session line: every linked session still live, in link order, whatever its
 *  workspace now. A link to a session that ended stays in the data and is skipped here. */
export function liveLinked(
  task: Task,
  sessionsById: Readonly<Record<string, BoardSession>>
): BoardSession[] {
  return task.sessionIds.flatMap((id) => {
    const session = sessionsById[id]
    return session === undefined ? [] : [session]
  })
}
