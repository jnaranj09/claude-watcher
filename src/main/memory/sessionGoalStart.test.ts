// The one-time memory cleanup seam (`regroupMemoryTasks`) over a real goals store on a fake blob
// that keeps what it writes, so a re-created store reads the same file (a restart). The file is
// seeded as a build from before memory goals left it: memory tasks in Daily tasks, no touches.
import { describe, expect, it } from 'vitest'
import type { GoalsFile } from '../../shared/schemas/goal'
import type { PastSession } from '../../shared/schemas/pastSession'
import { createGoalsStore, type GoalsBlobStore, type GoalsStore } from '../persistence/goals'
import { formatDay } from './formatDay'
import { regroupMemoryTasks } from './sessionGoalStart'

interface Seed {
  id: string
  session?: string | null
  workspaceId?: string
  goalId?: string | null
  status?: 'open' | 'done'
  sessionIds?: string[]
  createdAt?: number
  folder?: string | null
}

const DAY = 86_400_000
const T0 = Date.UTC(2026, 10, 2, 12)

function task(s: Seed): Record<string, unknown> {
  return {
    id: s.id,
    workspaceId: s.workspaceId ?? 'w1',
    goalId: s.goalId ?? null,
    title: `title ${s.id}`,
    status: s.status ?? 'open',
    sessionIds: s.sessionIds ?? [],
    createdAt: s.createdAt ?? T0,
    originSessionId: s.session === undefined ? 'S' : s.session,
    folder: s.folder ?? null
  }
}

function record(id: string, name: string, cwd = '/rec'): PastSession {
  return { id, name, cwd, workspaceId: 'w1', tagIds: [], launchedAt: 1, endedAt: 2 }
}

interface World {
  open: (backupCopy?: () => boolean) => GoalsStore
  writes: () => number
  lines: string[]
  run: (store: GoalsStore | null, records?: PastSession[]) => void
}

function world(tasks: Seed[], goals: Record<string, unknown>[] = []): World {
  let blob: unknown = { version: 1, goals, tasks: tasks.map(task) }
  let writes = 0
  let ids = 0
  const lines: string[] = []
  const blobStore: GoalsBlobStore = {
    read: () => blob,
    write: (value) => {
      writes++
      blob = value
    },
    backup: () => undefined
  }
  return {
    open: (backupCopy) =>
      createGoalsStore({
        blobStore,
        newId: () => `g${++ids}`,
        now: () => T0,
        ...(backupCopy === undefined ? {} : { backupCopy })
      }),
    writes: () => writes,
    lines,
    run: (store, records = []) => {
      regroupMemoryTasks({
        goals: store,
        record: (id) => records.find((r) => r.id === id) ?? null,
        now: () => 777,
        log: (line) => lines.push(line)
      })
    }
  }
}

function goalOf(store: GoalsStore, taskId: string): GoalsFile['goals'][number] | undefined {
  const goalId = store.view().tasks.find((t) => t.id === taskId)?.goalId
  return store.view().goals.find((g) => g.id === goalId)
}

describe('regroupMemoryTasks', () => {
  it('groups open memory Daily tasks by session and workspace, one memory goal each', () => {
    const w = world([
      { id: 'a', session: 'S' },
      { id: 'b', session: 'S' },
      { id: 'c', session: 'S', workspaceId: 'w2' },
      { id: 'd', session: 'T' }
    ])
    const store = w.open()
    w.run(store)
    expect(goalOf(store, 'a')?.id).toBe(goalOf(store, 'b')?.id)
    expect(goalOf(store, 'a')).toMatchObject({ workspaceId: 'w1', memorySessionIds: ['S'] })
    expect(goalOf(store, 'c')).toMatchObject({ workspaceId: 'w2', memorySessionIds: ['S'] })
    expect(goalOf(store, 'd')).toMatchObject({ workspaceId: 'w1', memorySessionIds: ['T'] })
    expect(store.view().goals).toHaveLength(3)
    expect(w.lines).toEqual([
      '[claude-watcher][goals] code=goals_memory_regroup goals=3 tasks=4 touched=4'
    ])
  })

  it('moves only open memory Daily tasks; a linked one stays but still gets its touch', () => {
    const w = world(
      [
        { id: 'open', session: 'S' },
        { id: 'linked', session: 'S', sessionIds: ['S'] },
        { id: 'done', session: 'S', status: 'done' },
        { id: 'inGoal', session: 'S', goalId: 'auth' },
        { id: 'byHand', session: null }
      ],
      [{ id: 'auth', workspaceId: 'w1', name: 'Auth', createdAt: 1 }]
    )
    const store = w.open()
    w.run(store)
    expect(goalOf(store, 'open')?.memorySessionIds).toEqual(['S'])
    expect(store.view().tasks.map((t) => [t.id, t.goalId === null])).toEqual([
      ['open', false],
      ['linked', true],
      ['done', true],
      ['inGoal', false],
      ['byHand', true]
    ])
    expect(goalOf(store, 'inGoal')?.id).toBe('auth')
    const touches = Object.fromEntries(store.view().tasks.map((t) => [t.id, t.touchedBy]))
    for (const id of ['open', 'linked', 'done', 'inGoal']) {
      expect(touches[id]).toEqual([{ sessionId: 'S', at: T0 }])
    }
    expect(touches.byHand).toEqual([])
  })

  it('takes the folder of the newest task that has one, then the record cwd, then null', () => {
    const w = world([
      { id: 'a', session: 'S', createdAt: T0, folder: '/old' },
      { id: 'b', session: 'S', createdAt: T0 + 2, folder: '/new' },
      { id: 'c', session: 'S', createdAt: T0 + 5 },
      { id: 'd', session: 'R' },
      { id: 'e', session: 'N' }
    ])
    const store = w.open()
    w.run(store, [record('R', 'Rec name', '/rec')])
    expect(goalOf(store, 'a')?.defaultCwd).toBe('/new')
    expect(goalOf(store, 'd')?.defaultCwd).toBe('/rec')
    expect(goalOf(store, 'e')?.defaultCwd).toBeNull()
  })

  it('names the goal after the record, else the fallback with the newest task day', () => {
    const w = world([
      { id: 'a', session: 'R' },
      { id: 'b', session: 'F', createdAt: T0, folder: '/x/proj' },
      { id: 'c', session: 'F', createdAt: T0 + 3 * DAY },
      { id: 'd', session: 'N', createdAt: T0 + DAY }
    ])
    const store = w.open()
    w.run(store, [record('R', 'Fix login')])
    expect(goalOf(store, 'a')?.name).toBe('Fix login')
    expect(goalOf(store, 'b')?.name).toBe(`proj ${formatDay(T0 + 3 * DAY)}`)
    expect(goalOf(store, 'd')?.name).toBe(`Session ${formatDay(T0 + DAY)}`)
  })

  it("gives a created goal the group's newest task createdAt", () => {
    const w = world([
      { id: 'a', session: 'S', createdAt: T0 + 4 },
      { id: 'b', session: 'S', createdAt: T0 + 9 },
      { id: 'c', session: 'S', createdAt: T0 + 1 }
    ])
    const store = w.open()
    w.run(store)
    expect(goalOf(store, 'a')?.createdAt).toBe(T0 + 9)
  })

  it('with no memory tasks still writes the marker, which a re-created store returns', () => {
    const w = world([{ id: 'byHand', session: null }])
    const store = w.open()
    w.run(store)
    expect(store.memoryRegroupedAt()).toBe(777)
    expect(w.open().memoryRegroupedAt()).toBe(777)
    expect(w.lines).toEqual([])
  })

  it('a second call does nothing and logs nothing', () => {
    const w = world([{ id: 'a', session: 'S' }])
    let copies = 0
    const store = w.open(() => {
      copies++
      return true
    })
    w.run(store)
    const writes = w.writes()
    const lines = w.lines.length
    w.run(store)
    expect(w.writes()).toBe(writes)
    expect(w.lines).toHaveLength(lines)
    expect(copies).toBe(1)
  })

  it('takes the backup once, before the write', () => {
    const w = world([{ id: 'a', session: 'S' }])
    const writesAtCopy: number[] = []
    const store = w.open(() => {
      writesAtCopy.push(w.writes())
      return true
    })
    const before = w.writes()
    w.run(store)
    expect(writesAtCopy).toEqual([before])
    expect(w.writes()).toBe(before + 1)
  })

  it('a failed backup logs its code, moves nothing and leaves the marker unset', () => {
    const w = world([{ id: 'a', session: 'S' }])
    const store = w.open(() => {
      throw new Error('EACCES')
    })
    const writes = w.writes()
    w.run(store)
    expect(w.lines).toEqual(['[claude-watcher][goals] code=goals_memory_regroup_backup_failed'])
    expect(store.memoryRegroupedAt()).toBeNull()
    expect(w.writes()).toBe(writes)
    expect(store.view().tasks[0]?.goalId).toBeNull()
  })

  it('runs when backupCopy returns false (no file on disk yet)', () => {
    const w = world([{ id: 'a', session: 'S' }])
    const store = w.open(() => false)
    w.run(store)
    expect(store.memoryRegroupedAt()).toBe(777)
    expect(goalOf(store, 'a')?.memorySessionIds).toEqual(['S'])
  })

  it('with no goals store does nothing', () => {
    const w = world([{ id: 'a', session: 'S' }])
    w.run(null)
    expect(w.lines).toEqual([])
    expect(w.writes()).toBe(0)
  })

  it('a throw is caught and logs the failure code; the marker stays unset', () => {
    const w = world([{ id: 'a', session: 'S' }])
    const store = w.open()
    const lines: string[] = []
    regroupMemoryTasks({
      goals: store,
      record: () => {
        throw new Error('records broke')
      },
      now: () => 1,
      log: (line) => lines.push(line)
    })
    expect(lines).toEqual(['[claude-watcher][goals] code=goals_memory_regroup_failed'])
    expect(store.memoryRegroupedAt()).toBeNull()
  })
})
