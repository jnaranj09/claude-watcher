// Which sessions the Goals sheet shows: the live sessions a task row shows and offers (spec
// 2026-10-29 task ↔ session link), and the goal form's `Worked on by` rows, the sessions whose
// memory saves added or updated its tasks (spec 2026-11-18 memory session goals). Derived from the
// board store and the Past sessions copy, never stored: a session that ends drops out on its own.
// Pure, so each rule is tested without rendering.
import type { PastSession } from '../../../../shared/ipc/contract'
import { goalSessionOrder } from '../../../../shared/goals/goalSessionOrder'
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

/** The `Worked on by` section's row cap; the rest is one `<n> more` line. */
export const GOAL_SESSION_ROWS_MAX = 20

export interface GoalSessionEntry {
  id: string
  /** `live`: a card on the board; `past`: a Past sessions record; `gone`: neither; `unknown`:
   *  not live, and the records are not loaded yet. */
  state: 'live' | 'past' | 'gone' | 'unknown'
  /** The card's or the record's name; null for `gone` and `unknown`. */
  name: string | null
  /** The live card (for its status dot), else null. */
  session: BoardSession | null
  /** The session's tasks on this goal, newest touch first. */
  taskTitles: string[]
}

/** Every session that touched the goal's tasks, in `goalSessionOrder`'s order (uncapped: the
 *  section applies `GOAL_SESSION_ROWS_MAX`). `records` null = Past sessions not loaded yet. */
export function goalSessions(
  tasks: readonly Task[],
  sessionsById: Readonly<Record<string, BoardSession>>,
  records: readonly PastSession[] | null
): GoalSessionEntry[] {
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]))
  const recordOf = new Map((records ?? []).map((r) => [r.id, r]))
  return goalSessionOrder(tasks).map(({ sessionId: id, taskIds }): GoalSessionEntry => {
    const taskTitles = taskIds.flatMap((tid) => {
      const title = titleOf.get(tid)
      return title === undefined ? [] : [title]
    })
    const session = sessionsById[id]
    if (session !== undefined) {
      return { id, state: 'live', name: session.sessionName, session, taskTitles }
    }
    if (records === null) return { id, state: 'unknown', name: null, session: null, taskTitles }
    const record = recordOf.get(id)
    return record === undefined
      ? { id, state: 'gone', name: null, session: null, taskTitles }
      : { id, state: 'past', name: record.name, session: null, taskTitles }
  })
}
