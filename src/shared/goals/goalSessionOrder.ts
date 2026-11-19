// The sessions that worked on a goal's tasks, in the one order the spec gives the planner prompt
// and the goal form (spec 2026-11-18 memory session goals, "Session order"); the planner prompt
// (`goals/goalLaunch.ts`) and the goal form (`GoalsDialog` via `taskSessions.ts`) read it.
// Pure and uncapped: each caller applies its own caps.
import type { Touch } from '../schemas/goal'

export interface GoalSession {
  sessionId: string
  /** That session's tasks, by its own touch time on each, newest first (ties by task id). */
  taskIds: string[]
}

/** Plain code-unit order, so a tie never depends on the locale. */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Every session named in the tasks' `touchedBy`, by its last touch (the newest `at` over these
 * tasks), newest first; a tie by session id. A session that touched one task twice counts its
 * newest touch.
 */
export function goalSessionOrder(
  tasks: readonly { id: string; touchedBy: readonly Touch[] }[]
): GoalSession[] {
  const bySession = new Map<string, Map<string, number>>()
  for (const task of tasks) {
    for (const touch of task.touchedBy) {
      let touched = bySession.get(touch.sessionId)
      if (touched === undefined) {
        touched = new Map()
        bySession.set(touch.sessionId, touched)
      }
      touched.set(task.id, Math.max(touched.get(task.id) ?? -Infinity, touch.at))
    }
  }
  const sessions = [...bySession].map(([sessionId, touched]) => {
    const ordered = [...touched].sort(([idA, atA], [idB, atB]) => atB - atA || byId(idA, idB))
    return { sessionId, last: ordered[0]?.[1] ?? -Infinity, taskIds: ordered.map(([id]) => id) }
  })
  sessions.sort((a, b) => b.last - a.last || byId(a.sessionId, b.sessionId))
  return sessions.map(({ sessionId, taskIds }) => ({ sessionId, taskIds }))
}
