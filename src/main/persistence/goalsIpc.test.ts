import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore } from './goals'
import { createGoalsIpcHandlers, goalPickerStart } from './goalsIpc'

function setup(pick: () => Promise<string | null> = () => Promise.resolve('/picked')): {
  h: ReturnType<typeof createGoalsIpcHandlers>
  pickDirectory: ReturnType<typeof vi.fn>
} {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
  const pickDirectory = vi.fn(pick)
  return { h: createGoalsIpcHandlers(store, { pickDirectory }), pickDirectory }
}

const GOAL = { workspaceId: 'w1', name: '  Ship  ' }
const TASK = { workspaceId: 'w1', goalId: null, title: 'write' }

describe('goals IPC handler logic', () => {
  it('save / status / link / unlink / delete go through, saveGoal trims the name', () => {
    const { h } = setup()
    expect(h.list()).toEqual({ goals: [], tasks: [], proposals: [] })
    expect(h.saveGoal(GOAL).saved.name).toBe('Ship')
    expect(h.saveTask({ ...TASK, goalId: 'id1' }).saved.id).toBe('id2')
    expect(h.setTaskStatus({ id: 'id2', status: 'done' }).tasks[0]).toMatchObject({
      status: 'done',
      doneBy: 'operator'
    })
    expect(h.linkTask({ taskId: 'id2', sessionId: 's1' }).tasks[0]?.sessionIds).toEqual(['s1'])
    expect(h.unlinkTask({ taskId: 'id2', sessionId: 's1' }).tasks[0]?.sessionIds).toEqual([])
    expect(h.deleteTask({ id: 'id2' }).tasks).toEqual([])
    expect(h.deleteGoal({ id: 'id1' }).goals).toEqual([])
  })

  it('a MALFORMED arg throws and does NOT mutate', async () => {
    const { h, pickDirectory } = setup()
    h.saveGoal(GOAL)
    h.saveTask(TASK)
    expect(() => h.saveGoal({ ...GOAL, name: '' })).toThrow()
    expect(() => h.saveGoal({ ...GOAL, defaultCwd: '/etc' })).toThrow()
    expect(() => h.deleteGoal({ id: '' })).toThrow()
    await expect(h.pickFolder({ goalId: '' })).rejects.toThrow()
    await expect(h.pickFolder({ goalId: 'id1', cwd: '/etc' })).rejects.toThrow()
    expect(() => h.clearFolder({})).toThrow()
    expect(() => h.saveTask({ ...TASK, title: 'a\nb' })).toThrow()
    expect(() => h.deleteTask(null)).toThrow()
    expect(() => h.setTaskStatus({ id: 'id2', status: 'in-progress' })).toThrow()
    expect(() => h.linkTask({ taskId: 'id2' })).toThrow()
    expect(() => h.unlinkTask('id2')).toThrow()
    expect(pickDirectory).not.toHaveBeenCalled()
    const view = h.list()
    expect(view.goals).toHaveLength(1)
    expect(view.goals[0]?.name).toBe('Ship')
    expect(view.tasks).toHaveLength(1)
    expect(view.tasks[0]).toMatchObject({ title: 'write', status: 'open', sessionIds: [] })
  })

  it('goals:pick-folder stores the picked path; cancel changes nothing', async () => {
    const picks: (string | null)[] = ['/picked', null]
    const { h, pickDirectory } = setup(() => Promise.resolve(picks.shift() ?? null))
    h.saveGoal(GOAL)
    expect((await h.pickFolder({ goalId: 'id1' })).goals[0]?.defaultCwd).toBe('/picked')
    expect((await h.pickFolder({ goalId: 'id1' })).goals[0]?.defaultCwd).toBe('/picked')
    expect(pickDirectory).toHaveBeenCalledTimes(2)
    expect(pickDirectory.mock.calls[0]?.[0]).toMatchObject({ id: 'id1' })
    expect(h.clearFolder({ goalId: 'id1' }).goals[0]?.defaultCwd).toBeNull()
  })

  it('pick-folder on an unknown goal throws goal_not_found without opening the picker', async () => {
    const { h, pickDirectory } = setup()
    await expect(h.pickFolder({ goalId: 'nope' })).rejects.toThrow('goal_not_found')
    expect(pickDirectory).not.toHaveBeenCalled()
  })
})

describe('goalPickerStart', () => {
  const goal = { id: 'g', workspaceId: 'w1', name: 'x', defaultCwd: null, createdAt: 1 }
  it('opens at the goal folder, else the workspace folder, else the OS default', () => {
    expect(goalPickerStart({ ...goal, defaultCwd: '/goal' }, '/ws')).toBe('/goal')
    expect(goalPickerStart(goal, '/ws')).toBe('/ws')
    expect(goalPickerStart(goal, null)).toBeNull()
  })
})
