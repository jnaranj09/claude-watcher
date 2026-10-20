// The goals IPC handler BODIES, kept out of index.ts so they are unit-testable in node. Every arg is
// UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input (zod-boundaries.md
// IPC-arg row). ipc/registerStoreIpc.ts binds them to CH.* channels. The renderer never sends a
// path: a goal's folder is whatever main's own picker returned, and a start from tasks sends ids
// only (goals/goalLaunch.ts picks the folder and the names).
import {
  GoalDeleteSchema,
  GoalFolderSchema,
  GoalSaveSchema,
  GoalsStartSchema,
  TaskDeleteSchema,
  TaskLinkSchema,
  TaskSaveSchema,
  TaskStatusSchema,
  type Goal,
  type GoalsView
} from '../../shared/schemas/goal'
import type {
  GoalsSaveGoalResult,
  GoalsSaveTaskResult,
  GoalsStartResult
} from '../../shared/ipc/contract'
import { startGoalSessions, type StartGoalSessionsDeps } from '../goals/goalLaunch'
import { GOAL_ERROR, type GoalsStore } from './goals'

export interface GoalsIpcDeps {
  /** Opens the native folder picker for this goal (the registrar picks its start folder and its
   *  window). `null` = cancelled. */
  pickDirectory(goal: Goal): Promise<string | null>
  /** `goals:start-sessions`: what a start needs besides the store and the calling window's launch
   *  seam (the registrar passes that per call). */
  launch: Omit<StartGoalSessionsDeps, 'store' | 'requestLaunch'>
}

export interface GoalsIpcHandlers {
  list(): GoalsView
  saveGoal(raw: unknown): GoalsSaveGoalResult
  deleteGoal(raw: unknown): GoalsView
  pickFolder(raw: unknown): Promise<GoalsView>
  clearFolder(raw: unknown): GoalsView
  saveTask(raw: unknown): GoalsSaveTaskResult
  deleteTask(raw: unknown): GoalsView
  setTaskStatus(raw: unknown): GoalsView
  linkTask(raw: unknown): GoalsView
  unlinkTask(raw: unknown): GoalsView
  start(
    raw: unknown,
    requestLaunch: StartGoalSessionsDeps['requestLaunch']
  ): Promise<GoalsStartResult>
}

/** Where the folder picker opens: the goal's own folder, else its workspace's default folder, else
 *  null (the OS default). Read from main's records, never from the renderer. NEVER logged. */
export function goalPickerStart(goal: Goal, workspaceDefaultCwd: string | null): string | null {
  return goal.defaultCwd ?? workspaceDefaultCwd
}

export function createGoalsIpcHandlers(store: GoalsStore, deps: GoalsIpcDeps): GoalsIpcHandlers {
  return {
    list: () => store.view(),
    saveGoal: (raw) => store.saveGoal(GoalSaveSchema.parse(raw)),
    deleteGoal: (raw) => store.removeGoal(GoalDeleteSchema.parse(raw).id),
    pickFolder: async (raw) => {
      const { goalId } = GoalFolderSchema.parse(raw)
      const goal = store.view().goals.find((g) => g.id === goalId)
      if (goal === undefined) throw new Error(GOAL_ERROR.goalNotFound)
      const picked = await deps.pickDirectory(goal)
      // Cancel changes nothing. The picked path is re-read against the store: a goal deleted
      // while the dialog was open throws goal_not_found instead of resurrecting anything.
      return picked === null ? store.view() : store.setGoalFolder(goalId, picked)
    },
    clearFolder: (raw) => store.setGoalFolder(GoalFolderSchema.parse(raw).goalId, null),
    saveTask: (raw) => store.saveTask(TaskSaveSchema.parse(raw)),
    deleteTask: (raw) => store.removeTask(TaskDeleteSchema.parse(raw).id),
    setTaskStatus: (raw) => {
      const { id, status } = TaskStatusSchema.parse(raw)
      return store.setTaskStatus(id, status, 'operator')
    },
    linkTask: (raw) => {
      const { taskId, sessionId } = TaskLinkSchema.parse(raw)
      return store.link(taskId, sessionId)
    },
    unlinkTask: (raw) => {
      const { taskId, sessionId } = TaskLinkSchema.parse(raw)
      return store.unlink(taskId, sessionId)
    },
    start: async (raw, requestLaunch) =>
      startGoalSessions(GoalsStartSchema.parse(raw), { ...deps.launch, store, requestLaunch })
  }
}
