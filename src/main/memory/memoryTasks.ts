// Memory phase 2: reads of the goals view for memory (pure). The index lists a folder's open tasks
// (`openTasksForFolder`); extraction gets the workspace's open tasks as its scope
// (`scopeTasksForExtract`, D19). Titles and checks are SENSITIVE: these never log.
import type { GoalsView, Task, TaskLeftWith } from '../../shared/schemas/goal'
import { EXTRACT_LIMITS } from '../../shared/schemas/memoryExtract'
import { foldersRelated } from './folderMatch'

type GoalsLists = Pick<GoalsView, 'goals' | 'tasks'>

export type IndexTask = {
  id: string
  title: string
  createdAt: number
  lastSeenAt: number | null
  leftWith: TaskLeftWith | null
  check: string | null
  reportedDoneAt: number | null
}

function openOf(view: GoalsLists, workspaceId: string): Task[] {
  return view.tasks.filter((t) => t.workspaceId === workspaceId && t.status === 'open')
}

const newestFirst = (a: Task, b: Task): number => b.createdAt - a.createdAt

/** The task's own folder, else its goal's; null when it has neither. */
function folderOf(view: GoalsLists, task: Task): string | null {
  if (task.folder !== null) return task.folder
  if (task.goalId === null) return null
  return view.goals.find((g) => g.id === task.goalId)?.defaultCwd ?? null
}

function inFolder(view: GoalsLists, task: Task, folder: string): boolean {
  const own = folderOf(view, task)
  return own !== null && foldersRelated(own, folder)
}

/** Open tasks of `workspaceId` whose folder (or, with none, their goal's folder) is related to
 *  `folder`, not in `exclude`, newest first, at most EXTRACT_LIMITS.tasksInIndex. `reportedDoneAt`
 *  is the report's date when its outcome is `done`. */
export function openTasksForFolder(
  view: GoalsLists,
  workspaceId: string,
  folder: string,
  exclude: ReadonlySet<string>
): IndexTask[] {
  return openOf(view, workspaceId)
    .filter((t) => !exclude.has(t.id) && inFolder(view, t, folder))
    .sort(newestFirst)
    .slice(0, EXTRACT_LIMITS.tasksInIndex)
    .map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      lastSeenAt: t.lastSeenAt,
      leftWith: t.leftWith,
      check: t.check,
      reportedDoneAt: t.report?.outcome === 'done' ? t.report.at : null
    }))
}

/** D19: open tasks of the workspace, those linked to `sessionId` first, then the folder's, then
 *  newest; at most `limit`. */
export function scopeTasksForExtract(
  view: GoalsLists,
  workspaceId: string,
  folder: string | null,
  sessionId: string,
  limit: number
): { id: string; title: string }[] {
  const rank = (t: Task): number => {
    if (t.sessionIds.includes(sessionId)) return 0
    if (folder !== null && inFolder(view, t, folder)) return 1
    return 2
  }
  return openOf(view, workspaceId)
    .sort((a, b) => rank(a) - rank(b) || newestFirst(a, b))
    .slice(0, limit)
    .map((t) => ({ id: t.id, title: t.title }))
}
