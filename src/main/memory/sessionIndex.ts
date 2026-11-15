// The memory index of one session (`memoryIndex.ts`): the store's pinned items and recent
// sessions for its workspace and folder, its keys grouped by what they share with the session's
// context (task, goal, folder, template, tags: `contextRows`), the goal and tag names the
// headings print, and the folder's open tasks from the goals view minus the ones the caller
// already lists (the goal block of a launch). Shared by the launch (`memoryLaunch.ts`) and a mod
// session's section. Memory text is sensitive: this module logs nothing.
import type { GoalsView } from '../../shared/schemas/goal'
import { buildMemoryIndex, type MemoryIndex } from './memoryIndex'
import type { MemoryNames } from './memoryNames'
import type { SessionContext } from './memorySearch'
import type { MemoryStore } from './memoryStore'
import { openTasksForFolder } from './memoryTasks'
import type { MemorySessionMeta } from './memoryTools'

/** What a live session shares with the items its index lists. */
export function sessionContext(session: MemorySessionMeta): SessionContext {
  return {
    folder: session.folder,
    taskIds: session.taskIds,
    goalId: session.goalId,
    templateId: session.templateId,
    tagIds: session.tagIds
  }
}

export function buildSessionIndex(
  deps: {
    /** The goals view the folder's open tasks come from; null = no task lines. */
    tasks: () => Pick<GoalsView, 'goals' | 'tasks'> | null
    /** The time the index counts `last seen` days to. */
    now: () => number
    /** The goal and tag names the headings print; a name that is gone is left out. */
    names: Pick<MemoryNames, 'goalName' | 'tagName'>
  },
  store: Pick<MemoryStore, 'indexRows' | 'contextRows' | 'shortIdClashes'>,
  target: { workspaceId: string; context: SessionContext; excludeTaskIds: readonly string[] },
  /** The index's first block; `MEMORY_RULES_OF_USE` when left out. */
  rules?: string
): MemoryIndex {
  const { workspaceId, context } = target
  const view = deps.tasks()
  return buildMemoryIndex(
    {
      ...store.indexRows(workspaceId, context.folder),
      groups: store.contextRows(workspaceId, context),
      names: {
        goal: context.goalId === null ? null : deps.names.goalName(context.goalId),
        tags: context.tagIds.flatMap((id) => deps.names.tagName(id) ?? [])
      },
      clashes: new Set(store.shortIdClashes(workspaceId)),
      tasksHere:
        view === null
          ? []
          : openTasksForFolder(view, workspaceId, context.folder, new Set(target.excludeTaskIds)),
      now: deps.now()
    },
    undefined,
    undefined,
    rules
  )
}
