import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore } from './goals'
import { createGoalsIpcHandlers, goalPickerStart } from './goalsIpc'
import { createProposals, type Proposals } from '../goals/proposals'
import type { LaunchRequest } from '../pty/launchSession'

type LaunchAnswer = { terminalId: string; workspaceId: string }

function setup(pick: () => Promise<string | null> = () => Promise.resolve('/picked')): {
  h: ReturnType<typeof createGoalsIpcHandlers>
  pickDirectory: ReturnType<typeof vi.fn>
} {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
  const pickDirectory = vi.fn(pick)
  return {
    h: createGoalsIpcHandlers(store, {
      pickDirectory,
      proposals: createProposals(() => {}),
      hookListening: () => true,
      launch: {
        workspaces: { get: () => null },
        pickDirectory: () => Promise.resolve('/picked'),
        isDirectory: () => true,
        claudeVersionAllowsLaunch: () => true,
        log: () => {}
      }
    }),
    pickDirectory
  }
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

  it('start parses the request: an unknown key or an empty group launches nothing', async () => {
    const { h } = setup()
    h.saveTask(TASK)
    const requestLaunch = vi.fn(() => ({ terminalId: 'term-1', workspaceId: 'w1' }))
    const ok = { workspaceId: 'w1', goalId: null, groups: [{ taskIds: ['id1'] }], markDone: true }
    await expect(h.start({ ...ok, cwd: '/evil' }, requestLaunch)).rejects.toThrow()
    await expect(h.start({ ...ok, groups: [{ taskIds: [] }] }, requestLaunch)).rejects.toThrow()
    expect(requestLaunch).not.toHaveBeenCalled()
    await expect(h.start(ok, requestLaunch)).resolves.toEqual({ terminalIds: ['term-1'] })
    expect(requestLaunch).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/picked' }))
  })
})

describe('goals IPC — plan with Claude and the proposal', () => {
  function planSetup(over: { hookListening?: () => boolean } = {}): {
    h: ReturnType<typeof createGoalsIpcHandlers>
    proposals: Proposals
    goalId: string
    t1: string
    t2: string
    t3: string
    requestLaunch: ReturnType<typeof vi.fn<(req: LaunchRequest) => LaunchAnswer>>
    launched: LaunchRequest[]
  } {
    let n = 0
    const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
    const proposals = createProposals(() => {})
    const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship v2' }).saved.id
    store.setGoalFolder(goalId, '/goal')
    const t1 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Write the spec' }).saved.id
    const t2 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Cut the release' }).saved.id
    const t3 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Tell the team' }).saved.id
    const launched: LaunchRequest[] = []
    let term = 0
    const requestLaunch = vi.fn((req: LaunchRequest): LaunchAnswer => {
      launched.push(req)
      return { terminalId: `term-${++term}`, workspaceId: 'w1' }
    })
    const h = createGoalsIpcHandlers(store, {
      pickDirectory: () => Promise.resolve(null),
      proposals,
      hookListening: over.hookListening ?? (() => true),
      launch: {
        workspaces: { get: () => null },
        pickDirectory: () => Promise.resolve('/picked'),
        isDirectory: () => true,
        claudeVersionAllowsLaunch: () => true,
        log: () => {}
      }
    })
    return { h, proposals, goalId, t1, t2, t3, requestLaunch, launched }
  }

  it('plan launches one planner session on the goal, named after it, in its folder', async () => {
    const { h, goalId, requestLaunch, launched } = planSetup()
    await expect(h.plan({ goalId }, requestLaunch)).resolves.toEqual({ terminalIds: ['term-1'] })
    expect(launched).toEqual([
      {
        cwd: '/goal',
        name: 'Ship v2',
        workspaceId: 'w1',
        goalLaunch: { kind: 'planner', goalId }
      }
    ])
  })

  it('plan refuses with hooks_unavailable when the hook port is not ours, and launches nothing', async () => {
    const { h, goalId, requestLaunch } = planSetup({ hookListening: () => false })
    await expect(h.plan({ goalId }, requestLaunch)).rejects.toThrow('hooks_unavailable')
    expect(requestLaunch).not.toHaveBeenCalled()
  })

  it('plan parses the request and refuses an unknown goal', async () => {
    const { h, goalId, requestLaunch } = planSetup()
    await expect(h.plan({ goalId, cwd: '/evil' }, requestLaunch)).rejects.toThrow()
    await expect(h.plan({ goalId: 'nope' }, requestLaunch)).rejects.toThrow('goal_not_found')
    expect(requestLaunch).not.toHaveBeenCalled()
  })

  it('accept starts one session per edited group and clears the proposal', async () => {
    const { h, proposals, goalId, t1, t2, t3, requestLaunch, launched } = planSetup()
    proposals.set({
      plannerSessionId: 'planner-1',
      goalId,
      groups: [
        { taskIds: [t1, t2], note: 'a' },
        { taskIds: [t3], note: 'b' }
      ]
    })
    const result = await h.decideProposal(
      {
        plannerSessionId: 'planner-1',
        decision: 'accept',
        groups: [{ taskIds: [t1] }, { taskIds: [t2, t3] }],
        markDone: false
      },
      requestLaunch
    )
    expect(result.terminalIds).toEqual(['term-1', 'term-2'])
    expect(result.proposals).toEqual([])
    expect(proposals.list()).toEqual([])
    expect(launched.map((l) => l.goalLaunch)).toEqual([
      { kind: 'worker', taskIds: [t1], markDone: false },
      { kind: 'worker', taskIds: [t2, t3], markDone: false }
    ])
    expect(launched.map((l) => l.cwd)).toEqual(['/goal', '/goal'])
  })

  it('accept starts exactly the groups it was sent, as given', async () => {
    const { h, proposals, goalId, t1, t3, requestLaunch, launched } = planSetup()
    proposals.set({
      plannerSessionId: 'planner-1',
      goalId,
      groups: [
        { taskIds: [t1], note: '' },
        { taskIds: [t3], note: '' }
      ]
    })
    await h.decideProposal(
      {
        plannerSessionId: 'planner-1',
        decision: 'accept',
        groups: [{ taskIds: [t1] }, { taskIds: [t3] }],
        markDone: true
      },
      requestLaunch
    )
    expect(launched.map((l) => l.goalLaunch)).toEqual([
      { kind: 'worker', taskIds: [t1], markDone: true },
      { kind: 'worker', taskIds: [t3], markDone: true }
    ])
  })

  it('accept clears only the proposal it started: a newer one that landed meanwhile stays', async () => {
    const { h, proposals, goalId, t1, t2, requestLaunch } = planSetup()
    proposals.set({ plannerSessionId: 'planner-1', goalId, groups: [{ taskIds: [t1], note: '' }] })
    const newer = { plannerSessionId: 'planner-1', goalId, groups: [{ taskIds: [t2], note: '' }] }
    requestLaunch.mockImplementationOnce(() => {
      proposals.set(newer)
      return { terminalId: 'term-1', workspaceId: 'w1' }
    })
    await h.decideProposal(
      {
        plannerSessionId: 'planner-1',
        decision: 'accept',
        groups: [{ taskIds: [t1] }],
        markDone: true
      },
      requestLaunch
    )
    expect(proposals.list()).toEqual([newer])
  })

  it('reject clears it and starts nothing', async () => {
    const { h, proposals, goalId, t1, requestLaunch } = planSetup()
    proposals.set({ plannerSessionId: 'planner-1', goalId, groups: [{ taskIds: [t1], note: '' }] })
    const result = await h.decideProposal(
      { plannerSessionId: 'planner-1', decision: 'reject' },
      requestLaunch
    )
    expect(result).toMatchObject({ terminalIds: [], proposals: [] })
    expect(proposals.list()).toEqual([])
    expect(requestLaunch).not.toHaveBeenCalled()
  })

  it('edited groups go through the same checks: a repeated id, a task outside the proposal, a closed task', async () => {
    const { h, proposals, goalId, t1, t2, t3, requestLaunch } = planSetup()
    const proposal = {
      plannerSessionId: 'planner-1',
      goalId,
      groups: [{ taskIds: [t1, t2], note: '' }]
    }
    proposals.set(proposal)
    const accept = (groups: { taskIds: string[] }[]): Promise<unknown> =>
      h.decideProposal(
        { plannerSessionId: 'planner-1', decision: 'accept', groups, markDone: true },
        requestLaunch
      )
    await expect(accept([{ taskIds: [t1] }, { taskIds: [t1] }])).rejects.toThrow('task_repeated')
    await expect(accept([{ taskIds: [t1, t3] }])).rejects.toThrow('task_not_found')
    h.setTaskStatus({ id: t2, status: 'done' })
    await expect(accept([{ taskIds: [t1] }, { taskIds: [t2] }])).rejects.toThrow('task_not_found')
    expect(requestLaunch).not.toHaveBeenCalled()
    // A refused accept keeps the proposal, so the operator can fix it and press again.
    expect(proposals.list()).toEqual([proposal])
  })

  it('an accept that sends no groups launches nothing and keeps the proposal', async () => {
    const { h, proposals, goalId, t1, requestLaunch } = planSetup()
    proposals.set({ plannerSessionId: 'planner-1', goalId, groups: [{ taskIds: [t1], note: '' }] })
    await expect(
      h.decideProposal(
        { plannerSessionId: 'planner-1', decision: 'accept', markDone: true },
        requestLaunch
      )
    ).rejects.toThrow()
    expect(requestLaunch).not.toHaveBeenCalled()
    expect(proposals.list()).toHaveLength(1)
  })

  it('a decision on a proposal that is gone is refused and starts nothing', async () => {
    const { h, requestLaunch } = planSetup()
    await expect(
      h.decideProposal(
        {
          plannerSessionId: 'planner-1',
          decision: 'accept',
          groups: [{ taskIds: ['t1'] }],
          markDone: true
        },
        requestLaunch
      )
    ).rejects.toThrow('proposal_not_found')
    expect(requestLaunch).not.toHaveBeenCalled()
  })
})
