// Start sessions from goal tasks (spec 2026-10-19 goals, "Start from tasks without the planner"):
// the checks before anything launches, the folder fallback, one launch per group, and what each
// spawn of such a session gets (its tasks linked to the minted id, and the prompt block).
import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore, GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { LAUNCH_CANCELLED } from '../../shared/schemas/goal'
import type { GoalsStartRequest } from '../../shared/schemas/goal'
import type { LaunchRequest } from '../pty/launchSession'
import { goalSpawnExtras, startGoalSessions, type StartGoalSessionsDeps } from './goalLaunch'

function seed(): { store: GoalsStore; goalId: string; t1: string; t2: string; t3: string } {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
  const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship v2' }).saved.id
  const t1 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Write the spec' }).saved.id
  const t2 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Cut the release' }).saved.id
  const t3 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Tell the team' }).saved.id
  return { store, goalId, t1, t2, t3 }
}

function deps(
  store: GoalsStore,
  over: Partial<StartGoalSessionsDeps> = {}
): StartGoalSessionsDeps & { launched: LaunchRequest[] } {
  const launched: LaunchRequest[] = []
  let n = 0
  return {
    launched,
    store,
    workspaces: { get: () => ({ defaultCwd: null }) },
    pickDirectory: vi.fn(() => Promise.resolve<string | null>('/picked')),
    requestLaunch: (req) => {
      launched.push(req)
      return { terminalId: `term-${++n}`, workspaceId: req.workspaceId ?? 'w1' }
    },
    isDirectory: () => true,
    claudeVersionAllowsLaunch: () => true,
    log: () => {},
    ...over
  }
}

const req = (over: Partial<GoalsStartRequest>): GoalsStartRequest => ({
  workspaceId: 'w1',
  goalId: null,
  groups: [],
  markDone: true,
  ...over
})

describe('startGoalSessions', () => {
  it('uses the goal folder first, then the workspace folder, then asks once', async () => {
    const { store, goalId, t1, t2 } = seed()
    const groups = [{ taskIds: [t1] }, { taskIds: [t2] }]

    store.setGoalFolder(goalId, '/goal')
    const withGoal = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await startGoalSessions(req({ goalId, groups }), withGoal)
    expect(withGoal.launched.map((l) => l.cwd)).toEqual(['/goal', '/goal'])
    expect(withGoal.pickDirectory).not.toHaveBeenCalled()

    store.setGoalFolder(goalId, null)
    const withWorkspace = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await startGoalSessions(req({ goalId, groups }), withWorkspace)
    expect(withWorkspace.launched.map((l) => l.cwd)).toEqual(['/ws', '/ws'])
    expect(withWorkspace.pickDirectory).not.toHaveBeenCalled()

    const asks = deps(store)
    await startGoalSessions(req({ goalId, groups }), asks)
    expect(asks.launched.map((l) => l.cwd)).toEqual(['/picked', '/picked'])
    expect(asks.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('one group per requestLaunch with the derived name', async () => {
    const { store, goalId, t1, t2, t3 } = seed()
    const d = deps(store)
    const out = await startGoalSessions(
      req({ goalId, groups: [{ taskIds: [t1, t3] }, { taskIds: [t2] }], markDone: false }),
      d
    )
    expect(out).toEqual({ terminalIds: ['term-1', 'term-2'] })
    expect(d.launched).toEqual([
      {
        cwd: '/picked',
        name: 'Write the spec +1',
        workspaceId: 'w1',
        goalLaunch: { kind: 'worker', taskIds: [t1, t3], markDone: false }
      },
      {
        cwd: '/picked',
        name: 'Cut the release',
        workspaceId: 'w1',
        goalLaunch: { kind: 'worker', taskIds: [t2], markDone: false }
      }
    ])
  })

  it('a done task is refused and nothing launches', async () => {
    const { store, t1, t2 } = seed()
    store.setTaskStatus(t2, 'done', 'operator')
    const d = deps(store)
    await expect(
      startGoalSessions(req({ groups: [{ taskIds: [t1] }, { taskIds: [t2] }] }), d)
    ).rejects.toThrow(GOAL_ERROR.taskNotFound)
    expect(d.launched).toEqual([])
    expect(d.pickDirectory).not.toHaveBeenCalled()
  })

  it('a task of another workspace or another goal is refused and nothing launches', async () => {
    const { store, goalId, t1 } = seed()
    const loose = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'Loose' }).saved.id
    const elsewhere = store.saveTask({ workspaceId: 'w2', goalId: null, title: 'Far' }).saved.id
    const d = deps(store)
    await expect(
      startGoalSessions(req({ groups: [{ taskIds: [t1, elsewhere] }] }), d)
    ).rejects.toThrow(GOAL_ERROR.workspaceMismatch)
    await expect(
      startGoalSessions(req({ goalId, groups: [{ taskIds: [t1, loose] }] }), d)
    ).rejects.toThrow(GOAL_ERROR.workspaceMismatch)
    await expect(
      startGoalSessions(req({ goalId: 'gone', groups: [{ taskIds: [t1] }] }), d)
    ).rejects.toThrow(GOAL_ERROR.goalNotFound)
    expect(d.launched).toEqual([])
  })

  it('cancel launches nothing', async () => {
    const { store, t1 } = seed()
    const d = deps(store, { pickDirectory: vi.fn(() => Promise.resolve(null)) })
    await expect(startGoalSessions(req({ groups: [{ taskIds: [t1] }] }), d)).rejects.toThrow(
      LAUNCH_CANCELLED
    )
    expect(d.launched).toEqual([])
  })

  it('a task closed while the folder picker was open is refused after the pick', async () => {
    const { store, t1 } = seed()
    const d = deps(store, {
      pickDirectory: vi.fn(() => {
        store.setTaskStatus(t1, 'done', 'operator')
        return Promise.resolve('/picked')
      })
    })
    await expect(startGoalSessions(req({ groups: [{ taskIds: [t1] }] }), d)).rejects.toThrow(
      GOAL_ERROR.taskNotFound
    )
    expect(d.launched).toEqual([])
  })

  it('a missing folder or a too-old claude refuses before anything launches', async () => {
    const { store, t1 } = seed()
    const log = vi.fn()
    const missing = deps(store, { isDirectory: () => false, log })
    await expect(startGoalSessions(req({ groups: [{ taskIds: [t1] }] }), missing)).rejects.toThrow(
      'folder_missing'
    )
    expect(log).toHaveBeenCalledWith('[claude-watcher][goals] code=folder_missing')
    expect(missing.launched).toEqual([])

    const old = deps(store, { claudeVersionAllowsLaunch: () => false })
    await expect(startGoalSessions(req({ groups: [{ taskIds: [t1] }] }), old)).rejects.toThrow(
      'claude_version'
    )
    expect(old.pickDirectory).not.toHaveBeenCalled()
    expect(old.launched).toEqual([])
  })
})

describe('goalSpawnExtras', () => {
  it('links the tasks to the minted session id at spawn', () => {
    const { store, t1, t2 } = seed()
    const extras = goalSpawnExtras(
      store,
      'sess-1',
      { kind: 'worker', taskIds: [t1, t2], markDone: true },
      false
    )
    expect(store.tasksForSession('sess-1').map((t) => t.id)).toEqual([t1, t2])
    expect(extras).toEqual({
      appendPrompt: [
        'This session works on goal "Ship v2". Its tasks:',
        `- [${t1}] Write the spec`,
        `- [${t2}] Cut the release`
      ].join('\n'),
      mcpConfigPath: null,
      allowedTools: null
    })
  })

  it("resume with no goalLaunch rebuilds the block from the session's linked tasks", () => {
    const { store, t1, t3 } = seed()
    store.linkMany([t3], 'sess-old')
    store.linkMany([t1], 'sess-old')
    const extras = goalSpawnExtras(store, 'sess-old', null, true)
    expect(extras.appendPrompt).toBe(
      [
        'This session works on goal "Ship v2". Its tasks:',
        `- [${t1}] Write the spec`,
        `- [${t3}] Tell the team`
      ].join('\n')
    )
  })

  it('a session with no tasks, a fresh launch with no goalLaunch, and a planner get nothing', () => {
    const { store, goalId, t1 } = seed()
    store.linkMany([t1], 'sess-1')
    const none = { appendPrompt: null, mcpConfigPath: null, allowedTools: null }
    expect(goalSpawnExtras(store, 'sess-unlinked', null, true)).toEqual(none)
    expect(goalSpawnExtras(store, 'sess-1', null, false)).toEqual(none)
    expect(goalSpawnExtras(store, 'sess-p', { kind: 'planner', goalId }, false)).toEqual(none)
  })

  it('tasks of more than one goal get the tasks-only head', () => {
    const { store, t1 } = seed()
    const loose = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'Loose' }).saved.id
    const extras = goalSpawnExtras(
      store,
      'sess-1',
      { kind: 'worker', taskIds: [t1, loose], markDone: false },
      false
    )
    expect(extras.appendPrompt).toBe(
      ['This session works on these tasks:', `- [${t1}] Write the spec`, `- [${loose}] Loose`].join(
        '\n'
      )
    )
  })

  it('when the hook port is not ours the block has no mark_task_done line', () => {
    // No MCP server is served yet, so no session gets the tool and no block names it.
    const { store, t1 } = seed()
    const extras = goalSpawnExtras(
      store,
      'sess-1',
      { kind: 'worker', taskIds: [t1], markDone: true },
      false
    )
    expect(extras.appendPrompt).not.toContain('mark_task_done')
    expect(extras.mcpConfigPath).toBeNull()
  })
})
