// Goals — the sheet where goals and tasks are planned by hand (spec 2026-10-19-goals, "Plan by
// hand"), on the shared ManageDialog shell at its `full` size: a page on top of the board or the
// terminal view, with a small gap on the sides. Rail = `Loose tasks` first, then this workspace's
// goals, each with `done/total` and a bar; right column = the goal's form and its tasks.
//
// Main owns the records (goalsStore is a projection); this file sends ids and intents and draws
// what main answers. Every refusal reaches the ONE message slot through `goalErrorCopy`.
import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { GOAL_NAME_MAX, type Goal, type Task } from '../../../../shared/schemas/goal'
import { GOAL_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { goalErrorCopy } from '../../lib/goalCopy'
import {
  clearGoalFolder,
  pickGoalFolder,
  progressOf,
  removeGoal,
  saveGoal,
  selectGoalsIn,
  selectGoalsLoadFailed,
  selectLooseTasks,
  selectTasksOfGoal,
  useGoals
} from '../../stores/goalsStore'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { TextInput } from '../TextInput/TextInput'
import { GoalProgress } from './GoalProgress'
import { TaskList } from './TaskList'
import styles from './GoalsDialog.module.css'

export interface GoalsDialogProps {
  onClose: () => void
}

/** The `Loose tasks` rail row's id. Goal ids are minted uuids, so it cannot collide with one. */
const LOOSE_ID = 'loose'

function GoalRowText({ goal }: { goal: Goal }): JSX.Element {
  const { done, total } = progressOf(useGoals(selectTasksOfGoal(goal.id)))
  return (
    <span className={styles.rowText}>
      <span className={styles.rowName} title={goal.name}>
        {goal.name}
      </span>
      <GoalProgress name={goal.name} done={done} total={total} />
    </span>
  )
}

function LooseRowText({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { done, total } = progressOf(useGoals(selectLooseTasks(workspaceId)))
  return (
    <span className={styles.rowText}>
      <span className={styles.rowName}>{GOAL_TERMS.loose}</span>
      <GoalProgress name={GOAL_TERMS.loose} done={done} total={total} />
    </span>
  )
}

interface GoalFormProps {
  goal: Goal | null
  workspaceId: string
  deleteBusy: boolean
  onSaved: (saved: Goal) => void
  onDelete: () => void
}

/** Keyed by the selected id in GoalsDialog, so a selection change remounts it with a fresh draft
 *  (same reasoning as WorkspaceForm). The Default folder row and the tasks need a goal id, so a
 *  goal being created shows only its name until it is saved. */
function GoalForm({
  goal,
  workspaceId,
  deleteBusy,
  onSaved,
  onDelete
}: GoalFormProps): JSX.Element {
  const { actions } = useManageDialogContext()
  const [name, setName] = useState(goal?.name ?? '')
  const [busy, setBusy] = useState(false)
  const tasks = useGoals(selectTasksOfGoal(goal?.id ?? ''))
  const { done, total } = progressOf(tasks)

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && (goal === null || trimmed !== goal.name) && !busy

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      onSaved(
        await saveGoal(
          goal === null
            ? { workspaceId, name: trimmed }
            : { id: goal.id, workspaceId, name: trimmed }
        )
      )
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    } finally {
      setBusy(false)
    }
  }

  // Main opens its own folder picker by goal id; the renderer never holds the path it stores.
  const browse = useAsyncAction(async (): Promise<void> => {
    if (goal === null) return
    actions.setError(null)
    try {
      await pickGoalFolder(goal.id)
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    }
  })
  const clear = useAsyncAction(async (): Promise<void> => {
    if (goal === null) return
    actions.setError(null)
    try {
      await clearGoalFolder(goal.id)
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    }
  })

  return (
    <ManageDialog.Form testId="goal-form" onSubmit={(e) => void submit(e)}>
      <ManageDialog.Label htmlFor="goal-name">Name</ManageDialog.Label>
      <TextInput
        id="goal-name"
        testId="goal-name-input"
        maxLength={GOAL_NAME_MAX}
        value={name}
        onChange={(next) => {
          setName(next)
          actions.setError(null)
        }}
      />

      {goal !== null && (
        <>
          <ManageDialog.Label>Default folder</ManageDialog.Label>
          <div className={styles.folderRow}>
            <span className={styles.path} data-testid="goal-default-cwd">
              {goal.defaultCwd ?? 'None'}
            </span>
            <ManageDialog.GhostButton
              testId="goal-browse"
              busy={browse.busy}
              onClick={() => void browse.run()}
            >
              Choose…
            </ManageDialog.GhostButton>
            {/* The way back to None. Not rendered while there is nothing to clear. */}
            {goal.defaultCwd !== null && (
              <ManageDialog.GhostButton
                testId="goal-clear-folder"
                busy={clear.busy}
                onClick={() => void clear.run()}
              >
                Clear
              </ManageDialog.GhostButton>
            )}
          </div>

          <ManageDialog.Label>Tasks</ManageDialog.Label>
          <GoalProgress name={goal.name} done={done} total={total} />
          <TaskList tasks={tasks} workspaceId={workspaceId} goalId={goal.id} />
        </>
      )}

      <ManageDialog.Footer>
        {goal !== null && (
          <ManageDialog.Delete
            testId={`goal-delete-${goal.id}`}
            armedTestId="goal-delete-confirm"
            disabled={deleteBusy}
            onConfirm={onDelete}
          />
        )}
        <ManageDialog.Save testId="goal-submit" disabled={!canSave}>
          {goal === null ? 'Create' : 'Save'}
        </ManageDialog.Save>
      </ManageDialog.Footer>
    </ManageDialog.Form>
  )
}

export function GoalsDialog({ onClose }: GoalsDialogProps): JSX.Element {
  const workspaceId = useWorkspaces(selectActiveWorkspaceId)
  const goals = useGoals(selectGoalsIn(workspaceId))
  const loose: Task[] = useGoals(selectLooseTasks(workspaceId))
  const loadFailed = useGoals(selectGoalsLoadFailed)
  const dialog = useManageDialog({ title: GOAL_TERMS.label, testIdPrefix: 'goals', onClose })
  const { closeRef } = dialog.meta
  const [deleteBusy, setDeleteBusy] = useState(false)

  // An aria-modal dialog must take focus on mount; the ✕ is the mount-stable target (as in
  // WorkspacesDialog).
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  const selected = goals.find((g) => g.id === dialog.state.selectedId) ?? null
  const looseOpen = dialog.state.selectedId === LOOSE_ID
  const formOpen = dialog.state.creating || selected !== null

  async function commitDelete(id: string): Promise<void> {
    setDeleteBusy(true)
    try {
      await removeGoal(id)
      dialog.actions.select(null)
      dialog.actions.showSuccess('Goal deleted.')
    } catch (err) {
      dialog.actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame size="full">
        <ManageDialog.Header />
        <ManageDialog.Columns>
          <ManageDialog.List size="wide">
            <ManageDialog.Rows>
              <ManageDialog.Row
                id={LOOSE_ID}
                testId="goal-row-loose"
                selectTestId="goal-select-loose"
              >
                <LooseRowText workspaceId={workspaceId} />
              </ManageDialog.Row>
              {goals.map((g) => (
                <ManageDialog.Row
                  key={g.id}
                  id={g.id}
                  testId={`goal-row-${g.id}`}
                  selectTestId={`goal-select-${g.id}`}
                >
                  <GoalRowText goal={g} />
                </ManageDialog.Row>
              ))}
              {goals.length === 0 && loadFailed && (
                <p className={styles.loadFailed} data-testid="goals-load-failed">
                  Could not load goals.
                </p>
              )}
            </ManageDialog.Rows>
            <ManageDialog.New testId="goal-new" label={GOAL_TERMS.newGoal} />
          </ManageDialog.List>
          {formOpen ? (
            <GoalForm
              key={selected?.id ?? 'new'}
              goal={selected}
              workspaceId={workspaceId}
              deleteBusy={deleteBusy}
              onSaved={(saved) => {
                dialog.actions.select(saved.id)
                dialog.actions.showSuccess('Goal saved.')
              }}
              onDelete={() => {
                if (selected !== null) void commitDelete(selected.id)
              }}
            />
          ) : looseOpen ? (
            <ManageDialog.Pane testId="goal-loose-pane">
              <TaskList tasks={loose} workspaceId={workspaceId} goalId={null} />
            </ManageDialog.Pane>
          ) : (
            <ManageDialog.Placeholder testId="goals-placeholder">
              {GOAL_TERMS.placeholder}
            </ManageDialog.Placeholder>
          )}
        </ManageDialog.Columns>
        <ManageDialog.Message testId="goals-error" />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
