// One task as a boxed row: the title (done = secondary + line-through), the `Closed by a session`
// marker when a session closed it, and its `Done` / `Undo` button. Under that first line, the full
// row wide (memory phase 2, PICK.md look 1): `Check: <recipe>` when the task has a check, and, while
// it is open, `Reported done by "<session>" <date>` with the evidence when a session reported it
// done. A report only FLAGS the task: the row is not drawn closed and `Done` stays the operator's. Drawn once for the Goals sheet
// and the focused view's task panel (same meaning, same look); each passes its own `leading`
// control (the sheet's select box) and trailing action (an `md` ghost icon button, the height of
// `Done`). The Goals sheet also opens a row to its full title (`open`) and swaps the title for its
// edit field (`editor`), and draws its live sessions under the title (`sessions`); the task panel
// sets none of them.
import type { JSX, ReactNode } from 'react'
import type { Task } from '../../../../shared/schemas/goal'
import { Button } from '../Button/Button'
import styles from './TaskRow.module.css'

// The row's button words. Kept here, not in copy/terms.ts: the Shortcuts phrase editor's `Done`
// (go back to the form) is another thing with the same word.
const DONE = 'Done'
const UNDO = 'Undo'

export function TaskRow({
  task,
  onToggle,
  busy = false,
  leading,
  trailing,
  open = false,
  editor,
  sessions
}: {
  task: Task
  /** Gets the NEW done value. */
  onToggle: (done: boolean) => void
  /** Its change is in flight: the button is disabled until main answers. */
  busy?: boolean
  /** A control before the title; the title becomes its label (clicking it toggles the control). */
  leading?: ReactNode
  trailing?: ReactNode
  /** The row is open: the title wraps in full instead of ending in `…`. */
  open?: boolean
  /** While set, the row shows `leading` and this (the edit field and its buttons) and nothing
   *  else. */
  editor?: ReactNode
  /** A line under the title: the Goals sheet's live sessions on this task. */
  sessions?: ReactNode
}): JSX.Element {
  const done = task.status === 'done'
  if (editor !== undefined) {
    return (
      <li className={styles.row} data-done={done} data-editing="true">
        {leading}
        {editor}
      </li>
    )
  }
  // A `done` report on a task the operator has not closed. Once closed, the flag has done its job.
  const reported = task.report?.outcome === 'done' && !done ? task.report : null
  const title = (
    <span className={styles.title} title={task.title}>
      {task.title}
    </span>
  )
  return (
    <li className={styles.row} data-done={done} data-open={open}>
      <span className={styles.main}>
        {leading === undefined ? (
          <span className={styles.text}>{title}</span>
        ) : (
          <label className={styles.label}>
            {leading}
            {title}
          </label>
        )}
        {sessions}
      </span>
      {task.doneBy === 'session' && (
        <span className={styles.doneBy} data-testid={`task-done-by-${task.id}`}>
          Closed by a session
        </span>
      )}
      <span className={styles.actions}>
        <Button
          variant="secondary"
          testId={`task-done-${task.id}`}
          aria-label={`${done ? UNDO : DONE} ${task.title}`}
          busy={busy}
          onClick={() => onToggle(!done)}
        >
          {done ? UNDO : DONE}
        </Button>
        {trailing}
      </span>
      {(task.check !== null || reported !== null) && (
        <span className={styles.notes}>
          {/* With a select box the lines start under the title, past the box. */}
          {leading !== undefined && (
            <span
              className={styles.noteIndent}
              data-testid={`task-notes-indent-${task.id}`}
              aria-hidden="true"
            />
          )}
          <span className={styles.noteLines}>
            {task.check !== null && (
              <span
                className={styles.note}
                data-testid={`task-check-${task.id}`}
                title={`Check: ${task.check}`}
              >
                Check: <span className={styles.recipe}>{task.check}</span>
              </span>
            )}
            {reported !== null && (
              <ReportLines id={task.id} name={reported.sessionName} at={reported.at}>
                {reported.evidence}
              </ReportLines>
            )}
          </span>
        </span>
      )}
    </li>
  )
}

/** `Reported done by "<session>" <date>` and, under it, what the session saw. The date is the app's
 *  `toLocaleString()`, as the forms' `Ended` and `Last seen`. */
function ReportLines({
  id,
  name,
  at,
  children: evidence
}: {
  id: string
  name: string
  at: number
  children: string
}): JSX.Element {
  const date = new Date(at).toLocaleString()
  const line = `Reported done by "${name}" ${date}`
  // Ruling R47: on a closed row only the session name is cut with `…`; the words around it and
  // the date always show whole.
  return (
    <>
      <span
        className={`${styles.note} ${styles.report}`}
        data-testid={`task-report-${id}`}
        title={line}
      >
        <span className={styles.reportFixed}>Reported done by &quot;</span>
        <span className={styles.reportName}>{name}</span>
        <span className={styles.reportFixed}>&quot; {date}</span>
      </span>
      <span className={styles.note} data-testid={`task-report-evidence-${id}`} title={evidence}>
        {evidence}
      </span>
    </>
  )
}
