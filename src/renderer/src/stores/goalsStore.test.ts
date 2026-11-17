import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type * as GoalsStoreModule from './goalsStore'
import type { Goal, GoalsView, Task } from '../../../shared/ipc/contract'

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  workspaceId: 'w1',
  name: 'Ship',
  defaultCwd: null,
  saveToFile: false,
  createdAt: 1,
  ...over
})
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  workspaceId: 'w1',
  goalId: 'g1',
  title: 'write',
  status: 'open',
  sessionIds: [],
  createdAt: 1,
  doneAt: null,
  doneBy: null,
  check: null,
  leftWith: null,
  lastSeenAt: null,
  report: null,
  originSessionId: null,
  folder: null,
  ...over
})
const view = (goals: Goal[], tasks: Task[]): GoalsView => ({
  goals,
  tasks,
  proposals: [],
  fileProblems: []
})

let push: (view: GoalsView) => void = () => {}
const bridge = {
  list: vi.fn(),
  saveGoal: vi.fn(),
  deleteGoal: vi.fn(),
  pickFolder: vi.fn(),
  setSaveToFile: vi.fn(),
  saveTask: vi.fn(),
  deleteTask: vi.fn(),
  setTaskStatus: vi.fn(),
  linkTask: vi.fn(),
  unlinkTask: vi.fn(),
  onChanged: vi.fn((cb: (v: GoalsView) => void) => {
    push = cb
    return () => {}
  })
}

let m: typeof GoalsStoreModule

beforeAll(async () => {
  ;(window as unknown as { goals: unknown }).goals = bridge
  m = await import('./goalsStore')
})
beforeEach(() => {
  m.goalsStore.setState({
    goals: [],
    tasks: [],
    fileProblems: [],
    loaded: false,
    loadFailed: false
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('goalsStore', () => {
  it('counts open tasks of the workspace, goal and loose, not done ones or other workspaces', () => {
    m.goalsStore
      .getState()
      .hydrate(
        view(
          [goal()],
          [
            task({ id: 'a', goalId: null }),
            task({ id: 'b', goalId: 'g1' }),
            task({ id: 'c', status: 'done' }),
            task({ id: 'd', workspaceId: 'w2' })
          ]
        )
      )
    expect(m.selectOpenTaskCount('w1')(m.goalsStore.getState())).toBe(2)
    expect(m.selectOpenTaskCount('w2')(m.goalsStore.getState())).toBe(1)
  })

  it('subscribes to the push once, at module load', () => {
    expect(bridge.onChanged).toHaveBeenCalledTimes(1)
  })

  it('load / save / remove round-trip through the bridge', async () => {
    bridge.list.mockResolvedValueOnce(view([goal()], [task()]))
    expect(await m.loadGoals()).toBe(true)
    expect(m.goalsStore.getState()).toMatchObject({ loaded: true, loadFailed: false })
    expect(m.goalsStore.getState().goals).toHaveLength(1)

    const second = goal({ id: 'g2', name: 'Two' })
    bridge.saveGoal.mockResolvedValueOnce({ saved: second, ...view([goal(), second], [task()]) })
    expect(await m.saveGoal({ workspaceId: 'w1', name: 'Two' })).toEqual(second)
    expect(m.goalsStore.getState().goals.map((g) => g.id)).toEqual(['g1', 'g2'])

    bridge.deleteGoal.mockResolvedValueOnce(view([second], []))
    await m.removeGoal('g1')
    expect(bridge.deleteGoal).toHaveBeenCalledWith('g1')
    expect(m.goalsStore.getState().tasks).toEqual([])

    const saved = task({ id: 't2' })
    bridge.saveTask.mockResolvedValueOnce({ saved, ...view([second], [saved]) })
    expect(await m.saveTask({ workspaceId: 'w1', goalId: 'g2', title: 'x' })).toEqual(saved)

    bridge.setTaskStatus.mockResolvedValueOnce(view([second], [task({ id: 't2', status: 'done' })]))
    await m.setTaskStatus('t2', 'done')
    expect(m.goalsStore.getState().tasks[0]?.status).toBe('done')

    bridge.linkTask.mockResolvedValueOnce(view([second], [task({ id: 't2', sessionIds: ['s1'] })]))
    await m.linkTask('t2', 's1')
    expect(m.selectTasksForSession('s1')(m.goalsStore.getState())).toHaveLength(1)
    bridge.unlinkTask.mockResolvedValueOnce(view([second], [task({ id: 't2' })]))
    await m.unlinkTask('t2', 's1')
    expect(m.selectTasksForSession('s1')(m.goalsStore.getState())).toEqual([])

    bridge.deleteTask.mockResolvedValueOnce(view([second], []))
    await m.removeTask('t2')
    bridge.pickFolder.mockResolvedValueOnce(view([goal({ id: 'g2', defaultCwd: '/srv' })], []))
    await m.pickGoalFolder('g2')
    expect(m.goalsStore.getState().goals[0]?.defaultCwd).toBe('/srv')
  })

  it('setGoalSaveToFile sends the switch and hydrates the file problems main answers', async () => {
    bridge.setSaveToFile.mockResolvedValueOnce({
      ...view([goal({ id: 'g2', saveToFile: true })], []),
      fileProblems: [{ goalId: 'g2', code: 'folder_missing' }]
    })
    await m.setGoalSaveToFile('g2', true)
    expect(bridge.setSaveToFile).toHaveBeenCalledWith('g2', true)
    expect(m.goalsStore.getState().goals[0]?.saveToFile).toBe(true)
    expect(m.selectFileProblemOf('g2')(m.goalsStore.getState())).toBe('folder_missing')
  })

  it('a rejected action rethrows and leaves the state as main last sent it', async () => {
    m.goalsStore.getState().hydrate(view([goal()], []))
    bridge.saveGoal.mockRejectedValueOnce(new Error('store_write_failed'))
    await expect(m.saveGoal({ workspaceId: 'w1', name: 'x' })).rejects.toThrow('store_write_failed')
    expect(m.goalsStore.getState().goals).toHaveLength(1)
  })

  it('a failed load is remembered, and any hydrate clears it', async () => {
    bridge.list.mockRejectedValueOnce(new Error('x'))
    expect(await m.loadGoals()).toBe(false)
    expect(m.selectGoalsLoadFailed(m.goalsStore.getState())).toBe(true)
    push(view([], []))
    expect(m.selectGoalsLoadFailed(m.goalsStore.getState())).toBe(false)
  })

  it('a goals:changed push replaces the state', () => {
    m.goalsStore.getState().hydrate(view([goal()], [task()]))
    push(view([goal({ id: 'g9' })], [task({ id: 't9', status: 'done' })]))
    const s = m.goalsStore.getState()
    expect(s.goals.map((g) => g.id)).toEqual(['g9'])
    expect(s.tasks.map((t) => t.id)).toEqual(['t9'])
  })

  it('progressOf counts done of all; 0 tasks gives 0/0', () => {
    expect(m.progressOf([])).toEqual({ done: 0, total: 0 })
    expect(
      m.progressOf([task(), task({ id: 't2', status: 'done' }), task({ id: 't3', status: 'done' })])
    ).toEqual({ done: 2, total: 3 })
  })

  it('selectors scope by workspace, goal and session', () => {
    m.goalsStore
      .getState()
      .hydrate(
        view(
          [goal(), goal({ id: 'g2', workspaceId: 'w2' })],
          [
            task({ sessionIds: ['s1'] }),
            task({ id: 't2', goalId: null }),
            task({ id: 't3', goalId: null, workspaceId: 'w2' })
          ]
        )
      )
    const s = m.goalsStore.getState()
    expect(
      m
        .selectGoalsIn('w1')(s)
        .map((g) => g.id)
    ).toEqual(['g1'])
    expect(
      m
        .selectTasksOfGoal('g1')(s)
        .map((t) => t.id)
    ).toEqual(['t1'])
    expect(
      m
        .selectLooseTasks('w1')(s)
        .map((t) => t.id)
    ).toEqual(['t2'])
    expect(
      m
        .selectTasksForSession('s1')(s)
        .map((t) => t.id)
    ).toEqual(['t1'])
  })
  describe('goalLineFor', () => {
    const line = (sessionId: string): ReturnType<typeof m.goalLineFor> =>
      m.goalLineFor(m.goalsStore.getState(), sessionId)

    it('is undefined when no task is linked', () => {
      m.goalsStore.setState({ goals: [goal()], tasks: [task()] })
      expect(line('s1')).toBeUndefined()
    })

    it('names the goal of the oldest linked task and counts the other goals', () => {
      m.goalsStore.setState({
        goals: [goal(), goal({ id: 'g2', name: 'Docs' })],
        tasks: [
          task({ id: 't2', goalId: 'g2', createdAt: 5, sessionIds: ['s1'] }),
          task({ id: 't1', goalId: 'g1', createdAt: 2, sessionIds: ['s1'] }),
          task({ id: 't3', goalId: 'g2', createdAt: 9, sessionIds: ['s1'] })
        ]
      })
      expect(line('s1')).toEqual({ name: 'Ship', extraGoals: 1, taskCount: 3 })
    })

    it('names a loose-only card with the Daily tasks term', () => {
      m.goalsStore.setState({
        goals: [goal()],
        tasks: [task({ goalId: null, sessionIds: ['s1'] })]
      })
      expect(line('s1')).toEqual({ name: 'Daily tasks', extraGoals: 0, taskCount: 1 })
    })

    it('counts every linked task, done ones too', () => {
      m.goalsStore.setState({
        goals: [goal()],
        tasks: [
          task({ id: 't1', status: 'done', sessionIds: ['s1'] }),
          task({ id: 't2', goalId: null, sessionIds: ['s1'] }),
          task({ id: 't3', sessionIds: ['s2'] })
        ]
      })
      expect(line('s1')).toEqual({ name: 'Ship', extraGoals: 0, taskCount: 2 })
    })
  })
})
