// Goals — the renderer PROJECTION of main's goals and tasks (state.md: main is truth; this is a
// hydrated copy, replaced wholesale from every IPC result and every `goals:changed` push). The
// renderer never invents or edits a task: it sends ids and intents, and draws what main answers.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { GOAL_TERMS } from '../copy/terms'
import type { GoalFileProblem, GoalsFileProblemCode } from '../../../shared/schemas/goal'
import type {
  Goal,
  GoalSaveRequest,
  GoalsStartRequest,
  GoalsView,
  Proposal,
  ProposalDecideRequest,
  Task,
  TaskSaveRequest,
  TaskStatus
} from '../../../shared/ipc/contract'

export interface GoalsState {
  goals: Goal[]
  tasks: Task[]
  /** The planners' proposals waiting for Accept or Reject (main keeps them in memory). */
  proposals: Proposal[]
  /** Goals whose `GOALS.md` did not follow their last change (main keeps them in memory). */
  fileProblems: GoalFileProblem[]
  loaded: boolean
  /** Action feedback (spec 2026-09-29 §2.6) — the startup load failed; any hydrate clears it. */
  loadFailed: boolean
  hydrate: (view: GoalsView) => void
  markLoadFailed: () => void
}

export function createGoalsViewStore(): StoreApi<GoalsState> {
  return createStore<GoalsState>((set) => ({
    goals: [],
    tasks: [],
    proposals: [],
    fileProblems: [],
    loaded: false,
    loadFailed: false,
    hydrate: (view) =>
      set({
        goals: view.goals,
        tasks: view.tasks,
        proposals: view.proposals,
        fileProblems: view.fileProblems,
        loaded: true,
        loadFailed: false
      }),
    markLoadFailed: () => set({ loadFailed: true })
  }))
}

export const goalsStore = createGoalsViewStore()

/** `selector` may build a fresh array (the `select*` factories below do): the shallow compare keeps
 *  React from re-rendering on every store write. */
export function useGoals<T>(selector: (state: GoalsState) => T): T {
  return useStore(goalsStore, useShallow(selector))
}

export const selectGoalsLoaded = (s: GoalsState): boolean => s.loaded
/** True only while nothing loaded AND the load failed — the sheet says so instead of "none yet". */
export const selectGoalsLoadFailed = (s: GoalsState): boolean => !s.loaded && s.loadFailed

/** The workspace's goals, in creation order (main keeps the array in that order). */
export const selectGoalsIn =
  (workspaceId: string) =>
  (s: GoalsState): Goal[] =>
    s.goals.filter((g) => g.workspaceId === workspaceId)

/** Why this goal's `GOALS.md` did not follow its last change, or null. */
export const selectFileProblemOf =
  (goalId: string) =>
  (s: GoalsState): GoalsFileProblemCode | null =>
    s.fileProblems.find((p) => p.goalId === goalId)?.code ?? null

export const selectTasksOfGoal =
  (goalId: string) =>
  (s: GoalsState): Task[] =>
    s.tasks.filter((t) => t.goalId === goalId)

export const selectLooseTasks =
  (workspaceId: string) =>
  (s: GoalsState): Task[] =>
    s.tasks.filter((t) => t.workspaceId === workspaceId && t.goalId === null)

/** The workspace's open tasks, goal and loose alike: the header Goals button's count. */
export const selectOpenTaskCount =
  (workspaceId: string) =>
  (s: GoalsState): number =>
    s.tasks.filter((t) => t.workspaceId === workspaceId && t.status === 'open').length

/** The proposals waiting on a goal (one per planner session on it). */
export const selectProposalsOfGoal =
  (goalId: string) =>
  (s: GoalsState): Proposal[] =>
    s.proposals.filter((p) => p.goalId === goalId)

export const selectTasksForSession =
  (sessionId: string) =>
  (s: GoalsState): Task[] =>
    s.tasks.filter((t) => t.sessionIds.includes(sessionId))

/** What a session card shows about its linked tasks (spec 2026-10-19 Decisions D). */
export interface GoalLine {
  /** The goal of the oldest linked task that has one; `GOAL_TERMS.daily` when all are loose. */
  name: string
  /** How many OTHER goals the linked tasks span. */
  extraGoals: number
  /** Every linked task, open and done, loose included. */
  taskCount: number
}

/** Undefined when nothing is linked (the card draws no line). Pure: the card's selector. */
export function goalLineFor(s: GoalsState, sessionId: string): GoalLine | undefined {
  const linked = s.tasks.filter((t) => t.sessionIds.includes(sessionId))
  if (linked.length === 0) return undefined
  const names = new Map(s.goals.map((g) => [g.id, g.name]))
  const goalIds: string[] = []
  for (const t of [...linked].sort((a, b) => a.createdAt - b.createdAt)) {
    if (t.goalId !== null && names.has(t.goalId) && !goalIds.includes(t.goalId)) {
      goalIds.push(t.goalId)
    }
  }
  const first = goalIds[0]
  return {
    name: first === undefined ? GOAL_TERMS.daily : (names.get(first) ?? GOAL_TERMS.daily),
    extraGoals: Math.max(goalIds.length - 1, 0),
    taskCount: linked.length
  }
}

/** Done of all. A goal with no tasks is 0/0 — an empty bar, never 100%. */
export function progressOf(tasks: readonly Task[]): { done: number; total: number } {
  return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length }
}

const LOG_PREFIX = '[claude-watcher][goals]'

/** Resolves whether it worked (the startup toast names the failures). Never rejects. */
export async function loadGoals(): Promise<boolean> {
  try {
    goalsStore.getState().hydrate(await window.goals.list())
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=goals_load_failed`)
    goalsStore.getState().markLoadFailed()
    return false
  }
}

// Every action below hydrates from the view main answered and RETHROWS: the sheet maps
// `store_write_failed` and the goal codes to copy on its own message line.

export async function saveGoal(req: GoalSaveRequest): Promise<Goal> {
  const result = await window.goals.saveGoal(req)
  goalsStore.getState().hydrate(result)
  return result.saved
}

export async function removeGoal(id: string): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.deleteGoal(id))
}

/** Main opens its own folder picker; the renderer never holds the path it stores. */
export async function pickGoalFolder(goalId: string): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.pickFolder(goalId))
}

/** `Save to GOALS.md`. On always rewrites the file (also `Try again`). */
export async function setGoalSaveToFile(goalId: string, on: boolean): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.setSaveToFile(goalId, on))
}

export async function saveTask(req: TaskSaveRequest): Promise<Task> {
  const result = await window.goals.saveTask(req)
  goalsStore.getState().hydrate(result)
  return result.saved
}

export async function removeTask(id: string): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.deleteTask(id))
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.setTaskStatus(id, status))
}

export async function linkTask(taskId: string, sessionId: string): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.linkTask(taskId, sessionId))
}

export async function unlinkTask(taskId: string, sessionId: string): Promise<void> {
  goalsStore.getState().hydrate(await window.goals.unlinkTask(taskId, sessionId))
}

/** Start sessions from tasks. Main links the tasks as each session spawns, and its push brings the
 *  links here; the terminals arrive like an API launch (registered hidden, the view stays). */
export async function startSessions(req: GoalsStartRequest): Promise<void> {
  await window.goals.start(req)
}

/** "Plan with Claude": main launches a planner on the goal (registered hidden, the view stays). */
export async function planGoal(goalId: string): Promise<void> {
  await window.goals.plan(goalId)
}

/** Accept (one session per row, through the same checks as `Start session`) or Reject a planner's
 *  proposal. Hydrates from main's answer, so the panel goes as soon as main cleared it. */
export async function decideProposal(req: ProposalDecideRequest): Promise<number> {
  const result = await window.goals.decideProposal(req)
  goalsStore.getState().hydrate(result)
  return result.terminalIds.length
}

// A change main made on its own (a session closed a task, a planner proposed a split, a `/clear`
// moved links, a cascade) reaches
// the renderer as a push. Subscribed ONCE at module load: the preload bridge exists before any
// renderer script runs, and the store lives as long as the page. The guard is for the unit tests
// that import this module (through startupLoads, the dialogs) without a preload; the app always
// has the bridge.
if (typeof window !== 'undefined' && 'goals' in window) {
  window.goals.onChanged((view) => goalsStore.getState().hydrate(view))
}
