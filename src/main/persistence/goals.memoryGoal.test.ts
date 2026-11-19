// Memory goals in the goals store (spec 2026-11-18 memory session goals): where a memory task goes
// (planner record → `metaGoalId` → the session's own memory goal → a new one), the session lineage
// and planner records that keep a session's ids together, touches, the caps, and the one-time
// cleanup's store step. Stores are built on a fake blob that keeps what it writes, so a re-created
// store reads the same file (a restart).
import { describe, expect, it } from 'vitest'
import type { GoalsFile } from '../../shared/schemas/goal'
import {
  createGoalsStore,
  GOAL_MEMORY_SESSIONS_MAX,
  PLANNER_SESSIONS_MAX,
  SESSION_LINEAGE_MAX,
  TASK_TOUCHED_BY_MAX,
  type GoalsBlobStore,
  type GoalsStore
} from './goals'

interface Harness {
  open: (opts?: { report?: (code: string) => void; backupCopy?: () => boolean }) => GoalsStore
  file: () => GoalsFile
  writes: () => number
  emits: () => number
  lines: string[]
  refuseWrites: () => void
  breakClock: () => void
}

function harness(): Harness {
  let blob: unknown = undefined
  let writes = 0
  let emits = 0
  let refused = false
  let clockBroken = false
  let ids = 0
  let clock = 1000
  const lines: string[] = []
  const blobStore: GoalsBlobStore = {
    read: () => blob,
    write: (value) => {
      if (refused) throw new Error('disk full')
      writes++
      blob = value
    },
    backup: () => undefined
  }
  return {
    open: (opts = {}) => {
      const store = createGoalsStore({
        blobStore,
        log: (line) => lines.push(line),
        newId: () => `id${++ids}`,
        now: () => {
          if (clockBroken) throw new Error('clock')
          return ++clock
        },
        ...opts
      })
      store.onChange(() => emits++)
      return store
    },
    file: () => blob as GoalsFile,
    writes: () => writes,
    emits: () => emits,
    lines,
    refuseWrites: () => {
      refused = true
    },
    breakClock: () => {
      clockBroken = true
    }
  }
}

interface Save {
  metaGoalId?: string | null
  workspaceId?: string
  name?: string
  folder?: string | null
  title?: string
  at?: number
}

function save(
  store: GoalsStore,
  sessionId: string,
  s: Save = {}
): ReturnType<GoalsStore['addTaskFromExtraction']> {
  const folder = s.folder === undefined ? '/proj' : s.folder
  return store.addTaskFromExtraction({
    workspaceId: s.workspaceId ?? 'w1',
    metaGoalId: s.metaGoalId ?? null,
    title: s.title ?? `task of ${sessionId}`,
    check: null,
    leftWith: 'session',
    sessionId,
    sessionGoal: { name: s.name ?? `Session ${sessionId}`, folder },
    folder,
    at: s.at ?? 5000
  })
}

function goalOf(store: GoalsStore, taskId: string): string | null {
  return store.view().tasks.find((t) => t.id === taskId)?.goalId ?? null
}

function memoryGoals(store: GoalsStore): { name: string; memorySessionIds: string[] }[] {
  return store
    .view()
    .goals.filter((g) => g.memorySessionIds.length > 0)
    .map((g) => ({ name: g.name, memorySessionIds: g.memorySessionIds }))
}

function operatorGoal(store: GoalsStore, name: string, workspaceId = 'w1'): string {
  return store.saveGoal({ workspaceId, name }, '/work').saved.id
}

describe('a new memory task', () => {
  it('is one write and one emit, and makes a goal named after the session with its folder', () => {
    const h = harness()
    const store = h.open()
    const before = { writes: h.writes(), emits: h.emits() }
    const out = save(store, 's1', { name: 'Fix login', folder: '/home/u/proj', at: 77 })
    expect(h.writes() - before.writes).toBe(1)
    expect(h.emits() - before.emits).toBe(1)
    expect(out).toMatchObject({ goalCreated: true, memoryGoals: 1 })
    expect(store.view().goals).toEqual([
      expect.objectContaining({
        name: 'Fix login',
        defaultCwd: '/home/u/proj',
        saveToFile: false,
        createdAt: 77,
        memorySessionIds: ['s1']
      })
    ])
    expect(out.task).toMatchObject({
      goalId: store.view().goals[0]?.id,
      originSessionId: 's1',
      sessionIds: [],
      touchedBy: [{ sessionId: 's1', at: 77 }]
    })
  })

  it('a null folder makes a goal with no folder', () => {
    const store = harness().open()
    save(store, 's1', { folder: null })
    expect(store.view().goals[0]?.defaultCwd).toBeNull()
  })

  it('goes planner → metaGoalId → own memory goal → new, as given', () => {
    const store = harness().open()
    const auth = operatorGoal(store, 'Auth')
    const first = save(store, 's1', { metaGoalId: null })
    const own = first.task.goalId
    expect(first.goalCreated).toBe(true)
    expect(save(store, 's1', { metaGoalId: auth }).task.goalId).toBe(auth)
    expect(save(store, 's1', { metaGoalId: null }).task.goalId).toBe(own)
    const plan = operatorGoal(store, 'Plan')
    store.notePlanner('s1', plan)
    expect(save(store, 's1', { metaGoalId: auth }).task.goalId).toBe(plan)
    expect(memoryGoals(store)).toEqual([{ name: 'Session s1', memorySessionIds: ['s1'] }])
  })

  it('the second task reuses the goal', () => {
    const store = harness().open()
    const a = save(store, 's1')
    const b = save(store, 's1')
    expect(b.goalCreated).toBe(false)
    expect(b.task.goalId).toBe(a.task.goalId)
    expect(store.view().goals).toHaveLength(1)
  })

  it('another workspace gets its own goal', () => {
    const store = harness().open()
    const a = save(store, 's1', { workspaceId: 'w1' })
    const b = save(store, 's1', { workspaceId: 'w2' })
    expect(b.goalCreated).toBe(true)
    expect(b.memoryGoals).toBe(1)
    expect(b.task.goalId).not.toBe(a.task.goalId)
    expect(store.view().goals.map((g) => g.workspaceId)).toEqual(['w1', 'w2'])
  })

  it('a refused title writes nothing and creates no goal', () => {
    const h = harness()
    const store = h.open()
    const before = { writes: h.writes(), emits: h.emits() }
    expect(() => save(store, 's1', { title: 'a\tb' })).toThrow()
    expect(store.view().goals).toEqual([])
    expect(store.view().tasks).toEqual([])
    expect(h.writes()).toBe(before.writes)
    expect(h.emits()).toBe(before.emits)
  })

  it('a refused disk write keeps the change and reports write_failed', () => {
    const h = harness()
    const reported: string[] = []
    const store = h.open({ report: (code) => reported.push(code) })
    h.refuseWrites()
    save(store, 's1')
    expect(store.view().goals).toHaveLength(1)
    expect(store.view().tasks).toHaveLength(1)
    expect(reported).toEqual(['write_failed'])
  })

  it('a deleted planned goal falls through to metaGoalId, then to a memory goal', () => {
    const store = harness().open()
    const plan = operatorGoal(store, 'Plan')
    const auth = operatorGoal(store, 'Auth')
    store.notePlanner('p1', plan)
    store.removeGoal(plan)
    expect(save(store, 'p1', { metaGoalId: auth }).task.goalId).toBe(auth)
    expect(save(store, 'p1').goalCreated).toBe(true)
  })

  it('two matching memory goals: the oldest wins', () => {
    const store = harness().open()
    const newer = save(store, 'b', { at: 200 }).task.goalId
    const older = save(store, 'a', { at: 100 }).task.goalId
    store.carrySessionGoal('a', 'b')
    expect(save(store, 'b').task.goalId).toBe(older)
    expect(older).not.toBe(newer)
  })

  it("a session whose metaGoalId is another session's memory goal is not added to it", () => {
    const store = harness().open()
    const goalOfA = save(store, 'a').task.goalId
    const b = save(store, 'b', { metaGoalId: goalOfA })
    expect(b.task.goalId).toBe(goalOfA)
    expect(memoryGoals(store)).toEqual([{ name: 'Session a', memorySessionIds: ['a'] }])
    const later = save(store, 'b')
    expect(later.goalCreated).toBe(true)
    expect(later.task.goalId).not.toBe(goalOfA)
  })

  it('a found memory goal gains the save id when the cap had dropped it', () => {
    const store = harness().open()
    save(store, 's0')
    for (let i = 0; i < GOAL_MEMORY_SESSIONS_MAX; i++) store.carrySessionGoal(`s${i}`, `s${i + 1}`)
    expect(memoryGoals(store)[0]?.memorySessionIds).not.toContain('s0')
    expect(save(store, 's0').goalCreated).toBe(false)
    const ids = memoryGoals(store)[0]?.memorySessionIds ?? []
    expect(ids).toHaveLength(GOAL_MEMORY_SESSIONS_MAX)
    expect(ids.at(-1)).toBe('s0')
  })
})

describe('an update from memory', () => {
  function withTask(): { store: GoalsStore; id: string; goalId: string | null } {
    const store = harness().open()
    const { task } = save(store, 's1', { at: 10 })
    return { store, id: task.id, goalId: task.goalId }
  }

  function update(
    store: GoalsStore,
    id: string,
    sessionId: string,
    at: number,
    seen = true
  ): boolean {
    return store.updateTaskFromExtraction(id, {
      check: null,
      leftWith: 'session',
      at,
      seen,
      sessionId
    })
  }

  it('records the touch, kept in order of at, and never moves the task', () => {
    const { store, id, goalId } = withTask()
    update(store, id, 's2', 20)
    update(store, id, 's1', 30)
    const task = store.view().tasks[0]
    expect(task?.touchedBy).toEqual([
      { sessionId: 's2', at: 20 },
      { sessionId: 's1', at: 30 }
    ])
    expect(task?.goalId).toBe(goalId)
    expect(task?.sessionIds).toEqual([])
  })

  it('records no touch when seen is false (R48)', () => {
    const { store, id } = withTask()
    update(store, id, 's2', 20, false)
    expect(store.view().tasks[0]?.touchedBy).toEqual([{ sessionId: 's1', at: 10 }])
  })

  it('a done or unknown task records no touch', () => {
    const { store, id } = withTask()
    store.setTaskStatus(id, 'done', 'operator')
    expect(update(store, id, 's2', 20)).toBe(false)
    expect(update(store, 'gone', 's2', 20)).toBe(false)
    expect(store.view().tasks[0]?.touchedBy).toEqual([{ sessionId: 's1', at: 10 }])
  })

  it(`keeps the newest ${TASK_TOUCHED_BY_MAX} touches`, () => {
    const { store, id } = withTask()
    for (let i = 0; i < TASK_TOUCHED_BY_MAX + 5; i++) update(store, id, `x${i}`, 100 + i)
    const touched = store.view().tasks[0]?.touchedBy ?? []
    expect(touched).toHaveLength(TASK_TOUCHED_BY_MAX)
    expect(touched[0]).toEqual({ sessionId: 'x5', at: 105 })
    expect(touched.at(-1)).toEqual({ sessionId: `x${TASK_TOUCHED_BY_MAX + 4}`, at: 124 })
  })
})

describe('moving the mapping', () => {
  it('a rename keeps memorySessionIds', () => {
    const store = harness().open()
    const goalId = save(store, 's1').task.goalId ?? ''
    store.saveGoal({ id: goalId, workspaceId: 'w1', name: 'Renamed' })
    expect(memoryGoals(store)).toEqual([{ name: 'Renamed', memorySessionIds: ['s1'] }])
  })

  it('rebindSession to the same id writes nothing', () => {
    const h = harness()
    const store = h.open()
    save(store, 's1')
    const writes = h.writes()
    store.rebindSession('s1', 's1')
    expect(h.writes()).toBe(writes)
    expect(h.file().sessionLineage).toEqual([])
  })

  it('rebindSession adds the new id on a goal whose tasks are all done', () => {
    const store = harness().open()
    const { task } = save(store, 's1')
    store.setTaskStatus(task.id, 'done', 'operator')
    store.rebindSession('s1', 's2')
    expect(memoryGoals(store)[0]?.memorySessionIds).toEqual(['s1', 's2'])
  })

  it('rebindSession merges a duplicate touch, keeping the later at, in order', () => {
    const store = harness().open()
    const { task } = save(store, 's1', { at: 10 })
    const touchAt = (sessionId: string, at: number): void => {
      store.updateTaskFromExtraction(task.id, {
        check: null,
        leftWith: 'session',
        at,
        seen: true,
        sessionId
      })
    }
    touchAt('s2', 20)
    touchAt('s3', 30)
    touchAt('s1', 40)
    store.rebindSession('s1', 's2')
    expect(store.view().tasks[0]?.touchedBy).toEqual([
      { sessionId: 's3', at: 30 },
      { sessionId: 's2', at: 40 }
    ])
  })

  it('rebindSession writes the lineage with no goal present, and a /clear nothing names does not emit', () => {
    const h = harness()
    const store = h.open()
    const before = { writes: h.writes(), emits: h.emits() }
    store.rebindSession('a', 'b')
    expect(h.file().sessionLineage).toEqual([{ fromId: 'a', toId: 'b', at: expect.any(Number) }])
    expect(h.writes() - before.writes).toBe(1)
    expect(h.emits()).toBe(before.emits)
  })

  it('rebindSession still moves sessionIds, originSessionId and report.sessionId', () => {
    const store = harness().open()
    const { task } = save(store, 'old')
    store.link(task.id, 'old')
    store.reportTask(task.id, {
      at: 9,
      sessionId: 'old',
      sessionName: 'n',
      outcome: 'open',
      evidence: 'seen'
    })
    store.rebindSession('old', 'new')
    expect(store.view().tasks[0]).toMatchObject({
      sessionIds: ['new'],
      originSessionId: 'new',
      report: { sessionId: 'new' },
      touchedBy: [{ sessionId: 'new', at: 5000 }]
    })
  })

  it('a throw in the new rebind steps is logged and the moves are kept', () => {
    const h = harness()
    const store = h.open()
    const { task } = save(store, 'old')
    store.link(task.id, 'old')
    h.breakClock()
    store.rebindSession('old', 'new')
    expect(store.view().tasks[0]?.sessionIds).toEqual(['new'])
    expect(h.lines).toEqual(['[claude-watcher][goals] code=goals_rebind_lineage_failed'])
    expect(h.file().sessionLineage).toEqual([])
  })

  it('a carry before the goal exists: tasks under the old and the new id share one goal (CUJ 3)', () => {
    const store = harness().open()
    store.carrySessionGoal('old', 'new')
    const first = save(store, 'old')
    const second = save(store, 'new')
    expect(second.task.goalId).toBe(first.task.goalId)
    expect(memoryGoals(store)).toEqual([{ name: 'Session old', memorySessionIds: ['old', 'new'] }])
  })

  it('carrySessionGoal to the same id writes nothing', () => {
    const h = harness()
    const store = h.open()
    const writes = h.writes()
    store.carrySessionGoal('a', 'a')
    expect(h.writes()).toBe(writes)
  })

  it('a planner keeps its goal through /clear and Reopen, and after a restart', () => {
    const h = harness()
    const store = h.open()
    const plan = operatorGoal(store, 'Plan')
    store.notePlanner('p1', plan)
    store.rebindSession('p1', 'p2')
    store.carrySessionGoal('p2', 'p3')
    store.notePlanner('p3', plan)
    for (const id of ['p1', 'p2', 'p3']) expect(save(store, id).task.goalId).toBe(plan)
    const restarted = h.open()
    expect(save(restarted, 'p1').task.goalId).toBe(plan)
    expect(memoryGoals(restarted)).toEqual([])
  })

  it('a worker whose Auth links were all closed makes a memory goal holding both ids; Auth is unchanged', () => {
    const store = harness().open()
    const auth = operatorGoal(store, 'Auth')
    const { saved } = store.saveTask({ workspaceId: 'w1', goalId: auth, title: 'Login' })
    store.link(saved.id, 'old')
    store.setTaskStatus(saved.id, 'done', 'operator')
    const authBefore = store.view().goals.find((g) => g.id === auth)
    store.carrySessionGoal('old', 'new')
    const out = save(store, 'new', { name: 'Worker' })
    expect(out.goalCreated).toBe(true)
    expect(memoryGoals(store)).toEqual([{ name: 'Worker', memorySessionIds: ['old', 'new'] }])
    expect(store.view().goals.find((g) => g.id === auth)).toEqual(authBefore)
  })

  it('a rebind to an id with its own memory goal: the oldest gets later tasks, the other keeps its tasks', () => {
    const store = harness().open()
    const a = save(store, 'a', { at: 100 })
    const b = save(store, 'b', { at: 200 })
    store.rebindSession('a', 'b')
    expect(save(store, 'b').task.goalId).toBe(a.task.goalId)
    expect(goalOf(store, b.task.id)).toBe(b.task.goalId)
    expect(store.view().goals).toHaveLength(2)
  })

  it('after the lineage entry is dropped by the cap, a /cleared planner id still finds its goal', () => {
    const h = harness()
    const store = h.open()
    const plan = operatorGoal(store, 'Plan')
    store.notePlanner('p1', plan)
    store.rebindSession('p1', 'p2')
    for (let i = 0; i < SESSION_LINEAGE_MAX; i++) store.carrySessionGoal(`x${i}`, `y${i}`)
    expect(h.file().sessionLineage.some((e) => e.fromId === 'p1')).toBe(false)
    expect(save(store, 'p2').task.goalId).toBe(plan)
  })

  it('a planner Reopen (carry, then note) leaves one planner entry for the new id', () => {
    const h = harness()
    const store = h.open()
    const plan = operatorGoal(store, 'Plan')
    store.notePlanner('p1', plan)
    store.carrySessionGoal('p1', 'p2')
    store.notePlanner('p2', plan)
    expect(h.file().plannerSessions.filter((p) => p.sessionId === 'p2')).toHaveLength(1)
  })

  it('a carry into an id whose newest record already names the goal adds no record', () => {
    const h = harness()
    const store = h.open()
    const plan = operatorGoal(store, 'Plan')
    store.notePlanner('p1', plan)
    store.notePlanner('p2', plan)
    store.carrySessionGoal('p1', 'p2')
    expect(h.file().plannerSessions.filter((p) => p.sessionId === 'p2')).toHaveLength(1)
  })

  it('a family with two planner entries copies the newer one', () => {
    const h = harness()
    const store = h.open()
    const older = operatorGoal(store, 'Older')
    const newer = operatorGoal(store, 'Newer')
    store.notePlanner('a', older)
    store.carrySessionGoal('a', 'b')
    store.notePlanner('b', newer)
    store.rebindSession('b', 'c')
    expect(h.file().plannerSessions.filter((p) => p.sessionId === 'c')).toEqual([
      expect.objectContaining({ goalId: newer })
    ])
    expect(save(store, 'a').task.goalId).toBe(newer)
  })

  it('a cycle (Reopen A→B, then /resume A from B) gives each id once', () => {
    const store = harness().open()
    store.carrySessionGoal('A', 'B')
    store.rebindSession('B', 'A')
    save(store, 'A')
    expect(memoryGoals(store)[0]?.memorySessionIds).toEqual(['A', 'B'])
  })

  it('a joining entry newer than an entry inside the family still brings it in', () => {
    const store = harness().open()
    store.carrySessionGoal('X', 'Y')
    store.carrySessionGoal('A', 'X')
    save(store, 'A')
    expect(memoryGoals(store)[0]?.memorySessionIds).toEqual(['X', 'Y', 'A'])
  })
  it('the family is ordered by when each id first appears, not by file order', () => {
    const h = harness()
    h.open()
    h.file().sessionLineage = [
      { fromId: 'A', toId: 'B', at: 20 },
      { fromId: 'X', toId: 'A', at: 10 }
    ]
    const store = h.open()
    save(store, 'A')
    expect(memoryGoals(store)[0]?.memorySessionIds).toEqual(['X', 'A', 'B'])
  })
})

describe('planner records', () => {
  it('notePlanner twice for the same goal appends once, and writes without an emit', () => {
    const h = harness()
    const store = h.open()
    const plan = operatorGoal(store, 'Plan')
    const emits = h.emits()
    store.notePlanner('p1', plan)
    const writes = h.writes()
    store.notePlanner('p1', plan)
    expect(h.writes()).toBe(writes)
    expect(h.emits()).toBe(emits)
    expect(h.file().plannerSessions).toEqual([
      { sessionId: 'p1', goalId: plan, at: expect.any(Number) }
    ])
  })
})

describe('caps', () => {
  function chain(store: GoalsStore, n: number): void {
    for (let i = 0; i < n; i++) store.carrySessionGoal(`s${i}`, `s${i + 1}`)
  }

  it(`a new goal starts with the last ${GOAL_MEMORY_SESSIONS_MAX} ids of the family, in order`, () => {
    const store = harness().open()
    chain(store, 59)
    save(store, 's59')
    const expected = Array.from({ length: GOAL_MEMORY_SESSIONS_MAX }, (_, i) => `s${i + 10}`)
    expect(memoryGoals(store)[0]?.memorySessionIds).toEqual(expected)
  })

  it(`a rebind and a carry keep the newest ${GOAL_MEMORY_SESSIONS_MAX} ids`, () => {
    const store = harness().open()
    chain(store, 49)
    save(store, 's49')
    expect(memoryGoals(store)[0]?.memorySessionIds).toHaveLength(GOAL_MEMORY_SESSIONS_MAX)
    store.rebindSession('s49', 'r')
    let ids = memoryGoals(store)[0]?.memorySessionIds ?? []
    expect([ids.length, ids[0], ids.at(-1)]).toEqual([GOAL_MEMORY_SESSIONS_MAX, 's1', 'r'])
    store.carrySessionGoal('r', 'c')
    ids = memoryGoals(store)[0]?.memorySessionIds ?? []
    expect([ids.length, ids[0], ids.at(-1)]).toEqual([GOAL_MEMORY_SESSIONS_MAX, 's2', 'c'])
  })

  it(`keeps the newest ${SESSION_LINEAGE_MAX} lineage entries and ${PLANNER_SESSIONS_MAX} planner records`, () => {
    const h = harness()
    const store = h.open()
    for (let i = 0; i < SESSION_LINEAGE_MAX + 3; i++) store.carrySessionGoal(`a${i}`, `b${i}`)
    for (let i = 0; i < PLANNER_SESSIONS_MAX + 3; i++) store.notePlanner(`p${i}`, 'g')
    const file = h.file()
    expect(file.sessionLineage).toHaveLength(SESSION_LINEAGE_MAX)
    expect(file.sessionLineage[0]?.fromId).toBe('a3')
    expect(file.plannerSessions).toHaveLength(PLANNER_SESSIONS_MAX)
    expect(file.plannerSessions[0]?.sessionId).toBe('p3')
  })
})

describe('the store across a restart and a workspace delete', () => {
  it('the lineage, the planner records, memorySessionIds and memoryRegroupedAt survive a re-created store', () => {
    const h = harness()
    const store = h.open()
    store.carrySessionGoal('a', 'b')
    store.notePlanner('p', 'g')
    save(store, 'b')
    store.applyMemoryRegroup([], 4242)
    const before = h.file()
    const restarted = h.open()
    expect(restarted.memoryRegroupedAt()).toBe(4242)
    expect(h.file()).toEqual(before)
    expect(h.file().sessionLineage).toHaveLength(1)
    expect(h.file().plannerSessions).toHaveLength(1)
    expect(memoryGoals(restarted)).toEqual([{ name: 'Session b', memorySessionIds: ['a', 'b'] }])
  })

  it('removeByWorkspace drops memory goals', () => {
    const store = harness().open()
    save(store, 's1', { workspaceId: 'w1' })
    save(store, 's1', { workspaceId: 'w2' })
    store.removeByWorkspace('w1')
    expect(store.view().goals.map((g) => g.workspaceId)).toEqual(['w2'])
  })
})

describe('applyMemoryRegroup', () => {
  function seed(store: GoalsStore): {
    open: string[]
    done: string
    byHand: string
    inAuth: string
  } {
    const make = (sessionId: string, goalId: string | null): string => {
      const { task } = save(store, sessionId)
      store.saveTask({ id: task.id, workspaceId: 'w1', goalId, title: task.title })
      return task.id
    }
    const auth = operatorGoal(store, 'Auth')
    const open = [make('S', null), make('S', null)]
    const done = make('S', null)
    store.setTaskStatus(done, 'done', 'operator')
    const inAuth = make('T', auth)
    const byHand = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'by hand' }).saved.id
    return { open, done, byHand, inAuth }
  }

  /** Clears every `touchedBy` and memory goal, as a file from before this change would hold them. */
  function asBeforeTheChange(h: Harness): GoalsStore {
    const file = h.file()
    const memoryIds = new Set(
      file.goals.filter((g) => g.memorySessionIds.length > 0).map((g) => g.id)
    )
    Object.assign(file, {
      goals: file.goals.filter((g) => !memoryIds.has(g.id)),
      tasks: file.tasks.map((t) => ({ ...t, touchedBy: [] }))
    })
    return h.open()
  }

  it('moves open Daily tasks, backfills touches, sets the marker, and does nothing the second time', () => {
    const h = harness()
    const ids = seed(h.open())
    const store = asBeforeTheChange(h)
    const emits = h.emits()
    const out = store.applyMemoryRegroup(
      [
        {
          sessionId: 'S',
          workspaceId: 'w1',
          sessionGoal: { name: 'Fix login', folder: '/proj' },
          createdAt: 3000,
          taskIds: [...ids.open, ids.done]
        }
      ],
      9999
    )
    expect(out).toEqual({ goalsCreated: 1, tasksMoved: 2, tasksTouched: 4 })
    expect(h.emits() - emits).toBe(1)
    const goal = store.view().goals.find((g) => g.memorySessionIds.length > 0)
    expect(goal).toMatchObject({ name: 'Fix login', createdAt: 3000, memorySessionIds: ['S'] })
    for (const id of ids.open) expect(goalOf(store, id)).toBe(goal?.id)
    expect(goalOf(store, ids.done)).toBeNull()
    expect(goalOf(store, ids.byHand)).toBeNull()
    const touched = store.view().tasks.find((t) => t.id === ids.inAuth)?.touchedBy
    expect(touched).toEqual([{ sessionId: 'T', at: 5000 }])
    expect(store.view().tasks.find((t) => t.id === ids.byHand)?.touchedBy).toEqual([])
    expect(store.memoryRegroupedAt()).toBe(9999)
    const writes = h.writes()
    expect(store.applyMemoryRegroup([], 10_000)).toEqual({
      goalsCreated: 0,
      tasksMoved: 0,
      tasksTouched: 0
    })
    expect(h.writes()).toBe(writes)
    expect(store.memoryRegroupedAt()).toBe(9999)
  })

  it('with nothing to do it still writes the marker, and does not emit', () => {
    const h = harness()
    const store = h.open()
    const emits = h.emits()
    const writes = h.writes()
    expect(store.memoryRegroupedAt()).toBeNull()
    store.applyMemoryRegroup([], 7)
    expect(h.writes() - writes).toBe(1)
    expect(h.emits()).toBe(emits)
    expect(h.file().memoryRegroupedAt).toBe(7)
  })
})

describe('backupBeforeRegroup', () => {
  it('calls the backupCopy option once and throws what it throws', () => {
    const h = harness()
    let calls = 0
    const store = h.open({
      backupCopy: () => {
        calls++
        if (calls > 1) throw new Error('copy failed')
        return true
      }
    })
    store.backupBeforeRegroup()
    expect(calls).toBe(1)
    expect(() => store.backupBeforeRegroup()).toThrow('copy failed')
  })

  it('has a default that copies nothing and does not throw', () => {
    expect(() => harness().open().backupBeforeRegroup()).not.toThrow()
  })
})
