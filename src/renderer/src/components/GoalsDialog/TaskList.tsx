// The tasks of one goal (or the loose ones): a checkbox each, and `+ New task` as an inline field.
// Lives inside the goal form, so Enter in the field adds a task and never submits the goal.
//
// Start from tasks (spec 2026-10-19 "Start from tasks without the planner"): each OPEN task also
// carries a select box at its end (`Select <title>`, the Active sessions page's row check), apart
// from the done box at its start. While one is selected, a bar under the list (behind a divider,
// like that page's bulk bar) offers `Start session` with the `Claude can mark tasks done` switch:
// one session with every selected task. The switch starts on for each list and is not kept.
import { useId, useState, type JSX } from 'react'
import { TASK_TITLE_MAX, type Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS, SELECTION_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { goalErrorCopy, goalStartErrorCopy } from '../../lib/goalCopy'
import { removeTask, saveTask, setTaskStatus, startSessions } from '../../stores/goalsStore'
import { Button } from '../Button/Button'
import { Checkbox } from '../Checkbox/Checkbox'
import { ManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { Switch } from '../Switch/Switch'
import { TaskRow } from '../TaskRow/TaskRow'
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
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [markDone, setMarkDone] = useState(true)
  const switchId = useId()
  // Only open tasks can be selected; one closed or deleted since drops out of the selection.
  const selectedIds = tasks.filter((t) => t.status === 'open' && picked.has(t.id)).map((t) => t.id)

  function setPick(id: string, on: boolean): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

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
  // A refusal keeps the selection, so the operator can fix the folder and press again.
  const start = useAsyncAction(async (): Promise<void> => {
    if (selectedIds.length === 0) return
    actions.setError(null)
    try {
      await startSessions({ workspaceId, goalId, groups: [{ taskIds: selectedIds }], markDone })
      setPicked(new Set())
      actions.showSuccess(GOAL_TERMS.sessionStarted)
    } catch (err) {
      const copy = goalStartErrorCopy(err)
      if (copy !== null) actions.setError(copy)
    }
  })
  const add = useAsyncAction(async (): Promise<void> => {
    const trimmed = title.trim()
    if (trimmed === '') return
    actions.setError(null)
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
          <TaskRow
            key={task.id}
            task={task}
            onToggle={(done) => void toggle.run(task, done)}
            trailing={
              <>
                {task.status === 'open' && (
                  <Checkbox
                    testId={`task-select-${task.id}`}
                    ariaLabel={`Select ${task.title}`}
                    checked={picked.has(task.id)}
                    onChange={(on) => setPick(task.id, on)}
                  />
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
              </>
            }
          />
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
      {/* Rendered only while a task is selected: a control you cannot use is not drawn. */}
      {selectedIds.length > 0 && (
        <div className={styles.startBar} data-testid="task-start-bar">
          <span className={styles.startCount} data-testid="task-start-count">
            {SELECTION_TERMS.count(selectedIds.length)}
          </span>
          <span className={styles.startSwitch}>
            <Switch
              id={switchId}
              testId="task-start-mark-done"
              checked={markDone}
              onChange={setMarkDone}
            />
            <label className={styles.startSwitchLabel} htmlFor={switchId}>
              {GOAL_TERMS.markDone}
            </label>
          </span>
          <ManageDialog.GhostButton
            testId="task-start"
            busy={start.busy}
            onClick={() => void start.run()}
          >
            {GOAL_TERMS.startSession}
          </ManageDialog.GhostButton>
        </div>
      )}
    </div>
  )
}
