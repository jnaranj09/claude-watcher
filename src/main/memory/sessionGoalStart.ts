// The one-time memory cleanup at app start (spec 2026-11-18 memory session goals): every memory
// task gets its session's touch, and each session's open memory tasks in Daily tasks move into
// that session's memory goal. It runs once (the store's `memoryRegroupedAt` marker), before
// memory's catch-up (`index.ts`; `tests/main/regroupOrder.guard.test.ts` pins the order), so a
// catch-up save cannot make a goal the cleanup then makes again. Logs carry codes and counts only:
// session names, titles and folders are SENSITIVE.
import type { PastSession } from '../../shared/schemas/pastSession'
import type { Task } from '../../shared/schemas/goal'
import type { GoalsStore, MemoryRegroupGroup, SessionGoal } from '../persistence/goals'
import { sessionGoalName } from './sessionGoal'

export interface RegroupDeps {
  goals: Pick<
    GoalsStore,
    'view' | 'memoryRegroupedAt' | 'applyMemoryRegroup' | 'backupBeforeRegroup'
  > | null
  /** The session's Past sessions record (its name and launch folder), or null. */
  record: (id: string) => PastSession | null
  now: () => number
  log: (line: string) => void
}

/** A memory task the cleanup moves: open, in Daily tasks, made by a session, linked to none (a
 *  linked task stays in Daily tasks: moving it would change the goal its session reports). */
function movable(t: Task): t is Task & { originSessionId: string } {
  return (
    t.status === 'open' &&
    t.goalId === null &&
    t.originSessionId !== null &&
    t.sessionIds.length === 0
  )
}

/** The newest task by `createdAt` among `tasks` (non-empty). */
function newestOf(tasks: readonly Task[], first: Task): Task {
  return tasks.reduce((a, b) => (b.createdAt > a.createdAt ? b : a), first)
}

/** Name and folder of a session's memory goal: the folder of its newest task that has one, else
 *  the record's `cwd`, else null; the record's name, else the fallback with `at`'s day. */
function goalFor(tasks: readonly Task[], record: PastSession | null, at: number): SessionGoal {
  const withFolder = tasks.filter((t) => t.folder !== null)
  const [firstWithFolder] = withFolder
  const folder =
    firstWithFolder === undefined
      ? (record?.cwd ?? null)
      : newestOf(withFolder, firstWithFolder).folder
  return { name: sessionGoalName(record?.name ?? null, folder, at), folder }
}

/** One group per (session, workspace). Every id comes from a task the store parsed (`IdSchema`,
 *  non-empty), never a literal. */
function groupsOf(tasks: readonly Task[], record: RegroupDeps['record']): MemoryRegroupGroup[] {
  const bySession = new Map<string, Map<string, Task[]>>()
  for (const t of tasks) {
    if (!movable(t)) continue
    const byWorkspace = bySession.get(t.originSessionId) ?? new Map<string, Task[]>()
    bySession.set(t.originSessionId, byWorkspace)
    byWorkspace.set(t.workspaceId, [...(byWorkspace.get(t.workspaceId) ?? []), t])
  }
  const groups: MemoryRegroupGroup[] = []
  for (const [sessionId, byWorkspace] of bySession) {
    const rec = record(sessionId)
    for (const [workspaceId, list] of byWorkspace) {
      const [first] = list
      if (first === undefined) continue
      const createdAt = newestOf(list, first).createdAt
      groups.push({
        sessionId,
        workspaceId,
        sessionGoal: goalFor(list, rec, createdAt),
        createdAt,
        taskIds: list.map((t) => t.id)
      })
    }
  }
  return groups
}

/** Runs the cleanup once: nothing with no goals store or once the marker is set. The goals file is
 *  copied aside first (`backupBeforeRegroup`); a failed copy logs
 *  `goals_memory_regroup_backup_failed` and leaves the cleanup for the next start. Never throws. */
export function regroupMemoryTasks(deps: RegroupDeps): void {
  const { goals } = deps
  if (goals === null) return
  try {
    if (goals.memoryRegroupedAt() !== null) return
    const groups = groupsOf(goals.view().tasks, deps.record)
    try {
      goals.backupBeforeRegroup()
    } catch {
      deps.log('[claude-watcher][goals] code=goals_memory_regroup_backup_failed')
      return
    }
    const out = goals.applyMemoryRegroup(groups, deps.now())
    if (out.goalsCreated > 0 || out.tasksMoved > 0 || out.tasksTouched > 0) {
      deps.log(
        `[claude-watcher][goals] code=goals_memory_regroup goals=${out.goalsCreated} tasks=${out.tasksMoved} touched=${out.tasksTouched}`
      )
    }
  } catch {
    // Code only: an error message could quote a task title or a folder.
    deps.log('[claude-watcher][goals] code=goals_memory_regroup_failed')
  }
}
