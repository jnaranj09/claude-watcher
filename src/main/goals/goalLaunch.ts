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
// With "Claude can mark tasks done" on, it also mints the session's MCP token and writes its
// `--mcp-config` file (`mcp/`), so the session gets `mark_task_done`.
// Never logs a title, a name, a path or a token (`code=` only).
import type { GoalsStartRequest, Task } from '../../shared/schemas/goal'
import { LAUNCH_CANCELLED } from '../../shared/schemas/goal'
import { SessionNameSchema } from '../../shared/schemas/launch'
import type { GoalsStartResult } from '../../shared/ipc/contract'
import { GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { LAUNCH_FOLDER_MISSING, type LaunchRequest } from '../pty/launchSession'
import { requireClaudeVersion } from '../pty/inAppLaunch'
import { buildWorkerPrompt, taskSessionName } from './goalPrompt'
import type { GoalTokens } from './mcp/goalTokens'
import { MCP_SERVER_NAME, type McpConfigs } from './mcp/mcpConfigFile'
import { MARK_TASK_DONE } from './mcp/mcpTools'

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

/** The `--allowedTools` value: claude names an MCP tool `mcp__<server>__<tool>`, and pre-allowing
 *  it means the session never stops on a permission prompt for it (probed, claude 2.1.304). */
const MARK_TASK_DONE_ALLOWED = `mcp__${MCP_SERVER_NAME}__${MARK_TASK_DONE}`

/** What a spawn needs to hand a session `mark_task_done`. */
export interface GoalMcpSpawn {
  /** SEC-6: only while THIS process holds the hook port, which serves the endpoint. */
  hookListening(): boolean
  tokens: Pick<GoalTokens, 'mint' | 'revoke' | 'markDoneFor'>
  configs: Pick<McpConfigs, 'write' | 'remove'>
  /** `GOALS_MCP_URL`. */
  url: string
  /** A resume after a restart: whether the session's past-session record says the operator chose
   *  "Claude can mark tasks done" (tokens are memory-only, so this run cannot know). */
  pastTasksMarkDone(sessionId: string): boolean
  /** Code-only log sink. */
  log(message: string): void
}

export interface GoalSpawnDeps {
  store: GoalsStore
  /** null = no session gets the tool (tests of the block alone). */
  mcp: GoalMcpSpawn | null
}

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
 * The block lists OPEN tasks only; none left, no block.
 * The mark-done line, `--mcp-config` and `--allowedTools` come together or not at all: only when
 * the operator chose it (the goal launch's `markDone`; on a resume, this run's memory of the
 * session or else its past-session record), the hook port is ours (SEC-6), and the config file
 * was written. Each such spawn mints a fresh token, replacing any the session had.
 */
export function goalSpawnExtras(
  deps: GoalSpawnDeps,
  sessionId: string,
  goalLaunch: GoalLaunch | null,
  resume: boolean,
  previousSessionId: string | null
): GoalSpawnExtras {
  const { store, mcp } = deps
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
  const first = tasks[0]
  if (first === undefined) return NO_EXTRAS
  const markDone =
    goalLaunch !== null
      ? goalLaunch.markDone
      : mcp !== null && (mcp.tokens.markDoneFor(sessionId) || mcp.pastTasksMarkDone(sessionId))
  // A launch's tasks all share one workspace (`startGoalSessions` checks it); the grant names it.
  const mcpConfigPath = markDone ? grantMarkDone(mcp, sessionId, first.workspaceId) : null
  return {
    appendPrompt: buildWorkerPrompt({
      goalName: sharedGoalName(store, tasks),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
      markDone: mcpConfigPath !== null
    }),
    mcpConfigPath,
    allowedTools: mcpConfigPath === null ? null : MARK_TASK_DONE_ALLOWED
  }
}

/** Mint the session's worker token and write its config; the config path, or null when the
 *  session must go without the tool (no MCP, hook port not ours, a refused write). */
function grantMarkDone(
  mcp: GoalMcpSpawn | null,
  sessionId: string,
  workspaceId: string
): string | null {
  if (mcp === null) return null
  if (!mcp.hookListening()) {
    mcp.log('[claude-watcher][goals] code=mcp_hook_port_not_ours')
    return null
  }
  const token = mcp.tokens.mint({ sessionId, workspaceId, mode: 'worker' })
  const path = mcp.configs.write(sessionId, token, mcp.url)
  if (path === null) mcp.tokens.revoke(sessionId) // `write` logged the code
  return path
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
