// Goals — the main-owned goals and tasks (spec 2026-10-19 goals). Its own file, so a corrupt goals
// blob can never reset another store. NEVER log a goal name or a task title (operator text, and a
// planner session writes some of them) — codes only.
//
// A task belongs to ONE workspace and, optionally, one goal of that SAME workspace. Links to cards
// live on the task (`sessionIds`, minted `--session-id` values). Proposals are NOT stored here:
// they live in memory with the planner session, so the view reads them through an injected lookup.
//
// Every change to goals or tasks goes through `emit()`. It first hands the before/after lists to
// `afterChange` (the `GOALS.md` exporter, goals/goalsFile.ts), then tells the listeners, so a new
// store method reaches a goal's `GOALS.md` by emitting like every other one. A write that changes
// only the session lineage or the planner records (neither is in the view or the export) is
// persisted but does not emit. A goal the operator creates needs a folder (spec 2026-10-29); a
// goal from before that rule, and a memory goal made for a session with no folder, has
// `defaultCwd: null`.
//
// Memory extraction adds and refreshes open tasks and a session reports what it saw, but only the
// operator (or a session's `mark_task_done`) closes one: none of the extraction methods touches a
// status. Their check and report are SENSITIVE like memory text: never logged.
//
// Memory goals (spec 2026-11-18): a new task memory writes goes to the goal the session plans (its
// planner record), else the goal its links name (`metaGoalId`), else the session's own memory goal
// (`Goal.memorySessionIds`), else a new memory goal named after the session. A session's ids are
// one family through the session lineage (`/clear`, Reopen), so every id of a session finds the
// same goal. Each save that writes or updates a task records a touch (`Task.touchedBy`); nothing
// here ever links a task to a session.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_GOALS_FILE,
  GOAL_FOLDER_MISSING,
  GOALS_FILE_VERSION,
  GoalSchema,
  GoalsFileSchema,
  TaskSchema,
  type Goal,
  type GoalFileProblem,
  type GoalSaveRequest,
  type GoalsFile,
  type GoalsView,
  type Lineage,
  type PlannerSession,
  type Proposal,
  type Task,
  type TaskDoneBy,
  type TaskLeftWith,
  type TaskReport,
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

/** The sessions kept in a task's `touchedBy`; the oldest drop.
 *  A test keeps this export on purpose. */
export const TASK_TOUCHED_BY_MAX = 20
/** The ids kept in a goal's `memorySessionIds`; the oldest drop.
 *  A test keeps this export on purpose. */
export const GOAL_MEMORY_SESSIONS_MAX = 50
/** The session lineage entries kept; the oldest drop. A test keeps this export on purpose. */
export const SESSION_LINEAGE_MAX = 500
/** The planner records kept; the oldest drop. A test keeps this export on purpose. */
export const PLANNER_SESSIONS_MAX = 200

/** What a new memory goal is made with: the session's goal name and folder (null = no folder). */
export interface SessionGoal {
  name: string
  folder: string | null
}

/** One session's open Daily tasks the one-time cleanup moves into that session's memory goal. */
export interface MemoryRegroupGroup {
  sessionId: string
  workspaceId: string
  sessionGoal: SessionGoal
  /** The group's newest task `createdAt`: a goal the cleanup creates gets it. */
  createdAt: number
  taskIds: readonly string[]
}

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
  /** Runs after every change to goals or tasks, before the listeners (the `GOALS.md` exporter).
   *  A throw is logged and never undoes the change. Default: nothing. */
  afterChange?: (before: GoalsSnapshot, after: GoalsSnapshot) => void
  /** The `GOALS.md` problems for these lists (memory only, owned by the exporter). Default: none. */
  fileProblems?: (snap: GoalsSnapshot) => GoalFileProblem[]
  /** Copies the goals file aside before the one-time cleanup, leaving the live file: true =
   *  copied, false = no file on disk yet, a throw = failed. Default: false (an in-memory store has
   *  no file). */
  backupCopy?: () => boolean
}

export interface GoalsStore {
  view(): GoalsView
  /** A create needs `folder` (main's own picker), else throws GOAL_FOLDER_MISSING; it starts with
   *  `saveToFile` off. A rename keeps the folder, `saveToFile` and `memorySessionIds`. Throws
   *  GOAL_ERROR.goalNotFound for an unknown id. */
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
  /** A NEW open task from extraction, in the session's goal: the goal the session's family plans
   *  (its newest planner record, when that goal is still in `workspaceId`), else `metaGoalId` when
   *  it is a goal of `workspaceId`, else the session's own memory goal (the oldest goal of
   *  `workspaceId` whose `memorySessionIds` holds an id of the family; it gains `sessionId`), else
   *  a NEW memory goal made from `sessionGoal` (`createdAt = at`, `folder` null = no folder). Not
   *  put in `sessionIds`. Sets `lastSeenAt = at`, `originSessionId` and `touchedBy` to
   *  `sessionId`. Throws on a title or check the schemas refuse, and then writes nothing (no goal
   *  either). One background write: keeps the change, reports the disk (`persistOrReport`).
   *  `memoryGoals`: the memory goals of `workspaceId` after the write. */
  addTaskFromExtraction(req: {
    workspaceId: string
    metaGoalId: string | null
    title: string
    check: string | null
    leftWith: TaskLeftWith
    sessionId: string
    sessionGoal: SessionGoal
    folder: string | null
    at: number
  }): { task: Task; goalCreated: boolean; memoryGoals: number }
  /** An OPEN task: sets `leftWith`, `lastSeenAt = at` only when `seen` (R48: the evidence was a
   *  tool result or the operator's text), and `check` when it is not null (null keeps the task's
   *  check). A `seen` update also records `sessionId`'s touch at `at` (`touchedBy`). Never the
   *  title, the status or the goal. false: unknown id or a done task (no touch). A background
   *  write; throws on a check the schema refuses. */
  updateTaskFromExtraction(
    id: string,
    patch: {
      check: string | null
      leftWith: TaskLeftWith
      at: number
      seen: boolean
      sessionId: string
    }
  ): boolean
  /** Sets `report`; an `open` outcome also sets `lastSeenAt = report.at`. A done task: 'ok',
   *  nothing changes. Never changes the status (only the operator closes a task). A background
   *  write; throws on a report the schema refuses. */
  reportTask(id: string, report: TaskReport): 'ok' | 'not_found'
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
  /** `/clear` and every other id change the app adopts for a card: every link to `oldId` now names
   *  `newId`, and so do a task's `originSessionId`, its report's `sessionId` and its `touchedBy`
   *  (two entries merge, keeping the later `at`). It also records the lineage `oldId` → `newId`
   *  (even when nothing names `oldId` yet), adds `newId` to every goal whose `memorySessionIds`
   *  holds `oldId`, and copies the family's planner record to `newId`. The same id is a no-op. A
   *  throw in those new steps is logged (`goals_rebind_lineage_failed`) and the moves are kept. A
   *  refused write is reported, not thrown. */
  rebindSession(oldId: string, newId: string): void
  /** Dead-pane Reopen: records the lineage `previousId` → `newId`, adds `newId` to every goal whose
   *  `memorySessionIds` holds `previousId`, and copies the family's planner record to `newId`. No
   *  task changes (no link, no touch). The same id is a no-op. A refused write is reported. */
  carrySessionGoal(previousId: string, newId: string): void
  /** A planner spawn: records that `sessionId` plans `goalId`, unless that session's newest record
   *  already names it. A refused write is reported. */
  notePlanner(sessionId: string, goalId: string): void
  /** When the one-time memory cleanup ran; null = not yet. */
  memoryRegroupedAt(): number | null
  /** The one-time cleanup, in one write that also sets `memoryRegroupedAt` to `at`: every task with
   *  an `originSessionId` and an empty `touchedBy` gets that session's touch (at `lastSeenAt ??
   *  createdAt`), and each group's tasks that are still open in Daily tasks move to that session's
   *  memory goal (a goal it creates gets the group's `createdAt`). Emits only when a goal or task
   *  changed. Zeros and no write once the marker is set. */
  applyMemoryRegroup(
    groups: readonly MemoryRegroupGroup[],
    at: number
  ): { goalsCreated: number; tasksMoved: number; tasksTouched: number }
  /** Copies the goals file aside before the cleanup (the `backupCopy` option); throws what it
   *  throws. Never renames the live file. */
  backupBeforeRegroup(): void
  tasksForSession(sessionId: string): Task[]
  /** The workspace delete cascade: its goals and every task of the workspace. Returns the count. */
  removeByWorkspace(workspaceId: string): number
  /** Fires after every change to goals or tasks, whatever the source (a lineage- or planner-only
   *  write does not fire). Returns the unsubscribe. */
  onChange(listener: (view: GoalsView) => void): () => void
}

const LOG_PREFIX = '[claude-watcher][goals]'

/** The parts of one background write; each is passed only when it changed. */
interface ApplyParts {
  goals?: Goal[]
  tasks?: Task[]
  lineage?: Lineage[]
  planners?: PlannerSession[]
  regroupedAt?: number
}

/** One write's working copy (spec 2026-11-18 "Write path"): built once from the current lists and
 *  changed in place; `goals` is passed to `apply` only when `goalsChanged`. */
interface Draft {
  goals: Goal[]
  tasks: Task[]
  goalsChanged: boolean
}

export function createGoalsStore(options: GoalsStoreOptions = {}): GoalsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<GoalsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const report = options.report ?? reportNowhere
  const newId = options.newId ?? randomUUID
  const now = options.now ?? Date.now
  const proposals = options.proposals ?? ((): Proposal[] => [])
  const fileProblems = options.fileProblems ?? ((): GoalFileProblem[] => [])
  const backupCopy = options.backupCopy ?? ((): boolean => false)

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
  let regroupedAt: number | null = loaded.memoryRegroupedAt
  let lineage: Lineage[] = [...loaded.sessionLineage]
  let planners: PlannerSession[] = [...loaded.plannerSessions]
  const listeners = new Set<(view: GoalsView) => void>()
  let lastEmitted: GoalsSnapshot = { goals, tasks }
  persistOrReport()

  function persist(): boolean {
    try {
      blobStore.write({
        version: GOALS_FILE_VERSION,
        goals,
        tasks,
        sessionLineage: lineage,
        plannerSessions: planners,
        memoryRegroupedAt: regroupedAt
      })
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
      createdAt: existing?.createdAt ?? now(),
      memorySessionIds: existing?.memorySessionIds ?? []
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
      doneBy: null,
      check: null,
      leftWith: null,
      lastSeenAt: null,
      report: null,
      originSessionId: null,
      folder: null,
      touchedBy: []
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
    apply({ tasks: [...tasks, saved] })
    return saved
  }

  /** A task built from a session's words: the schema checks it before it is kept, so a refused
   *  field throws here and never reaches the file (where it would reset the whole store). */
  function checked(task: Task): Task {
    return TaskSchema.parse(task)
  }

  function addTaskFromExtraction(
    req: Parameters<GoalsStore['addTaskFromExtraction']>[0]
  ): ReturnType<GoalsStore['addTaskFromExtraction']> {
    const next = draft()
    const { goal, created } = sessionGoalFor(
      next,
      req.sessionId,
      req.workspaceId,
      req.metaGoalId,
      req.sessionGoal,
      req.at
    )
    const task = checked({
      ...freshTask({ workspaceId: req.workspaceId, goalId: goal.id, title: req.title }),
      check: req.check,
      leftWith: req.leftWith,
      lastSeenAt: req.at,
      originSessionId: req.sessionId,
      folder: req.folder,
      touchedBy: [{ sessionId: req.sessionId, at: req.at }]
    })
    apply({ ...goalsPart(next), tasks: [...tasks, task] })
    const memoryGoals = goals.filter(
      (g) => g.workspaceId === req.workspaceId && g.memorySessionIds.length > 0
    ).length
    return { task, goalCreated: created, memoryGoals }
  }

  function updateTaskFromExtraction(
    id: string,
    patch: Parameters<GoalsStore['updateTaskFromExtraction']>[1]
  ): boolean {
    const task = tasks.find((t) => t.id === id)
    if (task === undefined || task.status !== 'open') return false
    const updated = checked({
      ...task,
      check: patch.check ?? task.check,
      leftWith: patch.leftWith,
      lastSeenAt: patch.seen ? patch.at : task.lastSeenAt
    })
    const next = patch.seen ? touch(updated, patch.sessionId, patch.at) : updated
    apply({ tasks: tasks.map((t) => (t === task ? next : t)) })
    return true
  }

  function reportTask(id: string, report: TaskReport): 'ok' | 'not_found' {
    const task = tasks.find((t) => t.id === id)
    if (task === undefined) return 'not_found'
    if (task.status === 'done') return 'ok'
    const next = checked({
      ...task,
      report,
      lastSeenAt: report.outcome === 'open' ? report.at : task.lastSeenAt
    })
    apply({ tasks: tasks.map((t) => (t === task ? next : t)) })
    return 'ok'
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
      apply({ tasks: tasks.map((t) => (t === task ? next : t)) })
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

  /** Background writers (launch, `/clear`, memory): replace the parts passed (each only when it
   *  changed), persist once and keep the change on a refused write (reported), and emit once only
   *  when goals or tasks changed: the lineage and planner records are not in the view or the
   *  export. */
  function apply(parts: ApplyParts): void {
    if (parts.goals !== undefined) goals = parts.goals
    if (parts.tasks !== undefined) tasks = parts.tasks
    if (parts.lineage !== undefined) lineage = parts.lineage
    if (parts.planners !== undefined) planners = parts.planners
    if (parts.regroupedAt !== undefined) regroupedAt = parts.regroupedAt
    if (Object.keys(parts).length === 0) return
    persistOrReport()
    if (parts.goals !== undefined || parts.tasks !== undefined) emit()
  }

  /** This write's working copy of the lists: changed in place, so a goal one step creates or grows
   *  is seen by the next. */
  function draft(): Draft {
    return { goals: [...goals], tasks: [...tasks], goalsChanged: false }
  }

  function goalsPart(next: Draft): { goals?: Goal[] } {
    return next.goalsChanged ? { goals: next.goals } : {}
  }

  /** The id and every id joined to it through the lineage, either way (a breadth-first walk, so a
   *  cycle ends and an older entry reached through a newer one is found). Ordered by each id's
   *  first appearance when the entries are walked oldest first (ties: array order, `fromId` before
   *  `toId`); the id itself last when no entry names it. */
  function familyOf(id: string): string[] {
    const near = new Map<string, string[]>()
    const join = (a: string, b: string): void => {
      const list = near.get(a)
      if (list === undefined) near.set(a, [b])
      else list.push(b)
    }
    for (const e of lineage) {
      join(e.fromId, e.toId)
      join(e.toId, e.fromId)
    }
    const members = new Set([id])
    const queue = [id]
    for (let at = 0; at < queue.length; at++) {
      for (const other of near.get(queue[at] ?? '') ?? []) {
        if (members.has(other)) continue
        members.add(other)
        queue.push(other)
      }
    }
    const ordered: string[] = []
    const placed = new Set<string>()
    const byTime = lineage.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    for (const { e } of byTime) {
      for (const member of [e.fromId, e.toId]) {
        if (!members.has(member) || placed.has(member)) continue
        placed.add(member)
        ordered.push(member)
      }
    }
    if (!placed.has(id)) ordered.push(id)
    return ordered
  }

  /** The newest planner record (largest `at`, ties: the later one) whose session is in `family`. */
  function newestPlannerOf(family: ReadonlySet<string>): PlannerSession | null {
    let newest: PlannerSession | null = null
    for (const p of planners) {
      if (family.has(p.sessionId) && (newest === null || p.at >= newest.at)) newest = p
    }
    return newest
  }

  /** The goal the family plans: the newest record's goal, when it is still a goal of
   *  `workspaceId`. Older records are not tried. */
  function plannerGoalOf(
    family: readonly string[],
    workspaceId: string,
    from: readonly Goal[]
  ): Goal | null {
    const newest = newestPlannerOf(new Set(family))
    if (newest === null) return null
    return from.find((g) => g.id === newest.goalId && g.workspaceId === workspaceId) ?? null
  }

  /** `goal` with `id` in `memorySessionIds` (appended unless present; the newest
   *  GOAL_MEMORY_SESSIONS_MAX kept). */
  function addId(goal: Goal, id: string): Goal {
    if (goal.memorySessionIds.includes(id)) return goal
    return {
      ...goal,
      memorySessionIds: [...goal.memorySessionIds, id].slice(-GOAL_MEMORY_SESSIONS_MAX)
    }
  }

  /** `task` with `sessionId`'s touch at `at`: an entry of that session is replaced, the list kept
   *  ordered by `at` (a tie puts the new touch last), the newest TASK_TOUCHED_BY_MAX kept. */
  function touch(task: Task, sessionId: string, at: number): Task {
    const others = task.touchedBy.filter((t) => t.sessionId !== sessionId)
    const touchedBy = [...others, { sessionId, at }].sort((a, b) => a.at - b.at)
    return { ...task, touchedBy: touchedBy.slice(-TASK_TOUCHED_BY_MAX) }
  }

  /** The goal a memory task of `sessionId` goes to (the order in `addTaskFromExtraction`'s doc).
   *  Changes `next` in place: a created goal is appended, an own memory goal that gains the id is
   *  replaced; either sets `goalsChanged`. Only the own-memory-goal branch adds the id: a session
   *  placed through its planner record or its links never joins that goal's `memorySessionIds`. */
  function sessionGoalFor(
    next: Draft,
    sessionId: string,
    workspaceId: string,
    metaGoalId: string | null,
    sessionGoal: SessionGoal,
    at: number
  ): { goal: Goal; created: boolean } {
    const family = familyOf(sessionId)
    const planned = plannerGoalOf(family, workspaceId, next.goals)
    if (planned !== null) return { goal: planned, created: false }
    const linked =
      metaGoalId === null
        ? undefined
        : next.goals.find((g) => g.id === metaGoalId && g.workspaceId === workspaceId)
    if (linked !== undefined) return { goal: linked, created: false }
    const ids = new Set(family)
    let own: Goal | null = null
    for (const g of next.goals) {
      if (g.workspaceId !== workspaceId || !g.memorySessionIds.some((id) => ids.has(id))) continue
      if (own === null || g.createdAt < own.createdAt) own = g
    }
    if (own !== null) {
      const grown = addId(own, sessionId)
      if (grown !== own) {
        next.goals = next.goals.map((g) => (g === own ? grown : g))
        next.goalsChanged = true
      }
      return { goal: grown, created: false }
    }
    const goal = GoalSchema.parse({
      id: newId(),
      workspaceId,
      name: sessionGoal.name,
      defaultCwd: sessionGoal.folder,
      saveToFile: false,
      createdAt: at,
      memorySessionIds: family.slice(-GOAL_MEMORY_SESSIONS_MAX)
    })
    next.goals = [...next.goals, goal]
    next.goalsChanged = true
    return { goal, created: true }
  }

  /** The parts a carry from `oldId` to `newId` writes: the lineage entry (always), `newId` on every
   *  goal holding `oldId`, and the family's newest planner record copied to `newId` (unless
   *  `newId`'s own newest record already names that goal), so the planned goal never depends on
   *  the lineage cap. The family is read before the new entry is added. */
  function carryParts(oldId: string, newIdValue: string): ApplyParts {
    const at = now()
    const parts: ApplyParts = {
      lineage: [...lineage, { fromId: oldId, toId: newIdValue, at }].slice(-SESSION_LINEAGE_MAX)
    }
    if (goals.some((g) => g.memorySessionIds.includes(oldId))) {
      parts.goals = goals.map((g) =>
        g.memorySessionIds.includes(oldId) ? addId(g, newIdValue) : g
      )
    }
    const planned = newestPlannerOf(new Set(familyOf(oldId)))
    if (planned !== null && newestPlannerOf(new Set([newIdValue]))?.goalId !== planned.goalId) {
      parts.planners = [...planners, { sessionId: newIdValue, goalId: planned.goalId, at }].slice(
        -PLANNER_SESSIONS_MAX
      )
    }
    return parts
  }

  function linkMany(taskIds: readonly string[], sessionId: string): void {
    let changed = false
    const next = tasks.map((t) => {
      if (!taskIds.includes(t.id) || t.sessionIds.includes(sessionId)) return t
      changed = true
      return { ...t, sessionIds: [...t.sessionIds, sessionId] }
    })
    if (changed) apply({ tasks: next })
  }

  function namesSession(t: Task, id: string): boolean {
    return t.sessionIds.includes(id) || t.originSessionId === id || t.report?.sessionId === id
  }

  /** `touchedBy` with `oldId` renamed to `newId`: two entries of `newId` merge into one with the
   *  later `at`, kept in order of `at`. */
  function retouched(task: Task, oldId: string, newIdValue: string): Task {
    const merged = new Map<string, number>()
    for (const t of task.touchedBy) {
      const id = t.sessionId === oldId ? newIdValue : t.sessionId
      merged.set(id, Math.max(merged.get(id) ?? t.at, t.at))
    }
    const touchedBy = [...merged].map(([sessionId, at]) => ({ sessionId, at }))
    return { ...task, touchedBy: touchedBy.sort((a, b) => a.at - b.at) }
  }

  function rebindSession(oldId: string, newIdValue: string): void {
    if (oldId === newIdValue) return
    const move = (s: string): string => (s === oldId ? newIdValue : s)
    const moved = tasks.some((t) => namesSession(t, oldId))
      ? tasks.map((t) =>
          namesSession(t, oldId)
            ? {
                ...t,
                sessionIds: [...new Set(t.sessionIds.map(move))],
                originSessionId: t.originSessionId === null ? null : move(t.originSessionId),
                report:
                  t.report === null ? null : { ...t.report, sessionId: move(t.report.sessionId) }
              }
            : t
        )
      : null
    let parts: ApplyParts = moved === null ? {} : { tasks: moved }
    // The memory-goal steps: a throw here (a coding error; nothing is parsed) keeps the moves
    // above.
    try {
      const base = moved ?? tasks
      const touched = (t: Task): boolean => t.touchedBy.some((x) => x.sessionId === oldId)
      const carried = carryParts(oldId, newIdValue)
      parts = base.some(touched)
        ? { ...carried, tasks: base.map((t) => (touched(t) ? retouched(t, oldId, newIdValue) : t)) }
        : { ...carried, ...parts }
    } catch {
      log(`${LOG_PREFIX} code=goals_rebind_lineage_failed`)
    }
    apply(parts)
  }

  function carrySessionGoal(previousId: string, newIdValue: string): void {
    if (previousId === newIdValue) return
    apply(carryParts(previousId, newIdValue))
  }

  function notePlanner(sessionId: string, goalId: string): void {
    if (newestPlannerOf(new Set([sessionId]))?.goalId === goalId) return
    apply({
      planners: [...planners, { sessionId, goalId, at: now() }].slice(-PLANNER_SESSIONS_MAX)
    })
  }

  function applyMemoryRegroup(
    groups: readonly MemoryRegroupGroup[],
    at: number
  ): { goalsCreated: number; tasksMoved: number; tasksTouched: number } {
    const counts = { goalsCreated: 0, tasksMoved: 0, tasksTouched: 0 }
    if (regroupedAt !== null) return counts
    const next = draft()
    let tasksChanged = false
    next.tasks = next.tasks.map((t) => {
      if (t.originSessionId === null || t.touchedBy.length > 0) return t
      counts.tasksTouched += 1
      tasksChanged = true
      return {
        ...t,
        touchedBy: [{ sessionId: t.originSessionId, at: t.lastSeenAt ?? t.createdAt }]
      }
    })
    for (const group of groups) {
      const ids = new Set(group.taskIds)
      const movable = (t: Task): boolean =>
        ids.has(t.id) &&
        t.status === 'open' &&
        t.goalId === null &&
        t.workspaceId === group.workspaceId
      if (!next.tasks.some(movable)) continue
      const { goal, created } = sessionGoalFor(
        next,
        group.sessionId,
        group.workspaceId,
        null,
        group.sessionGoal,
        group.createdAt
      )
      if (created) counts.goalsCreated += 1
      next.tasks = next.tasks.map((t) => {
        if (!movable(t)) return t
        counts.tasksMoved += 1
        return { ...t, goalId: goal.id }
      })
      tasksChanged = true
    }
    apply({
      ...goalsPart(next),
      ...(tasksChanged ? { tasks: next.tasks } : {}),
      regroupedAt: at
    })
    return counts
  }

  function backupBeforeRegroup(): void {
    backupCopy()
  }

  function tasksForSession(sessionId: string): Task[] {
    return tasks.filter((t) => t.sessionIds.includes(sessionId))
  }

  function removeByWorkspace(workspaceId: string): number {
    const keptGoals = goals.filter((g) => g.workspaceId !== workspaceId)
    const keptTasks = tasks.filter((t) => t.workspaceId !== workspaceId)
    const removed = goals.length - keptGoals.length + (tasks.length - keptTasks.length)
    if (removed === 0) return 0
    apply({ goals: keptGoals, tasks: keptTasks })
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
    addTaskFromExtraction,
    updateTaskFromExtraction,
    reportTask,
    removeTask,
    setTaskStatus,
    link,
    unlink,
    linkMany,
    rebindSession,
    carrySessionGoal,
    notePlanner,
    memoryRegroupedAt: () => regroupedAt,
    applyMemoryRegroup,
    backupBeforeRegroup,
    tasksForSession,
    removeByWorkspace,
    onChange
  }
}
