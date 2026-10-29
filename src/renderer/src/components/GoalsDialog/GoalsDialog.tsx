// Goals — the sheet where goals and tasks are planned by hand (spec 2026-10-19-goals, "Plan by
// hand") or with a planner session (`Plan with Claude`, whose proposal shows under the goal's
// tasks: ProposalPanel), on the shared ManageDialog shell at its `drop` size: a sheet that drops
// from under the app header over the board or the terminal view, 75% of the body each way. Rail =
// `Daily tasks` first (the tasks with no goal; open on every open of the sheet, and where a deleted
// goal leaves the sheet, so the right column is never empty), then this workspace's goals, each with
// `done/total` and a bar; right column = the selected row's tasks (a goal's inside its form).
//
// Main owns the records (goalsStore is a projection); this file sends ids and intents and draws
// what main answers. Every refusal reaches the dialog's error toast through `goalErrorCopy`.
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { GOAL_NAME_MAX, type Goal, type Proposal, type Task } from '../../../../shared/schemas/goal'
import { FOLDER_TERMS, GOAL_TERMS } from '../../copy/terms'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import {
  goalErrorCopy,
  goalFileProblemCopy,
  goalPlanErrorCopy,
  isFolderCancelled
} from '../../lib/goalCopy'
import {
  pickGoalFolder,
  planGoal,
  progressOf,
  removeGoal,
  saveGoal,
  selectGoalsIn,
  goalsStore,
  selectFileProblemOf,
  selectGoalsLoadFailed,
  selectLooseTasks,
  selectProposalsOfGoal,
  selectTasksOfGoal,
  setGoalSaveToFile,
  useGoals
} from '../../stores/goalsStore'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { ManageDialog, useManageDialog, useManageDialogContext } from '../ManageDialog/ManageDialog'
import { TextInput } from '../TextInput/TextInput'
import { Callout } from '../Callout/Callout'
import { Switch } from '../Switch/Switch'
import { GoalProgress } from '../GoalProgress/GoalProgress'
import { TaskList } from './TaskList'
import { ProposalPanel } from './ProposalPanel'
import styles from './GoalsDialog.module.css'

export interface GoalsDialogProps {
  onClose: () => void
}

/** A proposal's identity for React: its planner and its split, so a replaced proposal remounts. */
function proposalKey(p: Proposal): string {
  return `${p.plannerSessionId}:${JSON.stringify(p.groups)}`
}

/** The `Daily tasks` rail row's id. Goal ids are minted uuids, so it cannot collide with one. */
const DAILY_ID = 'daily'

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

function DailyRowText({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { done, total } = progressOf(useGoals(selectLooseTasks(workspaceId)))
  return (
    <span className={styles.rowText}>
      <span className={styles.rowName}>{GOAL_TERMS.daily}</span>
      <GoalProgress name={GOAL_TERMS.daily} done={done} total={total} />
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
 *  goal being created shows only its name until it is saved; `Create` makes main open its folder
 *  picker first (no goal without a folder; a cancel creates nothing and says nothing). A goal from
 *  before that rule (no folder) says so and offers no `Save to GOALS.md`, `Plan with Claude` or
 *  `Start session` until it has one. */
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
  const proposals = useGoals(selectProposalsOfGoal(goal?.id ?? ''))
  const { done, total } = progressOf(tasks)
  const fileProblem = useGoals(selectFileProblemOf(goal?.id ?? ''))
  const saveToFileId = useId()

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
      if (!isFolderCancelled(err)) actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    } finally {
      setBusy(false)
    }
  }

  // A change made while this goal is open that left its GOALS.md behind is a result: the error
  // toast. A problem already there when the goal opened is only the Callout below.
  const seenProblem = useRef(fileProblem)
  useEffect(() => {
    if (fileProblem !== null && fileProblem !== seenProblem.current) {
      actions.setError(GOAL_TERMS.fileNotUpdated(goalFileProblemCopy(fileProblem)))
    }
    seenProblem.current = fileProblem
  }, [fileProblem, actions])

  // On (and `Try again`) always rewrites the file in main; a problem comes back in the view.
  const saveToFile = useAsyncAction(async (on: boolean): Promise<void> => {
    if (goal === null) return
    actions.setError(null)
    try {
      await setGoalSaveToFile(goal.id, on)
      if (!on) return
      // A problem the rewrite left (new or the same as before) is this action's result too.
      const problem = selectFileProblemOf(goal.id)(goalsStore.getState())
      if (problem === null) actions.showSuccess('Saved')
      else actions.setError(GOAL_TERMS.fileNotUpdated(goalFileProblemCopy(problem)))
    } catch (err) {
      actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    }
  })

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
  // A planner card appears on the board without taking the view; the sheet stays open.
  const plan = useAsyncAction(async (): Promise<void> => {
    if (goal === null) return
    actions.setError(null)
    try {
      await planGoal(goal.id)
      actions.showSuccess(GOAL_TERMS.plannerStarted)
    } catch (err) {
      const copy = goalPlanErrorCopy(err)
      if (copy !== null) actions.setError(copy)
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
          <ManageDialog.Label>{FOLDER_TERMS.label}</ManageDialog.Label>
          <div className={styles.folderRow}>
            <span className={styles.path} data-testid="goal-default-cwd">
              {goal.defaultCwd ?? 'None'}
            </span>
            <ManageDialog.GhostButton
              testId="goal-browse"
              busy={browse.busy}
              onClick={() => void browse.run()}
            >
              {FOLDER_TERMS.choose}
            </ManageDialog.GhostButton>
          </div>
          {goal.defaultCwd === null ? (
            <Callout tone="danger" title={GOAL_TERMS.noFolderYet} testId="goal-no-folder" />
          ) : (
            <>
              <span className={styles.saveToFile}>
                <Switch
                  id={saveToFileId}
                  testId="goal-save-to-file"
                  checked={goal.saveToFile}
                  disabled={saveToFile.busy}
                  onChange={(on) => void saveToFile.run(on)}
                />
                <label className={styles.saveToFileLabel} htmlFor={saveToFileId}>
                  {GOAL_TERMS.saveToFile}
                </label>
              </span>
              <ManageDialog.Hint testId="goal-save-to-file-hint">
                {GOAL_TERMS.saveToFileHint}
              </ManageDialog.Hint>
              {fileProblem !== null && (
                <Callout
                  tone="danger"
                  title={goalFileProblemCopy(fileProblem)}
                  testId="goal-file-problem"
                  action={
                    <ManageDialog.GhostButton
                      testId="goal-file-retry"
                      busy={saveToFile.busy}
                      onClick={() => void saveToFile.run(true)}
                    >
                      {GOAL_TERMS.tryAgain}
                    </ManageDialog.GhostButton>
                  }
                />
              )}
            </>
          )}

          <ManageDialog.Label>{GOAL_TERMS.tasks}</ManageDialog.Label>
          <TaskList
            tasks={tasks}
            workspaceId={workspaceId}
            goalId={goal.id}
            head={<GoalProgress name={goal.name} done={done} total={total} />}
          />
          {goal.defaultCwd !== null && (
            <div className={styles.planRow}>
              <ManageDialog.GhostButton
                testId="goal-plan"
                busy={plan.busy}
                onClick={() => void plan.run()}
              >
                {GOAL_TERMS.planWithClaude}
              </ManageDialog.GhostButton>
            </div>
          )}
          {proposals.map((p) => (
            // Keyed by the proposal itself: a new `propose_split` starts a fresh draft.
            <ProposalPanel key={proposalKey(p)} proposal={p} tasks={tasks} />
          ))}
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
  const daily: Task[] = useGoals(selectLooseTasks(workspaceId))
  const { done: dailyDone, total: dailyTotal } = progressOf(daily)
  const loadFailed = useGoals(selectGoalsLoadFailed)
  const dialog = useManageDialog({
    title: GOAL_TERMS.label,
    testIdPrefix: 'goals',
    onClose,
    initialSelectedId: DAILY_ID
  })
  const { closeRef } = dialog.meta
  const [deleteBusy, setDeleteBusy] = useState(false)

  // An aria-modal dialog must take focus on mount; the ✕ is the mount-stable target (as in
  // WorkspacesDialog).
  useEffect(() => {
    closeRef.current?.focus()
  }, [closeRef])

  const selected = goals.find((g) => g.id === dialog.state.selectedId) ?? null
  const formOpen = dialog.state.creating || selected !== null

  async function commitDelete(id: string): Promise<void> {
    setDeleteBusy(true)
    try {
      await removeGoal(id)
      dialog.actions.select(DAILY_ID)
      dialog.actions.showSuccess('Goal deleted.')
    } catch (err) {
      dialog.actions.setError(goalErrorCopy(err, GOAL_TERMS.saveGoalFailed))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <ManageDialog.Provider {...dialog}>
      <ManageDialog.Frame size="drop">
        <ManageDialog.Header />
        <ManageDialog.Columns>
          <ManageDialog.List size="wide">
            <ManageDialog.Rows>
              <ManageDialog.Row
                id={DAILY_ID}
                testId="goal-row-daily"
                selectTestId="goal-select-daily"
              >
                <DailyRowText workspaceId={workspaceId} />
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
          ) : (
            // Daily tasks: every other selection is a goal (its form above), and a goal that is
            // gone (deleted elsewhere) falls back here too, never to an empty column.
            <ManageDialog.Pane testId="goal-daily-pane">
              <ManageDialog.Label>{GOAL_TERMS.tasks}</ManageDialog.Label>
              <TaskList
                tasks={daily}
                workspaceId={workspaceId}
                goalId={null}
                head={<GoalProgress name={GOAL_TERMS.daily} done={dailyDone} total={dailyTotal} />}
              />
            </ManageDialog.Pane>
          )}
        </ManageDialog.Columns>
      </ManageDialog.Frame>
    </ManageDialog.Provider>
  )
}
