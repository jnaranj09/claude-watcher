import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore, GOAL_ERROR, type GoalsBlobStore } from './goals'
import {
  GOAL_FOLDER_MISSING,
  type GoalsFile,
  type GoalsView,
  type TaskReport
} from '../../shared/schemas/goal'
import type { GoalsSnapshot } from '../goals/goalsFile'

function fakeBlob(seed: unknown): {
  blobStore: GoalsBlobStore
  backups: () => number
  current: () => GoalsFile
} {
  let blob: unknown = seed
  let backups = 0
  const blobStore: GoalsBlobStore = {
    read: () => blob,
    write: (value: GoalsFile) => {
      blob = value
    },
    backup: () => {
      backups++
    }
  }
  return { blobStore, backups: () => backups, current: () => blob as GoalsFile }
}

function make(seed: unknown = undefined): {
  store: ReturnType<typeof createGoalsStore>
  fake: ReturnType<typeof fakeBlob>
  log: ReturnType<typeof vi.fn>
  fired: GoalsView[]
} {
  const fake = fakeBlob(seed)
  const log = vi.fn()
  let n = 0
  let clock = 1000
  const store = createGoalsStore({
    blobStore: fake.blobStore,
    log,
    newId: () => `id${++n}`,
    now: () => ++clock
  })
  const fired: GoalsView[] = []
  store.onChange((view) => fired.push(view))
  return { store, fake, log, fired }
}

describe('createGoalsStore', () => {
  it('fresh install: empty, writes the empty v1 file, logs nothing', () => {
    const { store, fake, log } = make()
    expect(store.view()).toEqual({ goals: [], tasks: [], proposals: [], fileProblems: [] })
    expect(fake.current()).toEqual({ version: 1, goals: [], tasks: [] })
    expect(log).not.toHaveBeenCalled()
  })

  it('saveGoal creates, then renames without touching the folder', () => {
    const { store } = make()
    const { saved } = store.saveGoal({ workspaceId: 'w1', name: 'Ship' }, '/work')
    expect(saved).toMatchObject({ id: 'id1', name: 'Ship', defaultCwd: '/work', saveToFile: false })
    store.setGoalFolder('id1', '/srv/app')
    store.saveGoal({ id: 'id1', workspaceId: 'w1', name: 'Ship it' })
    expect(store.view().goals[0]).toMatchObject({ name: 'Ship it', defaultCwd: '/srv/app' })
    expect(() => store.saveGoal({ id: 'gone', workspaceId: 'w1', name: 'x' })).toThrow(
      GOAL_ERROR.goalNotFound
    )
  })

  it('saveGoal cannot re-parent a goal to another workspace', () => {
    const { store } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.saveTask({ workspaceId: 'w1', goalId: 'id1', title: 't' })
    expect(() => store.saveGoal({ id: 'id1', workspaceId: 'w2', name: 'A' })).toThrow(
      GOAL_ERROR.workspaceMismatch
    )
    expect(store.view().goals[0]?.workspaceId).toBe('w1')
  })

  it('removeGoal deletes its tasks', () => {
    const { store } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.saveGoal({ workspaceId: 'w1', name: 'B' }, '/work')
    store.saveTask({ workspaceId: 'w1', goalId: 'id1', title: 'in A' })
    store.saveTask({ workspaceId: 'w1', goalId: 'id2', title: 'in B' })
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'loose' })
    store.removeGoal('id1')
    const view = store.view()
    expect(view.goals.map((g) => g.name)).toEqual(['B'])
    expect(view.tasks.map((t) => t.title)).toEqual(['in B', 'loose'])
  })

  it('saveTask with a goal of another workspace throws goal_workspace_mismatch', () => {
    const { store } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    expect(() => store.saveTask({ workspaceId: 'w2', goalId: 'id1', title: 't' })).toThrow(
      GOAL_ERROR.workspaceMismatch
    )
    expect(() => store.saveTask({ workspaceId: 'w1', goalId: 'nope', title: 't' })).toThrow(
      GOAL_ERROR.goalNotFound
    )
    expect(store.view().tasks).toEqual([])
  })

  it('saveTask on an existing task keeps its status and links', () => {
    const { store } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'old' })
    store.link('id1', 's1')
    store.setTaskStatus('id1', 'done', 'operator')
    store.saveTask({ id: 'id1', workspaceId: 'w1', goalId: null, title: 'new' })
    expect(store.view().tasks[0]).toMatchObject({
      title: 'new',
      status: 'done',
      sessionIds: ['s1']
    })
    expect(() =>
      store.saveTask({ id: 'zzz', workspaceId: 'w1', goalId: null, title: 'x' })
    ).toThrow(GOAL_ERROR.taskNotFound)
    expect(() =>
      store.saveTask({ id: 'id1', workspaceId: 'w2', goalId: null, title: 'x' })
    ).toThrow(GOAL_ERROR.workspaceMismatch)
  })

  it("addTaskFromSession adds a new open task, checks the goal's workspace, and a refused write keeps it and reports", () => {
    const fake = fakeBlob(undefined)
    const report = vi.fn()
    let n = 0
    const store = createGoalsStore({
      blobStore: fake.blobStore,
      log: () => {},
      report,
      newId: () => `id${++n}`,
      now: () => 7
    })
    const goalId = store.saveGoal({ workspaceId: 'w1', name: 'G' }, '/work').saved.id
    expect(() =>
      store.addTaskFromSession({ workspaceId: 'w2', goalId, title: 'elsewhere' })
    ).toThrow(GOAL_ERROR.workspaceMismatch)
    expect(() =>
      store.addTaskFromSession({ workspaceId: 'w1', goalId: 'gone', title: 'x' })
    ).toThrow(GOAL_ERROR.goalNotFound)
    fake.blobStore.write = () => {
      throw new Error('disk full')
    }
    const fired: GoalsView[] = []
    store.onChange((v) => fired.push(v))
    const saved = store.addTaskFromSession({ id: 'id1', workspaceId: 'w1', goalId, title: 'New' })
    expect(saved).toMatchObject({ id: 'id2', goalId, title: 'New', status: 'open', sessionIds: [] })
    expect(store.view().tasks).toEqual([saved])
    expect(fired).toHaveLength(1)
    expect(report).toHaveBeenCalledWith('write_failed')
  })

  it('setTaskStatus done stamps doneAt and doneBy', () => {
    const { store } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 't' })
    store.setTaskStatus('id1', 'done', 'session')
    const task = store.view().tasks[0]
    expect(task).toMatchObject({ status: 'done', doneBy: 'session' })
    expect(typeof task?.doneAt).toBe('number')
  })

  it('setTaskStatus done on a done task changes nothing and does not fire onChange', () => {
    const { store, fired } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 't' })
    store.setTaskStatus('id1', 'done', 'operator')
    const before = store.view().tasks[0]
    const count = fired.length
    store.setTaskStatus('id1', 'done', 'session')
    expect(store.view().tasks[0]).toEqual(before)
    expect(fired).toHaveLength(count)
  })

  it('reopen clears doneAt and doneBy', () => {
    const { store } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 't' })
    store.setTaskStatus('id1', 'done', 'operator')
    store.setTaskStatus('id1', 'open', 'operator')
    expect(store.view().tasks[0]).toMatchObject({ status: 'open', doneAt: null, doneBy: null })
    expect(() => store.setTaskStatus('nope', 'done', 'operator')).toThrow(GOAL_ERROR.taskNotFound)
  })

  it('link is idempotent, unlink removes, and an unknown task throws', () => {
    const { store, fired } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 't' })
    store.link('id1', 's1')
    const count = fired.length
    store.link('id1', 's1')
    expect(store.view().tasks[0]?.sessionIds).toEqual(['s1'])
    expect(fired).toHaveLength(count)
    store.unlink('id1', 's1')
    expect(store.view().tasks[0]?.sessionIds).toEqual([])
    expect(() => store.link('nope', 's1')).toThrow(GOAL_ERROR.taskNotFound)
  })

  it('linkMany links the known tasks and skips an unknown id', () => {
    const { store } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'a' })
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'b' })
    store.linkMany(['id1', 'gone', 'id2'], 's1')
    expect(store.tasksForSession('s1').map((t) => t.title)).toEqual(['a', 'b'])
  })

  it('rebindSession moves every link', () => {
    const { store, fake } = make()
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'a' })
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'b' })
    store.link('id1', 'old')
    store.link('id2', 'old')
    store.link('id2', 'other')
    store.rebindSession('old', 'new')
    expect(store.tasksForSession('old')).toEqual([])
    expect(store.tasksForSession('new').map((t) => t.id)).toEqual(['id1', 'id2'])
    expect(store.view().tasks[1]?.sessionIds).toEqual(['new', 'other'])
    expect(fake.current().tasks[0]?.sessionIds).toEqual(['new'])
  })

  it('setGoalFolder changes the folder; an unknown goal throws', () => {
    const { store } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.setGoalFolder('id1', '/srv')
    expect(store.view().goals[0]?.defaultCwd).toBe('/srv')
    expect(() => store.setGoalFolder('nope', '/x')).toThrow(GOAL_ERROR.goalNotFound)
  })

  it('create without a folder throws goal_folder_missing and stores nothing', () => {
    const { store, fired } = make()
    expect(() => store.saveGoal({ workspaceId: 'w1', name: 'A' })).toThrow(GOAL_FOLDER_MISSING)
    expect(store.view().goals).toEqual([])
    expect(fired).toEqual([])
  })

  it('rename keeps the folder and saveToFile', () => {
    const { store } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.setSaveToFile('id1', true)
    store.saveGoal({ id: 'id1', workspaceId: 'w1', name: 'B' })
    expect(store.view().goals[0]).toMatchObject({
      name: 'B',
      defaultCwd: '/work',
      saveToFile: true
    })
  })

  it('setSaveToFile turns it on and off; the same value fires nothing', () => {
    const { store, fired } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.setSaveToFile('id1', true)
    expect(store.view().goals[0]?.saveToFile).toBe(true)
    const count = fired.length
    store.setSaveToFile('id1', true)
    expect(fired).toHaveLength(count)
    store.setSaveToFile('id1', false)
    expect(store.view().goals[0]?.saveToFile).toBe(false)
    expect(() => store.setSaveToFile('nope', true)).toThrow(GOAL_ERROR.goalNotFound)
  })

  it('setSaveToFile on a goal with no folder throws goal_folder_missing', () => {
    const legacy = {
      version: 1,
      goals: [{ id: 'g1', workspaceId: 'w1', name: 'Old', createdAt: 1 }],
      tasks: []
    }
    const { store } = make(legacy)
    expect(() => store.setSaveToFile('g1', true)).toThrow(GOAL_FOLDER_MISSING)
    expect(store.view().goals[0]?.saveToFile).toBe(false)
  })

  it('afterChange gets before and after for every emitted change', () => {
    const calls: [GoalsSnapshot, GoalsSnapshot][] = []
    let n = 0
    const store = createGoalsStore({
      newId: () => `id${++n}`,
      afterChange: (before, after) => calls.push([before, after])
    })
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.saveTask({ workspaceId: 'w1', goalId: 'id1', title: 'a' })
    store.linkMany(['id2'], 's1')
    store.removeByWorkspace('w1')
    expect(calls).toHaveLength(4)
    expect(calls[0]?.[0].goals).toEqual([])
    expect(calls[1]?.[0].tasks).toEqual([])
    expect(calls[1]?.[1].tasks).toHaveLength(1)
    expect(calls[2]?.[1].tasks[0]?.sessionIds).toEqual(['s1'])
    expect(calls[3]?.[0].goals).toHaveLength(1)
    expect(calls[3]?.[1].goals).toEqual([])
  })

  it('listeners hear the view with the file problems the change made', () => {
    let problem = false
    const store = createGoalsStore({
      newId: () => 'g1',
      afterChange: () => {
        problem = true
      },
      fileProblems: () => (problem ? [{ goalId: 'g1', code: 'folder_missing' as const }] : [])
    })
    const heard: GoalsView[] = []
    store.onChange((v) => heard.push(v))
    const result = store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    expect(heard[0]?.fileProblems).toEqual([{ goalId: 'g1', code: 'folder_missing' }])
    expect(result.fileProblems).toEqual([{ goalId: 'g1', code: 'folder_missing' }])
  })

  it('a throwing afterChange never undoes the change', () => {
    const log = vi.fn()
    const store = createGoalsStore({
      log,
      afterChange: () => {
        throw new Error('boom')
      }
    })
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    expect(store.view().goals).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][goals] code=goals_file_sync_failed')
  })

  it('removeByWorkspace deletes goals and tasks of that workspace only and persists', () => {
    const { store, fake, fired } = make()
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    store.saveGoal({ workspaceId: 'w2', name: 'B' }, '/work')
    store.saveTask({ workspaceId: 'w1', goalId: 'id1', title: 'a' })
    store.saveTask({ workspaceId: 'w1', goalId: null, title: 'loose' })
    store.saveTask({ workspaceId: 'w2', goalId: 'id2', title: 'b' })
    const count = fired.length
    expect(store.removeByWorkspace('w1')).toBe(3)
    expect(store.view().goals.map((g) => g.name)).toEqual(['B'])
    expect(store.view().tasks.map((t) => t.title)).toEqual(['b'])
    expect(fake.current().goals).toHaveLength(1)
    expect(fake.current().tasks).toHaveLength(1)
    expect(fired).toHaveLength(count + 1)
    expect(store.removeByWorkspace('w9')).toBe(0)
    expect(fired).toHaveLength(count + 1)
  })

  it('onChange fires after each mutation with the new view, and unsubscribes', () => {
    const { store, fired } = make()
    const extra = vi.fn()
    const off = store.onChange(extra)
    store.saveGoal({ workspaceId: 'w1', name: 'A' }, '/work')
    expect(fired.at(-1)?.goals).toHaveLength(1)
    expect(extra).toHaveBeenCalledTimes(1)
    off()
    store.saveGoal({ workspaceId: 'w1', name: 'B' }, '/work')
    expect(extra).toHaveBeenCalledTimes(1)
  })

  it('the view carries the injected proposals', () => {
    const proposal = { plannerSessionId: 'p', goalId: 'g', groups: [{ taskIds: ['t'], note: '' }] }
    const store = createGoalsStore({ proposals: () => [proposal] })
    expect(store.view().proposals).toEqual([proposal])
  })

  it('corrupt file: backup + empty + code, and the log never carries a value', () => {
    const { store, fake, log } = make({
      version: 1,
      goals: [{ id: 'x', workspaceId: 'w1', name: 'SECRET-NAME' }],
      tasks: [{ id: 't', workspaceId: 'w1', title: 'SECRET-TITLE', status: 'maybe' }]
    })
    expect(store.view().goals).toEqual([])
    expect(fake.backups()).toBe(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[claude-watcher][goals] code=goals_corrupt_reset_to_defaults')
    for (const line of lines) expect(line).not.toContain('SECRET')
  })
})

describe('tasks from memory extraction', () => {
  const CHECK = 'grep -n sandbox config/app.yml'

  function extracted(): {
    store: ReturnType<typeof createGoalsStore>
    id: string
    taskOf: (id: string) => unknown
  } {
    const { store } = make()
    const t = store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: null,
      title: 'Set sandbox: true',
      check: CHECK,
      leftWith: 'operator',
      originSessionId: 's1',
      folder: '/work/acme/shop',
      at: 5
    })
    const taskOf = (id: string): unknown => store.view().tasks.find((x) => x.id === id)
    return { store, id: t.id, taskOf }
  }

  function report(outcome: TaskReport['outcome'], at = 20): TaskReport {
    return {
      at,
      sessionId: 's1',
      sessionName: 'fix api port',
      outcome,
      evidence: 'line 4 says true'
    }
  }

  it('adds an extracted task to Daily tasks when its goal is gone, with no session link', () => {
    const { store } = make()
    const t = store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: 'gone',
      title: 'Set sandbox: true',
      check: CHECK,
      leftWith: 'operator',
      originSessionId: 's1',
      folder: '/work/acme/shop',
      at: 5
    })
    expect(t).toMatchObject({
      goalId: null,
      status: 'open',
      sessionIds: [],
      lastSeenAt: 5,
      originSessionId: 's1'
    })
    expect(store.view().tasks).toEqual([t])
  })

  it("an extracted task whose goal sits in another workspace goes to the workspace's Daily tasks", () => {
    const { store } = make()
    const goalId = store.saveGoal({ workspaceId: 'w2', name: 'G' }, '/work').saved.id
    const t = store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId,
      title: 'x',
      check: null,
      leftWith: 'session',
      originSessionId: 's1',
      folder: null,
      at: 5
    })
    expect(t.goalId).toBeNull()
  })

  it('an extracted task keeps a goal of its own workspace', () => {
    const { store } = make()
    const goalId = store.saveGoal({ workspaceId: 'w1', name: 'G' }, '/work').saved.id
    const t = store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId,
      title: 'x',
      check: null,
      leftWith: 'session',
      originSessionId: 's1',
      folder: null,
      at: 5
    })
    expect(t.goalId).toBe(goalId)
  })

  it('an extracted task with a check the schema refuses throws and adds nothing', () => {
    const { store } = make()
    expect(() =>
      store.addTaskFromExtraction({
        workspaceId: 'w1',
        goalId: null,
        title: 'x',
        check: 'one\ntwo',
        leftWith: 'session',
        originSessionId: 's1',
        folder: null,
        at: 5
      })
    ).toThrow()
    expect(store.view().tasks).toEqual([])
  })

  it('an extracted task with a refused write keeps it and reports the disk', () => {
    const fake = fakeBlob(undefined)
    const report = vi.fn()
    const store = createGoalsStore({ blobStore: fake.blobStore, log: () => {}, report })
    fake.blobStore.write = () => {
      throw new Error('disk full')
    }
    store.addTaskFromExtraction({
      workspaceId: 'w1',
      goalId: null,
      title: 'x',
      check: null,
      leftWith: 'session',
      originSessionId: 's1',
      folder: null,
      at: 5
    })
    expect(store.view().tasks).toHaveLength(1)
    expect(report).toHaveBeenCalledWith('write_failed')
  })

  it('an extraction update never closes a task and keeps its check when none is given', () => {
    const { store, id, taskOf } = extracted()
    expect(
      store.updateTaskFromExtraction(id, { check: null, leftWith: 'session', at: 9, seen: true })
    ).toBe(true)
    expect(taskOf(id)).toMatchObject({
      status: 'open',
      check: CHECK,
      leftWith: 'session',
      lastSeenAt: 9
    })
  })

  it('an extraction update that is no sighting keeps the last-seen date (R48)', () => {
    const { store, id, taskOf } = extracted()
    store.updateTaskFromExtraction(id, { check: null, leftWith: 'session', at: 9, seen: false })
    expect(taskOf(id)).toMatchObject({ leftWith: 'session', lastSeenAt: 5 })
  })

  it('an extraction update with a check replaces the check but never the title', () => {
    const { store, id, taskOf } = extracted()
    store.updateTaskFromExtraction(id, {
      check: 'npm test',
      leftWith: 'operator',
      at: 9,
      seen: true
    })
    expect(taskOf(id)).toMatchObject({ title: 'Set sandbox: true', check: 'npm test' })
  })

  it('an extraction update of a done task changes nothing', () => {
    const { store, id, taskOf } = extracted()
    store.setTaskStatus(id, 'done', 'operator')
    const before = taskOf(id)
    expect(
      store.updateTaskFromExtraction(id, {
        check: 'npm test',
        leftWith: 'session',
        at: 9,
        seen: true
      })
    ).toBe(false)
    expect(taskOf(id)).toEqual(before)
    expect(
      store.updateTaskFromExtraction('gone', {
        check: null,
        leftWith: 'session',
        at: 9,
        seen: true
      })
    ).toBe(false)
  })

  it('a done report flags an open task and leaves it open', () => {
    const { store, id, taskOf } = extracted()
    expect(store.reportTask(id, report('done'))).toBe('ok')
    expect(taskOf(id)).toMatchObject({
      status: 'open',
      lastSeenAt: 5,
      report: { outcome: 'done', sessionName: 'fix api port' }
    })
  })

  it('an open report refreshes lastSeenAt', () => {
    const { store, id, taskOf } = extracted()
    expect(store.reportTask(id, report('open', 33))).toBe('ok')
    expect(taskOf(id)).toMatchObject({
      status: 'open',
      lastSeenAt: 33,
      report: { outcome: 'open' }
    })
  })

  it('a report on a done task answers ok and changes nothing', () => {
    const { store, id, taskOf } = extracted()
    store.setTaskStatus(id, 'done', 'operator')
    const before = taskOf(id)
    expect(store.reportTask(id, report('open', 33))).toBe('ok')
    expect(taskOf(id)).toEqual(before)
  })

  it('an extraction update with a check the schema refuses throws and changes nothing', () => {
    const { store, id } = extracted()
    const before = store.view().tasks
    expect(() =>
      store.updateTaskFromExtraction(id, {
        check: 'one\ntwo',
        leftWith: 'session',
        at: 9,
        seen: true
      })
    ).toThrow()
    expect(store.view().tasks).toEqual(before)
  })

  it('a report the schema refuses throws and changes nothing', () => {
    const { store, id, taskOf } = extracted()
    const before = store.view().tasks
    expect(() => store.reportTask(id, { ...report('done'), evidence: 'a\tb' })).toThrow()
    expect(store.view().tasks).toEqual(before)
    expect(taskOf(id)).toMatchObject({ report: null })
  })

  it('a report on an unknown task answers not_found', () => {
    const { store } = extracted()
    expect(store.reportTask('gone', report('done'))).toBe('not_found')
  })

  it('/clear moves the origin and the reporting session of a task', () => {
    const { store, id, taskOf } = extracted()
    store.reportTask(id, report('done'))
    store.rebindSession('s1', 's2')
    expect(taskOf(id)).toMatchObject({ originSessionId: 's2', report: { sessionId: 's2' } })
  })

  it("the operator's title edit keeps the check and the report", () => {
    const { store, id, taskOf } = extracted()
    store.reportTask(id, report('done'))
    store.saveTask({ id, workspaceId: 'w1', goalId: null, title: 'Sandbox on' })
    expect(taskOf(id)).toMatchObject({
      title: 'Sandbox on',
      check: CHECK,
      leftWith: 'operator',
      lastSeenAt: 5,
      originSessionId: 's1',
      folder: '/work/acme/shop',
      report: { outcome: 'done' }
    })
  })

  it('a task the operator adds has none of the six fields', () => {
    const { store } = make()
    const { saved } = store.saveTask({ workspaceId: 'w1', goalId: null, title: 't' })
    expect(saved).toMatchObject({
      check: null,
      leftWith: null,
      lastSeenAt: null,
      report: null,
      originSessionId: null,
      folder: null
    })
  })
})
