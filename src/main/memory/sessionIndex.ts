// The memory index of one session (`memoryIndex.ts`): the store's rows for its workspace and
// folder, and the folder's open tasks from the goals view minus the ones the caller already lists
// (the goal block of a launch). Shared by the launch (`memoryLaunch.ts`) and a mod session's
// section. Memory text is sensitive: this module logs nothing.
import type { GoalsView } from '../../shared/schemas/goal'
import { buildMemoryIndex } from './memoryIndex'
import type { MemoryStore } from './memoryStore'
import { openTasksForFolder } from './memoryTasks'

export function buildSessionIndex(
  deps: {
    /** The goals view the folder's open tasks come from; null = no task lines. */
    tasks: () => Pick<GoalsView, 'goals' | 'tasks'> | null
    /** The time the index counts `last seen` days to. */
    now: () => number
  },
  store: Pick<MemoryStore, 'indexRows'>,
  target: { workspaceId: string; cwd: string; excludeTaskIds: readonly string[] },
  /** The index's first block; `MEMORY_RULES_OF_USE` when left out. */
  rules?: string
): { text: string; itemIds: string[] } {
  const view = deps.tasks()
  return buildMemoryIndex(
    {
      ...store.indexRows(target.workspaceId, target.cwd),
      tasksHere:
        view === null
          ? []
          : openTasksForFolder(
              view,
              target.workspaceId,
              target.cwd,
              new Set(target.excludeTaskIds)
            ),
      now: deps.now()
    },
    undefined,
    undefined,
    rules
  )
}
