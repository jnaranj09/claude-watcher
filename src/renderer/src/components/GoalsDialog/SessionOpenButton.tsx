// One live session as a button in the Goals sheet: its status dot and name; a click closes the
// sheet and opens its card. A task's session line (`TaskSessionLine`) and a live row of the goal
// form's `Worked on by` (`GoalSessions`) draw the same button.
import type { JSX } from 'react'
import { openFromNotification } from '../../lib/openFromNotification'
import type { BoardSession } from '../../stores/boardStore'
import { Button } from '../Button/Button'
import { useManageDialogContext } from '../ManageDialog/ManageDialog'
import { StatusDot } from '../StatusDot/StatusDot'
import styles from './GoalsDialog.module.css'

// Sessions → Active's details button, Past sessions, the launch toast and the goal form's
// `Worked on by` all say `Open` for this act, each typed by hand; it is not a copy/terms.ts word
// yet (moving them all is its own change).
export const OPEN = 'Open'

export function SessionOpenButton({
  session,
  testId
}: {
  session: BoardSession
  testId: string
}): JSX.Element {
  const { actions } = useManageDialogContext()

  /** Close the sheet FIRST: the open path refuses to change the view while a modal is up. */
  function open(): void {
    actions.close()
    void openFromNotification(session.id)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      testId={testId}
      // The visible words (status + name) are the accessible name; the tooltip says what a click
      // does and shows a name the row cut short.
      title={`${OPEN} ${session.sessionName}`}
      onClick={open}
    >
      <span className={styles.taskSession}>
        <StatusDot status={session.column} />
        <span className={styles.taskSessionName}>{session.sessionName}</span>
      </span>
    </Button>
  )
}
