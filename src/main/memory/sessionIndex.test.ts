// The index of one session: the store's rows for its folder, and the folder's open tasks minus
// the ones the caller already lists.
import { describe, expect, it } from 'vitest'
import { TaskSchema, type GoalsView } from '../../shared/schemas/goal'
import type { MemoryStore } from './memoryStore'
import { buildSessionIndex } from './sessionIndex'

const NOW = 1_762_800_000_000

const NO_ROWS: Pick<MemoryStore, 'indexRows'> = {
  indexRows: () => ({ pinned: [], specificsHere: [], episodesHere: [], more: 0 })
}

function task(id: string, title: string): GoalsView['tasks'][number] {
  return TaskSchema.parse({
    id,
    workspaceId: 'w1',
    title,
    status: 'open',
    createdAt: NOW,
    folder: '/work/app'
  })
}

const TARGET = { workspaceId: 'w1', cwd: '/work/app', excludeTaskIds: ['t2'] }

describe('buildSessionIndex', () => {
  it("lists the folder's open tasks, minus the excluded ones", () => {
    const view = {
      goals: [],
      tasks: [task('t1', 'Turn the cache on'), task('t2', 'Rotate the logs')]
    }
    const { text } = buildSessionIndex({ tasks: () => view, now: () => NOW }, NO_ROWS, TARGET)
    expect([text.includes('Turn the cache on'), text.includes('Rotate the logs')]).toEqual([
      true,
      false
    ])
  })

  it('with no goals view it lists no task', () => {
    const { text } = buildSessionIndex({ tasks: () => null, now: () => NOW }, NO_ROWS, TARGET)
    expect(text.includes('## Open tasks for this folder')).toBe(false)
  })
})
