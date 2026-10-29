// The tasks of one goal (or the loose ones): a `Done` / `Undo` button each, and `+ New task` as an
// inline field. Lives inside the goal form, so Enter in the field adds a task and never submits
// the goal.
//
// Start from tasks (spec 2026-10-19 "Start from tasks without the planner"): each OPEN task
// carries a select box at its start (`Select <title>`, the Active sessions page's row check); the
// only checkbox on the row, so it never reads as "done". While one is selected, a bar under the list (behind a divider,
// like that page's bulk bar) offers `Start session` with the `Claude can mark tasks done` switch:
// one session with every selected task. The switch starts on for each list and is not kept.
//
// Read more + edit (spec 2026-10-29 task read more + edit): each row's ▸ opens it to the full
// title and an `Edit` button; `Edit` swaps the title for a 3-row text area (the long title wraps)
// with `Save` / `Cancel`. A title stays one line: Enter (Shift too) saves, a pasted line break
// becomes a space, and Escape cancels the edit only. An empty or unchanged title saves nothing.
// Open and edit state live in each row and are not kept.
//
// Goals page polish (spec 2026-10-29): all of it — the caller's `head` (the progress bar) first —
// sits in one darker box; `Plan with Claude` stays outside it, in the goal form.
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
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
import { TextArea } from '../TextArea/TextArea'
import { TextInput } from '../TextInput/TextInput'
import styles from './GoalsDialog.module.css'

export interface TaskListProps {
  tasks: readonly Task[]
  workspaceId: string
  /** The goal the tasks belong to; null = the loose tasks. */
  goalId: string | null
  /** Drawn first inside the tasks box: the progress bar. */
  head?: ReactNode
}

export function TaskList({ tasks, workspaceId, goalId, head }: TaskListProps): JSX.Element {
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
      {head}
      <ul className={styles.taskRows}>
        {tasks.map((task) => (
          <OpenableTaskRow
            key={task.id}
            task={task}
            onToggle={(done) => void toggle.run(task, done)}
            leading={
              task.status === 'open' ? (
                <Checkbox
                  testId={`task-select-${task.id}`}
                  ariaLabel={`Select ${task.title}`}
                  checked={picked.has(task.id)}
                  onChange={(on) => setPick(task.id, on)}
                />
              ) : (
                // A done task cannot be selected: a blank of the box's width keeps its title in line.
                <span className={styles.checkBlank} aria-hidden="true" />
              )
            }
            remove={
              <Button
                variant="ghost"
                icon
                testId={`task-remove-${task.id}`}
                aria-label={`Remove ${task.title}`}
                onClick={() => void remove.run(task)}
              >
                ✕
              </Button>
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

// The edit row's button words. Kept here, like TaskRow's `Done` / `Undo`: one surface uses them.
const EDIT = 'Edit'
const SAVE = 'Save'
const CANCEL = 'Cancel'

/** One sheet row: `TaskRow` plus its ▸ / ▾ toggle and, once open, `Edit` and the edit field. */
function OpenableTaskRow({
  task,
  onToggle,
  leading,
  remove
}: {
  task: Task
  onToggle: (done: boolean) => void
  leading: ReactNode
  remove: ReactNode
}): JSX.Element {
  const { actions } = useManageDialogContext()
  const [open, setOpen] = useState(false)
  // The field's text while editing; null = not editing.
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const editing = draft !== null

  // Focus follows the swap: into the field when it opens, back to `Edit` when it closes.
  useEffect(() => {
    if (editing) inputRef.current?.focus()
    else if (wasEditing.current) editRef.current?.focus()
    wasEditing.current = editing
  }, [editing])

  // A refusal keeps the field and its text, so the operator can try again.
  const save = useAsyncAction(async (): Promise<void> => {
    const trimmed = (draft ?? '').trim()
    if (trimmed === '' || trimmed === task.title) {
      setDraft(null)
      return
    }
    actions.setError(null)
    try {
      await saveTask({
        id: task.id,
        workspaceId: task.workspaceId,
        goalId: task.goalId,
        title: trimmed
      })
      setDraft(null)
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveTaskFailed))
    }
  })

  const editor =
    draft === null ? undefined : (
      <span className={styles.taskEditor}>
        <span className={styles.taskEditField}>
          <TextArea
            testId={`task-edit-input-${task.id}`}
            ariaLabel={GOAL_TERMS.taskTitle}
            maxLength={TASK_TITLE_MAX}
            rows={3}
            value={draft}
            textAreaRef={inputRef}
            onChange={(next) => {
              // A title is one line: a pasted line break (and the space around it) is one space.
              setDraft(next.replace(/\s*[\r\n]+\s*/g, ' '))
              actions.setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save.run()
              } else if (e.key === 'Escape') {
                // Peels the edit only; the dialog stays open.
                e.stopPropagation()
                setDraft(null)
              }
            }}
          />
        </span>
        <Button
          variant="primary"
          testId={`task-edit-save-${task.id}`}
          busy={save.busy}
          onClick={() => void save.run()}
        >
          {SAVE}
        </Button>
        <Button
          variant="secondary"
          testId={`task-edit-cancel-${task.id}`}
          onClick={() => setDraft(null)}
        >
          {CANCEL}
        </Button>
      </span>
    )

  return (
    <TaskRow
      task={task}
      onToggle={onToggle}
      leading={leading}
      open={open}
      editor={editor}
      trailing={
        <>
          {open && (
            <Button
              variant="secondary"
              testId={`task-edit-${task.id}`}
              aria-label={`${EDIT} ${task.title}`}
              buttonRef={editRef}
              onClick={() => setDraft(task.title)}
            >
              {EDIT}
            </Button>
          )}
          <Button
            variant="ghost"
            icon
            testId={`task-open-${task.id}`}
            aria-label={`${open ? GOAL_TERMS.hideFullText : GOAL_TERMS.showFullText} ${task.title}`}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            {open ? '▾' : '▸'}
          </Button>
          {remove}
        </>
      }
    />
  )
}
