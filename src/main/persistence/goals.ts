// Goals — the main-owned goals and tasks (spec 2026-10-19 goals). Its own file, so a corrupt goals
// blob can never reset another store. NEVER log a goal name or a task title (operator text, and a
// planner session writes some of them) — codes only.
//
// A task belongs to ONE workspace and, optionally, one goal of that SAME workspace. Links to cards
// live on the task (`sessionIds`, minted `--session-id` values). Proposals are NOT stored here:
// they live in memory with the planner session, so the view reads them through an injected lookup.
//
// Every successful mutation goes through `emit()`. It first hands the before/after lists to
// `afterChange` (the `GOALS.md` exporter, goals/goalsFile.ts), then tells the listeners, so a new
// store method reaches a goal's `GOALS.md` by emitting like every other one. A new goal needs a
// folder (spec 2026-10-29); a goal from before that rule keeps `defaultCwd: null`.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_GOALS_FILE,
  GOAL_FOLDER_MISSING,
  GOALS_FILE_VERSION,
  GoalsFileSchema,
  type Goal,
  type GoalFileProblem,
  type GoalSaveRequest,
  type GoalsFile,
  type GoalsView,
  type Proposal,
  type Task,
  type TaskDoneBy,
  type TaskSaveRequest,
  type TaskStatus
} from '../../shared/schemas/goal'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore,
  reportNowhere,
  storageCodeForLoad,
  type StorageReporter
} from './persistedBlob'
import type { GoalsSaveGoalResult, GoalsSaveTaskResult } from '../../shared/ipc/contract'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { GoalsSnapshot } from '../goals/goalsFile'

export type GoalsBlobStore = PersistedBlobStore<GoalsFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const GOAL_ERROR = {
  goalNotFound: 'goal_not_found',
  taskNotFound: 'task_not_found',
  workspaceMismatch: 'goal_workspace_mismatch',
  /** `goals:link-task`: the session is not live on the calling window's board, or it sits in
   *  another workspace than the task. */
  sessionNotFound: 'session_not_found'
} as const

export interface GoalsStoreOptions {
  blobStore?: GoalsBlobStore
  log?: (message: string) => void
  /** UX-06 / UX-07 — where a load problem or a background write failure is told (storageHealth.ts). */
  report?: StorageReporter
  newId?: () => string
  now?: () => number
  /** The planner proposals alive right now (in memory, owned elsewhere). Default: none. */
  proposals?: () => Proposal[]
  /** Runs after every successful mutation, before the listeners (the `GOALS.md` exporter). A
   *  throw is logged and never undoes the change. Default: nothing. */
  afterChange?: (before: GoalsSnapshot, after: GoalsSnapshot) => void
  /** The `GOALS.md` problems for these lists (memory only, owned by the exporter). Default: none. */
  fileProblems?: (snap: GoalsSnapshot) => GoalFileProblem[]
}

export interface GoalsStore {
  view(): GoalsView
  /** A create needs `folder` (main's own picker), else throws GOAL_FOLDER_MISSING; it starts with
   *  `saveToFile` off. A rename keeps both. Throws GOAL_ERROR.goalNotFound for an unknown id. */
  saveGoal(req: GoalSaveRequest, folder?: string): GoalsSaveGoalResult
  /** Deletes the goal AND its tasks. Unknown id is a no-op. */
  removeGoal(id: string): GoalsView
  /** `cwd` comes from main's own folder picker, never from the renderer. A folder is never
   *  cleared. */
  setGoalFolder(goalId: string, cwd: string): GoalsView
  /** `Save to GOALS.md`. A dialog write (undone on a refused disk write); the same value changes
   *  nothing. Turning it on for a goal with no folder throws GOAL_FOLDER_MISSING. */
  setSaveToFile(goalId: string, on: boolean): GoalsView
  /** Throws taskNotFound / goalNotFound / workspaceMismatch. */
  saveTask(req: TaskSaveRequest): GoalsSaveTaskResult
  /** A planner session's `create_task`: a NEW task (`req.id` is ignored). Throws goalNotFound /
   *  workspaceMismatch; a refused write is reported, not thrown (the change holds for this run). */
  addTaskFromSession(req: TaskSaveRequest): Task
  removeTask(id: string): GoalsView
  /** done stamps `doneAt`/`doneBy`; open clears both; the status it already has changes nothing. */
  setTaskStatus(id: string, status: TaskStatus, by: TaskDoneBy): GoalsView
  link(taskId: string, sessionId: string): GoalsView
  unlink(taskId: string, sessionId: string): GoalsView
  /** Launch path: unknown ids are skipped, and a refused write is reported, not thrown. */
  linkMany(taskIds: readonly string[], sessionId: string): void
  /** `/clear`: every link to `oldId` now names `newId`. A refused write is reported, not thrown. */
  rebindSession(oldId: string, newId: string): void
  tasksForSession(sessionId: string): Task[]
  /** The workspace delete cascade: its goals and every task of the workspace. Returns the count. */
  removeByWorkspace(workspaceId: string): number
  /** Fires after every successful mutation, whatever the source. Returns the unsubscribe. */
  onChange(listener: (view: GoalsView) => void): () => void
}

const LOG_PREFIX = '[claude-watcher][goals]'

export function createGoalsStore(options: GoalsStoreOptions = {}): GoalsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<GoalsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const report = options.report ?? reportNowhere
  const newId = options.newId ?? randomUUID
  const now = options.now ?? Date.now
  const proposals = options.proposals ?? ((): Proposal[] => [])
  const fileProblems = options.fileProblems ?? ((): GoalFileProblem[] => [])

  const loaded = loadPersistedOrReset<GoalsFile>({
    blobStore,
    parse: (raw) => GoalsFileSchema.parse(raw),
    fallback: () => EMPTY_GOALS_FILE,
    onProblem: (code) => {
      log(`${LOG_PREFIX} code=goals_${code}`)
      report(storageCodeForLoad(code))
    }
  })
  let goals: Goal[] = [...loaded.goals]
  let tasks: Task[] = [...loaded.tasks]
  const listeners = new Set<(view: GoalsView) => void>()
  let lastEmitted: GoalsSnapshot = { goals, tasks }
  persistOrReport()

  function persist(): boolean {
    try {
      blobStore.write({ version: GOALS_FILE_VERSION, goals, tasks })
      return true
    } catch {
      log(`${LOG_PREFIX} code=goals_write_failed`)
      return false
    }
  }

  /** A dialog's Save / Delete (UX-06): undo the change and throw when the file write fails. */
  function commit(undo: () => void): void {
    if (persist()) return
    undo()
    throw new Error(STORE_WRITE_FAILED)
  }

  /** Every other write: the change holds for this run, and storage health says it was not kept. */
  function persistOrReport(): void {
    if (!persist()) report('write_failed')
  }

  function view(): GoalsView {
    return {
      goals: [...goals],
      tasks: [...tasks],
      proposals: proposals(),
      fileProblems: fileProblems({ goals, tasks })
    }
  }

  /** After a successful mutation: `GOALS.md` first, then the listeners. A throw in either never
   *  undoes the change. */
  function emit(): GoalsView {
    const after: GoalsSnapshot = { goals, tasks }
    try {
      options.afterChange?.(lastEmitted, after)
    } catch {
      log(`${LOG_PREFIX} code=goals_file_sync_failed`)
    }
    lastEmitted = after
    const current = view()
    for (const listener of listeners) {
      try {
        listener(current)
      } catch {
        log(`${LOG_PREFIX} code=goals_listener_failed`)
      }
    }
    return current
  }

  /** Replace the lists, persist with undo, announce. */
  function mutate(nextGoals: Goal[], nextTasks: Task[]): GoalsView {
    const previousGoals = goals
    const previousTasks = tasks
    goals = nextGoals
    tasks = nextTasks
    commit(() => {
      goals = previousGoals
      tasks = previousTasks
    })
    return emit()
  }

  function goalOf(id: string): Goal {
    const goal = goals.find((g) => g.id === id)
    if (goal === undefined) throw new Error(GOAL_ERROR.goalNotFound)
    return goal
  }

  function taskOf(id: string): Task {
    const task = tasks.find((t) => t.id === id)
    if (task === undefined) throw new Error(GOAL_ERROR.taskNotFound)
    return task
  }

  function saveGoal(req: GoalSaveRequest, folder?: string): GoalsSaveGoalResult {
    const existing = req.id === undefined ? null : goalOf(req.id)
    if (existing === null && folder === undefined) throw new Error(GOAL_FOLDER_MISSING)
    // A rename never re-parents: its tasks stay in the old workspace.
    if (existing !== null && existing.workspaceId !== req.workspaceId)
      throw new Error(GOAL_ERROR.workspaceMismatch)
    const saved: Goal = {
      id: existing?.id ?? newId(),
      workspaceId: req.workspaceId,
      name: req.name,
      defaultCwd: existing === null ? (folder ?? null) : existing.defaultCwd,
      saveToFile: existing?.saveToFile ?? false,
      createdAt: existing?.createdAt ?? now()
    }
    const next =
      existing === null ? [...goals, saved] : goals.map((g) => (g === existing ? saved : g))
    return { saved, ...mutate(next, tasks) }
  }

  function removeGoal(id: string): GoalsView {
    if (!goals.some((g) => g.id === id)) return view()
    return mutate(
      goals.filter((g) => g.id !== id),
      tasks.filter((t) => t.goalId !== id)
    )
  }

  function setGoalFolder(goalId: string, cwd: string): GoalsView {
    const goal = goalOf(goalId)
    if (goal.defaultCwd === cwd) return view()
    return mutate(
      goals.map((g) => (g === goal ? { ...g, defaultCwd: cwd } : g)),
      tasks
    )
  }

  function setSaveToFile(goalId: string, on: boolean): GoalsView {
    const goal = goalOf(goalId)
    if (goal.saveToFile === on) return view()
    if (on && goal.defaultCwd === null) throw new Error(GOAL_FOLDER_MISSING)
    return mutate(
      goals.map((g) => (g === goal ? { ...g, saveToFile: on } : g)),
      tasks
    )
  }

  /** A task's goal must sit in the task's workspace. */
  function checkGoalPlace(req: TaskSaveRequest): void {
    if (req.goalId !== null && goalOf(req.goalId).workspaceId !== req.workspaceId)
      throw new Error(GOAL_ERROR.workspaceMismatch)
  }

  function freshTask(req: TaskSaveRequest): Task {
    return {
      id: newId(),
      workspaceId: req.workspaceId,
      goalId: req.goalId,
      title: req.title,
      status: 'open',
      sessionIds: [],
      createdAt: now(),
      doneAt: null,
      doneBy: null
    }
  }

  function saveTask(req: TaskSaveRequest): GoalsSaveTaskResult {
    checkGoalPlace(req)
    const existing = req.id === undefined ? null : taskOf(req.id)
    if (existing !== null && existing.workspaceId !== req.workspaceId)
      throw new Error(GOAL_ERROR.workspaceMismatch)
    const saved: Task = existing
      ? { ...existing, goalId: req.goalId, title: req.title }
      : freshTask(req)
    const next =
      existing === null ? [...tasks, saved] : tasks.map((t) => (t === existing ? saved : t))
    return { saved, ...mutate(goals, next) }
  }

  function addTaskFromSession(req: TaskSaveRequest): Task {
    checkGoalPlace(req)
    const saved = freshTask(req)
    applyTasks([...tasks, saved])
    return saved
  }

  function removeTask(id: string): GoalsView {
    if (!tasks.some((t) => t.id === id)) return view()
    return mutate(
      goals,
      tasks.filter((t) => t.id !== id)
    )
  }

  function replaceTask(task: Task, next: Task): GoalsView {
    return mutate(
      goals,
      tasks.map((t) => (t === task ? next : t))
    )
  }

  function setTaskStatus(id: string, status: TaskStatus, by: TaskDoneBy): GoalsView {
    const task = taskOf(id)
    if (task.status === status) return view()
    const next: Task =
      status === 'done'
        ? { ...task, status, doneAt: now(), doneBy: by }
        : { ...task, status, doneAt: null, doneBy: null }
    // A session's mark-done is not a dialog write: it keeps the change, reports the disk, and never
    // throws at its caller (the MCP tool). The operator's tick is a dialog write: undone on failure.
    if (by === 'session') {
      applyTasks(tasks.map((t) => (t === task ? next : t)))
      return view()
    }
    return replaceTask(task, next)
  }

  function link(taskId: string, sessionId: string): GoalsView {
    const task = taskOf(taskId)
    if (task.sessionIds.includes(sessionId)) return view()
    return replaceTask(task, { ...task, sessionIds: [...task.sessionIds, sessionId] })
  }

  function unlink(taskId: string, sessionId: string): GoalsView {
    const task = taskOf(taskId)
    if (!task.sessionIds.includes(sessionId)) return view()
    return replaceTask(task, {
      ...task,
      sessionIds: task.sessionIds.filter((s) => s !== sessionId)
    })
  }

  /** Background writers (launch, `/clear`): keep the change, report the disk. */
  function applyTasks(next: Task[]): void {
    tasks = next
    persistOrReport()
    emit()
  }

  function linkMany(taskIds: readonly string[], sessionId: string): void {
    let changed = false
    const next = tasks.map((t) => {
      if (!taskIds.includes(t.id) || t.sessionIds.includes(sessionId)) return t
      changed = true
      return { ...t, sessionIds: [...t.sessionIds, sessionId] }
    })
    if (changed) applyTasks(next)
  }

  function rebindSession(oldId: string, newIdValue: string): void {
    if (oldId === newIdValue || !tasks.some((t) => t.sessionIds.includes(oldId))) return
    applyTasks(
      tasks.map((t) =>
        t.sessionIds.includes(oldId)
          ? {
              ...t,
              sessionIds: [...new Set(t.sessionIds.map((s) => (s === oldId ? newIdValue : s)))]
            }
          : t
      )
    )
  }

  function tasksForSession(sessionId: string): Task[] {
    return tasks.filter((t) => t.sessionIds.includes(sessionId))
  }

  function removeByWorkspace(workspaceId: string): number {
    const keptGoals = goals.filter((g) => g.workspaceId !== workspaceId)
    const keptTasks = tasks.filter((t) => t.workspaceId !== workspaceId)
    const removed = goals.length - keptGoals.length + (tasks.length - keptTasks.length)
    if (removed === 0) return 0
    goals = keptGoals
    tasks = keptTasks
    persistOrReport()
    emit()
    return removed
  }

  function onChange(listener: (view: GoalsView) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    view,
    saveGoal,
    removeGoal,
    setGoalFolder,
    setSaveToFile,
    saveTask,
    addTaskFromSession,
    removeTask,
    setTaskStatus,
    link,
    unlink,
    linkMany,
    rebindSession,
    tasksForSession,
    removeByWorkspace,
    onChange
  }
}
