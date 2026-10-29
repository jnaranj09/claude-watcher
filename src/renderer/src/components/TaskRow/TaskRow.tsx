// One task as a boxed row: the title (done = secondary + line-through), the `Closed by a session`
// marker when a session closed it, and its `Done` / `Undo` button. Drawn once for the Goals sheet
// and the focused view's task panel (same meaning, same look); each passes its own `leading`
// control (the sheet's select box) and trailing action (an `md` ghost icon button, the height of
// `Done`). The Goals sheet also opens a row to its full title (`open`) and swaps the title for its
// edit field (`editor`); the task panel sets neither.
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
  editor
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
  const title = (
    <span className={styles.title} title={task.title}>
      {task.title}
    </span>
  )
  return (
    <li className={styles.row} data-done={done} data-open={open}>
      {leading === undefined ? (
        <span className={styles.text}>{title}</span>
      ) : (
        <label className={styles.label}>
          {leading}
          {title}
        </label>
      )}
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
    </li>
  )
}
