// The goal form's `Worked on by` (spec 2026-11-18 memory session goals, "Renderer"; CUJ 9): the
// sessions whose memory saves added or updated the goal's tasks, newest touch first
// (`goalSessions`), each over its task titles. A live session is its card's button
// (`SessionOpenButton`); a Past sessions record is its name and `Open` (resume it, or go to its
// card when it is already live: `openOrFocusPast`); any other is `No longer listed`. Until the
// records load, a row that is not live shows its titles only. At most `GOAL_SESSION_ROWS_MAX` rows,
// then `<n> more`. `GoalForm` owns the records' load and passes its failure here.
import type { JSX } from 'react'
import type { Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS, LIST_TERMS, PAST_SESSIONS_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { selectSessionsById, useBoard } from '../../stores/boardStore'
import {
  focusLiveSession,
  openPastSession,
  selectPastSessions,
  selectPastSessionsLoaded,
  usePastSessions
} from '../../stores/pastSessionsStore'
import { Button } from '../Button/Button'
import { Callout } from '../Callout/Callout'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { openOrFocusPast, pastSessionErrorMessage } from '../PastSessionsDialog/pastSessionsView'
import styles from './GoalsDialog.module.css'
import { OPEN, SessionOpenButton } from './SessionOpenButton'
import { GOAL_SESSION_ROWS_MAX, goalSessions } from './taskSessions'

/** The session's task titles on one line, cut short with the full list in `title`. */
function TaskTitles({ titles }: { titles: readonly string[] }): JSX.Element {
  const text = titles.join(', ')
  return (
    <span className={styles.workedOnTasks} title={text}>
      {text}
    </span>
  )
}

/** A Past sessions record: its name and `Open`, busy on its own. A success, or a session already
 *  live whose card the view could go to, closes the sheet; any other refusal is the sheet's one
 *  result toast, in the Past sessions wording. */
function GoalSessionRow({
  id,
  name,
  taskTitles
}: {
  id: string
  name: string
  taskTitles: readonly string[]
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const open = useAsyncAction(async (): Promise<void> => {
    actions.setError(null)
    try {
      await openOrFocusPast(() => openPastSession(id), focusLiveSession, id)
      actions.close()
    } catch (err) {
      actions.setError(pastSessionErrorMessage(err))
    }
  })
  return (
    <li className={styles.workedOnRow} data-testid={`goal-session-${id}`}>
      <span className={styles.workedOnHead}>
        <span className={styles.workedOnName} title={name}>
          {name}
        </span>
        <Button
          variant="ghost"
          size="sm"
          testId={`goal-session-open-${id}`}
          title={`${OPEN} ${name}`}
          busy={open.busy}
          onClick={() => void open.run()}
        >
          {OPEN}
        </Button>
      </span>
      <TaskTitles titles={taskTitles} />
    </li>
  )
}

export function GoalSessions({
  tasks,
  loadFailed
}: {
  tasks: readonly Task[]
  loadFailed: boolean
}): JSX.Element | null {
  const sessionsById = useBoard(selectSessionsById)
  const loaded = usePastSessions(selectPastSessionsLoaded)
  const records = usePastSessions(selectPastSessions)
  const rows = goalSessions(tasks, sessionsById, loaded ? records : null)
  if (rows.length === 0) return null
  const shown = rows.slice(0, GOAL_SESSION_ROWS_MAX)
  const more = rows.length - shown.length

  return (
    <div className={styles.workedOnField} data-testid="goal-sessions">
      <ManageDialog.Label>{GOAL_TERMS.workedOnBy}</ManageDialog.Label>
      {loadFailed && (
        <Callout
          tone="danger"
          title={PAST_SESSIONS_TERMS.loadFailed}
          testId="goal-sessions-load-failed"
        />
      )}
      <ul className={styles.workedOnBy}>
        {shown.map((row) => {
          if (row.state === 'past' && row.name !== null) {
            return (
              <GoalSessionRow
                key={row.id}
                id={row.id}
                name={row.name}
                taskTitles={row.taskTitles}
              />
            )
          }
          return (
            <li key={row.id} className={styles.workedOnRow} data-testid={`goal-session-${row.id}`}>
              {row.session !== null && (
                <span className={styles.workedOnHead}>
                  <SessionOpenButton session={row.session} testId={`goal-session-live-${row.id}`} />
                </span>
              )}
              {row.state === 'gone' && (
                <span className={styles.workedOnHead}>
                  <span className={styles.workedOnNote}>{GOAL_TERMS.noLongerListed}</span>
                </span>
              )}
              <TaskTitles titles={row.taskTitles} />
            </li>
          )
        })}
      </ul>
      {more > 0 && (
        <span className={styles.workedOnNote} data-testid="goal-sessions-more">
          {LIST_TERMS.more(more)}
        </span>
      )}
    </div>
  )
}
