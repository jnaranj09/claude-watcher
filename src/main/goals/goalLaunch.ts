// Start sessions from goal tasks (spec 2026-10-19 goals, "Start from tasks without the planner").
//
// `startGoalSessions` is the `goals:start-sessions` body: it checks every task, finds ONE folder
// for the whole start (the goal's, else the workspace's, else the picker once), and asks for one
// launch per group through the API's launch seam (`ApiSeam.requestLaunch`): the terminal mounts
// hidden and the view never moves (spec Constraints, §2). The renderer sends ids and intents only;
// the folder and the name are main's.
//
// `goalSpawnExtras` runs inside every actual spawn of such a session (`rawClaudeSpawn`): it links
// the tasks to the freshly minted session id and writes the prompt block from main's own records.
// Never logs a title, a name or a path (`code=` only).
import type { GoalsStartRequest, Task } from '../../shared/schemas/goal'
import { LAUNCH_CANCELLED } from '../../shared/schemas/goal'
import { SessionNameSchema } from '../../shared/schemas/launch'
import type { GoalsStartResult } from '../../shared/ipc/contract'
import { GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { LAUNCH_FOLDER_MISSING, type LaunchRequest } from '../pty/launchSession'
import { requireClaudeVersion } from '../pty/inAppLaunch'
import { buildWorkerPrompt, taskSessionName } from './goalPrompt'

/** What a launch from goals carries on its durable recipe (`LaunchOverride.goalLaunch`). */
export type GoalLaunch =
  | { kind: 'worker'; taskIds: readonly string[]; markDone: boolean }
  | { kind: 'planner'; goalId: string }

/** What one spawn adds to the claude command. Every field null = nothing added. */
export interface GoalSpawnExtras {
  appendPrompt: string | null
  mcpConfigPath: string | null
  allowedTools: string | null
}

const NO_EXTRAS: GoalSpawnExtras = { appendPrompt: null, mcpConfigPath: null, allowedTools: null }

function openTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.status === 'open')
}

/** The goal the tasks share, or null when they span goals or are loose. */
function sharedGoalName(store: GoalsStore, tasks: readonly Task[]): string | null {
  const goalId = tasks[0]?.goalId ?? null
  if (goalId === null || tasks.some((t) => t.goalId !== goalId)) return null
  return store.view().goals.find((g) => g.id === goalId)?.name ?? null
}

/**
 * The extras for ONE spawn of `sessionId`. `previousSessionId` is the id this terminal's last
 * spawn minted (`LaunchOverride.lastSessionId`), null on its first spawn.
 * - A worker launch's FIRST spawn links its tasks to `sessionId`.
 * - A re-spawn (a dead-pane Reopen mints a new id) carries over only the tasks that are still open
 *   and still linked to the previous id: work closed or unlinked since never comes back.
 * - A resume with no goal launch (Past sessions, the dead pane's Resume) keeps the id, so the
 *   block comes back from the links that still name it.
 * - A fresh launch with no goal launch has a new id and no links: nothing.
 * - A planner gets nothing yet: its prompt names its tools, so it comes with them.
 * The block lists OPEN tasks only; none left, no block. The mark-done line needs the MCP tool,
 * which no session gets yet, so it is always left out and both MCP fields are null.
 */
export function goalSpawnExtras(
  store: GoalsStore,
  sessionId: string,
  goalLaunch: GoalLaunch | null,
  resume: boolean,
  previousSessionId: string | null
): GoalSpawnExtras {
  if (goalLaunch?.kind === 'planner') return NO_EXTRAS
  if (goalLaunch === null && !resume) return NO_EXTRAS
  if (goalLaunch !== null) {
    const carried =
      previousSessionId === null
        ? goalLaunch.taskIds
        : openTasks(store.tasksForSession(previousSessionId)).map((t) => t.id)
    store.linkMany(carried, sessionId)
  }
  const tasks = openTasks(store.tasksForSession(sessionId))
  if (tasks.length === 0) return NO_EXTRAS
  return {
    appendPrompt: buildWorkerPrompt({
      goalName: sharedGoalName(store, tasks),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
      markDone: false
    }),
    mcpConfigPath: null,
    allowedTools: null
  }
}

export interface StartGoalSessionsDeps {
  store: GoalsStore
  workspaces: { get(id: string): { defaultCwd: string | null } | null }
  /** The native folder picker; null = cancelled. */
  pickDirectory(): Promise<string | null>
  /** The API seam's launch (watchFeed.ts): registers the recipe and asks the renderer to mount
   *  the terminal hidden. Never takes the view. */
  requestLaunch(req: LaunchRequest): { terminalId: string; workspaceId: string }
  isDirectory(path: string): boolean
  claudeVersionAllowsLaunch(): boolean
  /** Code-only log sink. */
  log(message: string): void
}

/** Every task exists, is open, is in the workspace, and is in the goal when one is named. Throws
 *  the first refusal; returns the tasks of each group in the group's order. */
function checkTasks(req: GoalsStartRequest, store: GoalsStore): Task[][] {
  const view = store.view()
  if (req.goalId !== null) {
    const goal = view.goals.find((g) => g.id === req.goalId)
    if (goal === undefined) throw new Error(GOAL_ERROR.goalNotFound)
    if (goal.workspaceId !== req.workspaceId) throw new Error(GOAL_ERROR.workspaceMismatch)
  }
  return req.groups.map((group) =>
    group.taskIds.map((id) => {
      const task = view.tasks.find((t) => t.id === id)
      if (task === undefined || task.status !== 'open') throw new Error(GOAL_ERROR.taskNotFound)
      if (task.workspaceId !== req.workspaceId) throw new Error(GOAL_ERROR.workspaceMismatch)
      if (req.goalId !== null && task.goalId !== req.goalId) {
        throw new Error(GOAL_ERROR.workspaceMismatch)
      }
      return task
    })
  )
}

/**
 * Start one session per group. Refuses before anything launches: a task that is gone, closed or
 * elsewhere, a too-old claude (`claude_version`), a cancelled picker (`launch_cancelled`) or a
 * missing folder (`folder_missing`). The tasks are checked again after the picker, since the
 * operator can close one while it is open.
 */
export async function startGoalSessions(
  req: GoalsStartRequest,
  deps: StartGoalSessionsDeps
): Promise<GoalsStartResult> {
  checkTasks(req, deps.store)
  requireClaudeVersion(deps.claudeVersionAllowsLaunch)
  const goal = req.goalId === null ? null : deps.store.view().goals.find((g) => g.id === req.goalId)
  const cwd =
    goal?.defaultCwd ??
    deps.workspaces.get(req.workspaceId)?.defaultCwd ??
    (await deps.pickDirectory())
  if (cwd === null) throw new Error(LAUNCH_CANCELLED)
  const groups = checkTasks(req, deps.store)
  if (!deps.isDirectory(cwd)) {
    deps.log('[claude-watcher][goals] code=folder_missing')
    throw new Error(LAUNCH_FOLDER_MISSING)
  }
  // Every request is built (and its name checked) before the first launch, so a refusal on a
  // later group launches nothing.
  const requests: LaunchRequest[] = groups.map((tasks) => ({
    cwd,
    // Titles are schema-checked already; the name check still runs, like a typed name.
    name: SessionNameSchema.parse(taskSessionName(tasks.map((t) => t.title))),
    workspaceId: req.workspaceId,
    goalLaunch: { kind: 'worker', taskIds: tasks.map((t) => t.id), markDone: req.markDone }
  }))
  const terminalIds = requests.map((launch) => deps.requestLaunch(launch).terminalId)
  return { terminalIds }
}
