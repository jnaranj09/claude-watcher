// The live sessions working on one Goals sheet task, under its title (spec 2026-10-29 task ↔
// session link): each is its status dot + word and its name, and a click opens it. Read live from
// the board store, so it follows status and name changes and drops a session that ended. The
// focused view's task panel never draws it: there the session is the one you are in.
import type { JSX } from 'react'
import type { Task } from '../../../../shared/schemas/goal'
import { openFromNotification } from '../../lib/openFromNotification'
import { selectSessionsById, useBoard } from '../../stores/boardStore'
import { Button } from '../Button/Button'
import { useManageDialogContext } from '../ManageDialog/ManageDialog'
import { StatusDot } from '../StatusDot/StatusDot'
import styles from './GoalsDialog.module.css'
import { liveLinked } from './taskSessions'

// Sessions → Active's details button, Past sessions and the launch toast all say `Open` for this
// act, each typed by hand; it is not a copy/terms.ts word yet (moving them all is its own change).
const OPEN = 'Open'

export function TaskSessionLine({ task }: { task: Task }): JSX.Element | null {
  const { actions } = useManageDialogContext()
  const sessions = liveLinked(task, useBoard(selectSessionsById))
  if (sessions.length === 0) return null

  /** Close the sheet FIRST: the open path refuses to change the view while a modal is up. */
  function open(id: string): void {
    actions.close()
    void openFromNotification(id)
  }

  return (
    <span className={styles.taskSessions} data-testid={`task-sessions-${task.id}`}>
      {sessions.map((s) => (
        <Button
          key={s.id}
          variant="ghost"
          size="sm"
          testId={`task-session-open-${s.id}`}
          // The visible words (status + name) are the accessible name; the tooltip says what a
          // click does and shows a name the row cut short.
          title={`${OPEN} ${s.sessionName}`}
          onClick={() => open(s.id)}
        >
          <span className={styles.taskSession}>
            <StatusDot status={s.column} />
            <span className={styles.taskSessionName}>{s.sessionName}</span>
          </span>
        </Button>
      ))}
    </span>
  )
}
