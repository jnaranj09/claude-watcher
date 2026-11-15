import { describe, it, expect } from 'vitest'
import type { Goal, Task } from '../../shared/schemas/goal'
import { EXTRACT_LIMITS } from '../../shared/schemas/memoryExtract'
import { goalOfTasks, openTasksForFolder, scopeTasksForExtract } from './memoryTasks'

const SHOP = '/work/acme/shop'

function goal(over: Partial<Goal> & Pick<Goal, 'id'>): Goal {
  return {
    workspaceId: 'w1',
    name: `Goal ${over.id}`,
    defaultCwd: SHOP,
    saveToFile: false,
    createdAt: 1,
    ...over
  }
}

function task(over: Partial<Task> & Pick<Task, 'id' | 'createdAt'>): Task {
  return {
    workspaceId: 'w1',
    goalId: null,
    title: `Task ${over.id}`,
    status: 'open',
    sessionIds: [],
    doneAt: null,
    doneBy: null,
    check: null,
    leftWith: null,
    lastSeenAt: null,
    report: null,
    originSessionId: null,
    folder: null,
    ...over
  }
}

const NONE: ReadonlySet<string> = new Set()

describe('openTasksForFolder', () => {
  it('lists an open task of the folder and one whose goal lives in the folder, newest first', () => {
    const view = {
      goals: [goal({ id: 'g1' })],
      tasks: [
        task({
          id: 'mine',
          createdAt: 2,
          folder: `${SHOP}/api`,
          check: 'npm test',
          leftWith: 'operator',
          lastSeenAt: 7,
          report: {
            at: 8,
            sessionId: 's1',
            sessionName: 'n',
            outcome: 'done',
            evidence: 'seen green'
          }
        }),
        task({ id: 'by-goal', createdAt: 3, goalId: 'g1' })
      ]
    }
    expect(openTasksForFolder(view, 'w1', SHOP, NONE)).toEqual([
      {
        id: 'by-goal',
        title: 'Task by-goal',
        createdAt: 3,
        lastSeenAt: null,
        leftWith: null,
        check: null,
        reportedDoneAt: null
      },
      {
        id: 'mine',
        title: 'Task mine',
        createdAt: 2,
        lastSeenAt: 7,
        leftWith: 'operator',
        check: 'npm test',
        reportedDoneAt: 8
      }
    ])
  })

  it('an open report is not a done date', () => {
    const view = {
      goals: [],
      tasks: [
        task({
          id: 't',
          createdAt: 1,
          folder: SHOP,
          report: { at: 8, sessionId: 's1', sessionName: 'n', outcome: 'open', evidence: 'not yet' }
        })
      ]
    }
    expect(openTasksForFolder(view, 'w1', SHOP, NONE)[0]?.reportedDoneAt).toBeNull()
  })

  it('leaves out done tasks, other workspaces, other folders and the excluded ids', () => {
    const view = {
      goals: [goal({ id: 'g-else', defaultCwd: '/work/other' })],
      tasks: [
        task({ id: 'done', createdAt: 1, folder: SHOP, status: 'done' }),
        task({ id: 'w2', createdAt: 1, folder: SHOP, workspaceId: 'w2' }),
        task({ id: 'else', createdAt: 1, folder: '/work/other' }),
        task({ id: 'goal-else', createdAt: 1, goalId: 'g-else' }),
        task({ id: 'nowhere', createdAt: 1 }),
        task({ id: 'sibling', createdAt: 1, folder: '/work/acme/shopfront' }),
        task({ id: 'excluded', createdAt: 1, folder: SHOP }),
        task({ id: 'kept', createdAt: 1, folder: SHOP })
      ]
    }
    const ids = openTasksForFolder(view, 'w1', SHOP, new Set(['excluded'])).map((t) => t.id)
    expect(ids).toEqual(['kept'])
  })

  it("a task's own folder wins over its goal's", () => {
    const view = {
      goals: [goal({ id: 'g1' })],
      tasks: [task({ id: 't', createdAt: 1, goalId: 'g1', folder: '/work/other' })]
    }
    expect(openTasksForFolder(view, 'w1', SHOP, NONE)).toEqual([])
  })

  it('stops at 20 tasks', () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      task({ id: `t${i}`, createdAt: i, folder: SHOP })
    )
    const listed = openTasksForFolder({ goals: [], tasks }, 'w1', SHOP, NONE)
    expect(listed).toHaveLength(EXTRACT_LIMITS.tasksInIndex)
    expect(listed[0]?.id).toBe('t24')
  })
})

describe('scopeTasksForExtract', () => {
  it('the scope for extraction puts the session linked tasks first and stops at the limit', () => {
    const view = {
      goals: [],
      tasks: [
        task({ id: 'newest', createdAt: 9 }),
        task({ id: 'folder', createdAt: 2, folder: SHOP }),
        task({ id: 'linked', createdAt: 1, sessionIds: ['s1'] }),
        task({ id: 'older', createdAt: 5 }),
        task({ id: 'done', createdAt: 10, status: 'done', sessionIds: ['s1'] }),
        task({ id: 'w2', createdAt: 11, workspaceId: 'w2' })
      ]
    }
    expect(scopeTasksForExtract(view, 'w1', SHOP, 's1', 10)).toEqual([
      { id: 'linked', title: 'Task linked' },
      { id: 'folder', title: 'Task folder' },
      { id: 'newest', title: 'Task newest' },
      { id: 'older', title: 'Task older' }
    ])
    expect(scopeTasksForExtract(view, 'w1', SHOP, 's1', 2).map((t) => t.id)).toEqual([
      'linked',
      'folder'
    ])
  })

  it('with no folder the scope goes linked first, then newest', () => {
    const view = {
      goals: [],
      tasks: [
        task({ id: 'folder', createdAt: 2, folder: SHOP }),
        task({ id: 'newest', createdAt: 9 }),
        task({ id: 'linked', createdAt: 1, sessionIds: ['s1'] })
      ]
    }
    expect(scopeTasksForExtract(view, 'w1', null, 's1', 10).map((t) => t.id)).toEqual([
      'linked',
      'newest',
      'folder'
    ])
  })
})

describe('goalOfTasks', () => {
  const view = {
    tasks: [
      task({ id: 'a1', createdAt: 1, goalId: 'gA' }),
      task({ id: 'a2', createdAt: 2, goalId: 'gA' }),
      task({ id: 'b1', createdAt: 3, goalId: 'gB' }),
      task({ id: 'loose', createdAt: 4 })
    ]
  }

  it('is the goal two tasks of one goal share', () => {
    expect(goalOfTasks(view, ['a1', 'a2'])).toBe('gA')
  })

  it('is null for no task, for tasks of two goals and for a loose task', () => {
    expect([
      goalOfTasks(view, []),
      goalOfTasks(view, ['a1', 'b1']),
      goalOfTasks(view, ['a1', 'loose']),
      goalOfTasks(view, ['a1', 'unknown'])
    ]).toEqual([null, null, null, null])
  })
})
