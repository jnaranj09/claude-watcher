// The tasks of one goal (or the loose ones): a checkbox each, and `+ New task` as an inline field.
// Lives inside the goal form, so Enter in the field adds a task and never submits the goal.
import { useState, type JSX } from 'react'
import { TASK_TITLE_MAX, type Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { goalErrorCopy } from '../../lib/goalCopy'
import { removeTask, saveTask, setTaskStatus } from '../../stores/goalsStore'
import { Button } from '../Button/Button'
import { Checkbox } from '../Checkbox/Checkbox'
import { useManageDialogContext } from '../ManageDialog/ManageDialog'
import { TextInput } from '../TextInput/TextInput'
import styles from './GoalsDialog.module.css'

export interface TaskListProps {
  tasks: readonly Task[]
  workspaceId: string
  /** The goal the tasks belong to; null = the loose tasks. */
  goalId: string | null
}

export function TaskList({ tasks, workspaceId, goalId }: TaskListProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const [title, setTitle] = useState('')

  const toggle = useAsyncAction(async (task: Task, done: boolean): Promise<void> => {
    actions.setError(null)
    try {
      await setTaskStatus(task.id, done ? 'done' : 'open')
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveTaskFailed))
    }
  })
  const remove = useAsyncAction(async (task: Task): Promise<void> => {
    actions.setError(null)
    try {
      await removeTask(task.id)
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveTaskFailed))
    }
  })
  const add = useAsyncAction(async (): Promise<void> => {
    const trimmed = title.trim()
    if (trimmed === '') return
    try {
      await saveTask({ workspaceId, goalId, title: trimmed })
      setTitle('')
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveTaskFailed))
    }
  })

  return (
    <div className={styles.tasks} data-testid="task-list">
      <ul className={styles.taskRows}>
        {tasks.map((task) => (
          <li key={task.id} className={styles.task} data-done={task.status === 'done'}>
            <label className={styles.taskLabel}>
              <Checkbox
                ariaLabel={task.title}
                testId={`task-check-${task.id}`}
                checked={task.status === 'done'}
                onChange={(done) => void toggle.run(task, done)}
              />
              <span className={styles.taskTitle} title={task.title}>
                {task.title}
              </span>
            </label>
            {task.doneBy === 'session' && (
              <span
                className={styles.doneBy}
                data-testid={`task-done-by-${task.id}`}
                title="Closed by a session"
              >
                session
              </span>
            )}
            <Button
              variant="ghost"
              size="xs"
              icon
              testId={`task-remove-${task.id}`}
              aria-label={`Remove ${task.title}`}
              onClick={() => void remove.run(task)}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      <TextInput
        testId="task-new-input"
        ariaLabel={GOAL_TERMS.newTask}
        placeholder={GOAL_TERMS.newTask}
        maxLength={TASK_TITLE_MAX}
        value={title}
        onChange={(next) => {
          setTitle(next)
          actions.setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          void add.run()
        }}
      />
    </div>
  )
}
