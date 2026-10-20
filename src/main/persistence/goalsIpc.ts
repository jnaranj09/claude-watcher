// The goals IPC handler BODIES, kept out of index.ts so they are unit-testable in node. Every arg is
// UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input (zod-boundaries.md
// IPC-arg row). ipc/registerStoreIpc.ts binds them to CH.* channels. The renderer never sends a
// path: a goal's folder is whatever main's own picker returned, and a start from tasks sends ids
// only (goals/goalLaunch.ts picks the folder and the names). "Plan with Claude" sends a goal id;
// a decision on a planner's proposal sends the planner's id and, for Accept, the (possibly edited)
// groups of task ids, which pass the same checks as `Start session`.
import {
  GoalDeleteSchema,
  GoalFolderSchema,
  GoalSaveSchema,
  GoalsPlanSchema,
  GoalsStartSchema,
  ProposalDecideSchema,
  TaskDeleteSchema,
  TaskLinkSchema,
  TaskSaveSchema,
  TaskStatusSchema,
  type Goal,
  type GoalsView
} from '../../shared/schemas/goal'
import type {
  GoalsDecideResult,
  GoalsSaveGoalResult,
  GoalsSaveTaskResult,
  GoalsStartResult
} from '../../shared/ipc/contract'
import { startGoalSessions, startPlanner, type StartGoalSessionsDeps } from '../goals/goalLaunch'
import type { Proposals } from '../goals/proposals'
import { GOAL_ERROR, type GoalsStore } from './goals'

/** A decision on a proposal that is no longer there (the planner card went, or it was decided). */
export const PROPOSAL_NOT_FOUND = 'proposal_not_found'

export interface GoalsIpcDeps {
  /** Opens the native folder picker for this goal (the registrar picks its start folder and its
   *  window). `null` = cancelled. */
  pickDirectory(goal: Goal): Promise<string | null>
  /** `goals:start-sessions`: what a start needs besides the store and the calling window's launch
   *  seam (the registrar passes that per call). */
  launch: Omit<StartGoalSessionsDeps, 'store' | 'requestLaunch'>
  /** The planners' proposals (memory only, goals/proposals.ts). */
  proposals: Pick<Proposals, 'get' | 'clear'>
  /** SEC-6: whether THIS process holds the hook port that serves the planner's tools. */
  hookListening(): boolean
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
  plan(
    raw: unknown,
    requestLaunch: StartGoalSessionsDeps['requestLaunch']
  ): Promise<GoalsStartResult>
  decideProposal(
    raw: unknown,
    requestLaunch: StartGoalSessionsDeps['requestLaunch']
  ): Promise<GoalsDecideResult>
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
      startGoalSessions(GoalsStartSchema.parse(raw), { ...deps.launch, store, requestLaunch }),
    plan: async (raw, requestLaunch) =>
      startPlanner(GoalsPlanSchema.parse(raw).goalId, {
        ...deps.launch,
        store,
        requestLaunch,
        hookListening: deps.hookListening
      }),
    decideProposal: async (raw, requestLaunch) => {
      const req = ProposalDecideSchema.parse(raw)
      if (req.decision === 'reject') {
        // Already gone is the same outcome: nothing to start, nothing left to show.
        deps.proposals.clear(req.plannerSessionId)
        return { terminalIds: [], ...store.view() }
      }
      const proposal = deps.proposals.get(req.plannerSessionId)
      if (proposal === null) throw new Error(PROPOSAL_NOT_FOUND)
      const goal = store.view().goals.find((g) => g.id === proposal.goalId)
      if (goal === undefined) throw new Error(GOAL_ERROR.goalNotFound)
      // An edit moves tasks between rows or drops a row: it never adds a task the planner did
      // not propose.
      const proposed = new Set(proposal.groups.flatMap((g) => g.taskIds))
      const groups = req.groups ?? proposal.groups.map((g) => ({ taskIds: g.taskIds }))
      if (groups.some((g) => g.taskIds.some((id) => !proposed.has(id)))) {
        throw new Error(GOAL_ERROR.taskNotFound)
      }
      // The same request and checks as `Start session`; all names are built before the first
      // launch, so a refusal launches nothing and keeps the proposal.
      const { terminalIds } = await startGoalSessions(
        GoalsStartSchema.parse({
          workspaceId: goal.workspaceId,
          goalId: goal.id,
          groups,
          markDone: req.markDone
        }),
        { ...deps.launch, store, requestLaunch }
      )
      // Only the proposal that was accepted: a newer `propose_split` that landed meanwhile (the
      // folder picker can be open for a while) stays for the operator to decide.
      if (deps.proposals.get(req.plannerSessionId) === proposal) {
        deps.proposals.clear(req.plannerSessionId)
      }
      return { terminalIds, ...store.view() }
    }
  }
}
