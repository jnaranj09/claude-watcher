// One task as a row: a Checkbox, the title (done = secondary + line-through), and the
// `Closed by a session` marker when a session closed it. Drawn once for the Goals sheet and the
// focused view's task panel (same meaning, same look); each passes its own trailing action.
import type { JSX, ReactNode } from 'react'
import type { Task } from '../../../../shared/schemas/goal'
import { Checkbox } from '../Checkbox/Checkbox'
import styles from './TaskRow.module.css'

export function TaskRow({
  task,
  onToggle,
  busy = false,
  trailing
}: {
  task: Task
  /** Gets the NEW done value. */
  onToggle: (done: boolean) => void
  /** Its change is in flight: the checkbox is disabled until main answers. */
  busy?: boolean
  trailing?: ReactNode
}): JSX.Element {
  return (
    <li className={styles.row} data-done={task.status === 'done'}>
      <label className={styles.label}>
        <Checkbox
          ariaLabel={task.title}
          testId={`task-check-${task.id}`}
          checked={task.status === 'done'}
          onChange={onToggle}
          disabled={busy}
        />
        <span className={styles.title} title={task.title}>
          {task.title}
        </span>
      </label>
      {task.doneBy === 'session' && (
        <span className={styles.doneBy} data-testid={`task-done-by-${task.id}`}>
          Closed by a session
        </span>
      )}
      {trailing}
    </li>
  )
}
