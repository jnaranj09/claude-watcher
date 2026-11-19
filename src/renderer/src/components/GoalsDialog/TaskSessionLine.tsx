// The live sessions working on one Goals sheet task, under its title (spec 2026-10-29 task ↔
// session link): each is its status dot + word and its name, and a click opens it
// (`SessionOpenButton`). Read live from the board store, so it follows status and name changes and
// drops a session that ended. The focused view's task panel never draws it: there the session is
// the one you are in.
import type { JSX } from 'react'
import type { Task } from '../../../../shared/schemas/goal'
import { selectSessionsById, useBoard } from '../../stores/boardStore'
import styles from './GoalsDialog.module.css'
import { SessionOpenButton } from './SessionOpenButton'
import { liveLinked } from './taskSessions'

export function TaskSessionLine({ task }: { task: Task }): JSX.Element | null {
  const sessions = liveLinked(task, useBoard(selectSessionsById))
  if (sessions.length === 0) return null

  return (
    <span className={styles.taskSessions} data-testid={`task-sessions-${task.id}`}>
      {sessions.map((s) => (
        <SessionOpenButton key={s.id} session={s} testId={`task-session-open-${s.id}`} />
      ))}
    </span>
  )
}
