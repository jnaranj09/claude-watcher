// Start sessions from goal tasks (spec 2026-10-19 goals, "Start from tasks without the planner"):
// the checks before anything launches, the folder fallback, one launch per group, and what each
// spawn of such a session gets (its tasks linked to the minted id, and the prompt block).
import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore, GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { LAUNCH_CANCELLED } from '../../shared/schemas/goal'
import type { GoalsStartRequest } from '../../shared/schemas/goal'
import type { LaunchRequest } from '../pty/launchSession'
import {
  goalSpawnExtras,
  startGoalSessions,
  type GoalLaunch,
  type GoalMcpSpawn,
  type GoalSpawnDeps,
  type StartGoalSessionsDeps
} from './goalLaunch'
import { createGoalTokens, type GoalTokens } from './mcp/goalTokens'

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

/** No MCP at all (the tool's own tests below wire it). */
const noMcp = (store: GoalsStore): GoalSpawnDeps => ({ store, mcp: null })

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

  it('a group whose name fails the name check launches no group at all', async () => {
    const { store, t1, t2, t3 } = seed()
    // A title that slipped past its schema (control character): the name check refuses it.
    const view = store.view.bind(store)
    const sneaky: GoalsStore = {
      ...store,
      view: () => {
        const v = view()
        return { ...v, tasks: v.tasks.map((t) => (t.id === t3 ? { ...t, title: 'bad\u0007' } : t)) }
      }
    }
    const d = deps(sneaky)
    await expect(
      startGoalSessions(
        req({ groups: [{ taskIds: [t1] }, { taskIds: [t2] }, { taskIds: [t3] }] }),
        d
      )
    ).rejects.toThrow()
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
      noMcp(store),
      'sess-1',
      { kind: 'worker', taskIds: [t1, t2], markDone: true },
      false,
      null
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
    const extras = goalSpawnExtras(noMcp(store), 'sess-old', null, true, null)
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
    expect(goalSpawnExtras(noMcp(store), 'sess-unlinked', null, true, null)).toEqual(none)
    expect(goalSpawnExtras(noMcp(store), 'sess-1', null, false, null)).toEqual(none)
    expect(
      goalSpawnExtras(noMcp(store), 'sess-p', { kind: 'planner', goalId }, false, null)
    ).toEqual(none)
  })

  it('tasks of more than one goal get the tasks-only head', () => {
    const { store, t1 } = seed()
    const loose = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'Loose' }).saved.id
    const extras = goalSpawnExtras(
      noMcp(store),
      'sess-1',
      { kind: 'worker', taskIds: [t1, loose], markDone: false },
      false,
      null
    )
    expect(extras.appendPrompt).toBe(
      ['This session works on these tasks:', `- [${t1}] Write the spec`, `- [${loose}] Loose`].join(
        '\n'
      )
    )
  })

  // A dead-pane Reopen re-spawns the same recipe with a NEW id: only work still open and still
  // linked to the id it replaces comes along.
  const worker = (taskIds: string[]): GoalLaunch => ({ kind: 'worker', taskIds, markDone: true })

  it('a Reopen after a task was closed does not list or re-link it', () => {
    const { store, t1, t2 } = seed()
    goalSpawnExtras(noMcp(store), 'sess-1', worker([t1, t2]), false, null)
    store.setTaskStatus(t1, 'done', 'operator')
    const extras = goalSpawnExtras(noMcp(store), 'sess-2', worker([t1, t2]), false, 'sess-1')
    expect(store.tasksForSession('sess-2').map((t) => t.id)).toEqual([t2])
    expect(extras.appendPrompt).toBe(
      ['This session works on goal "Ship v2". Its tasks:', `- [${t2}] Cut the release`].join('\n')
    )
  })

  it('a Reopen after the operator unlinked a task does not re-link it', () => {
    const { store, t1, t2 } = seed()
    goalSpawnExtras(noMcp(store), 'sess-1', worker([t1, t2]), false, null)
    store.unlink(t2, 'sess-1')
    const extras = goalSpawnExtras(noMcp(store), 'sess-2', worker([t1, t2]), false, 'sess-1')
    expect(store.tasksForSession('sess-2').map((t) => t.id)).toEqual([t1])
    expect(extras.appendPrompt).not.toContain(t2)
  })

  it('a Reopen with nothing left open gets no block', () => {
    const { store, t1 } = seed()
    goalSpawnExtras(noMcp(store), 'sess-1', worker([t1]), false, null)
    store.setTaskStatus(t1, 'done', 'operator')
    expect(
      goalSpawnExtras(noMcp(store), 'sess-2', worker([t1]), false, 'sess-1').appendPrompt
    ).toBeNull()
    expect(store.tasksForSession('sess-2')).toEqual([])
  })

  it('a resume whose linked tasks are all done gets no block', () => {
    const { store, t1, t2 } = seed()
    store.linkMany([t1, t2], 'sess-old')
    store.setTaskStatus(t1, 'done', 'operator')
    store.setTaskStatus(t2, 'done', 'session')
    expect(goalSpawnExtras(noMcp(store), 'sess-old', null, true, null).appendPrompt).toBeNull()
  })

  it('a resume lists only the open tasks of the session', () => {
    const { store, t1, t2 } = seed()
    store.linkMany([t1, t2], 'sess-old')
    store.setTaskStatus(t1, 'done', 'operator')
    const block = goalSpawnExtras(noMcp(store), 'sess-old', null, true, null).appendPrompt
    expect(block).toContain(t2)
    expect(block).not.toContain(t1)
  })
})

describe('goalSpawnExtras — mark_task_done over MCP', () => {
  const URL = 'http://127.0.0.1:29279/mcp/goals'
  function mcp(over: Partial<GoalMcpSpawn> = {}): GoalMcpSpawn & {
    tokens: GoalTokens
    written: { sessionId: string; token: string; url: string }[]
  } {
    const written: { sessionId: string; token: string; url: string }[] = []
    return {
      written,
      hookListening: () => true,
      configs: {
        write: (sessionId, token, url) => {
          written.push({ sessionId, token, url })
          return `/cfg/${sessionId}.json`
        },
        remove: () => {}
      },
      url: URL,
      pastTasksMarkDone: () => false,
      log: () => {},
      ...over,
      tokens: createGoalTokens()
    }
  }
  const worker = (taskIds: string[], markDone = true): GoalLaunch => ({
    kind: 'worker',
    taskIds,
    markDone
  })

  it('hook port ours + worker + markDone: the line, the config file and the one allowed tool', () => {
    const { store, t1 } = seed()
    const m = mcp()
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    expect(extras.appendPrompt).toContain(
      'When you finish a task, call the mark_task_done tool with its id.'
    )
    expect(extras.mcpConfigPath).toBe('/cfg/sess-1.json')
    expect(extras.allowedTools).toBe('mcp__claude-watcher__mark_task_done')
    expect(m.written).toHaveLength(1)
    expect(m.written[0]?.url).toBe(URL)
    expect(m.tokens.resolve(m.written[0]?.token ?? '')).toEqual({
      sessionId: 'sess-1',
      workspaceId: 'w1',
      mode: 'worker'
    })
  })

  it('hook port NOT ours (SEC-6): no line, both MCP fields null, no token', () => {
    const { store, t1 } = seed()
    const lines: string[] = []
    const m = mcp({ hookListening: () => false, log: (l) => lines.push(l) })
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    expect(extras.appendPrompt).toContain(t1)
    expect(extras.appendPrompt).not.toContain('mark_task_done')
    expect(extras.mcpConfigPath).toBeNull()
    expect(extras.allowedTools).toBeNull()
    expect(m.written).toEqual([])
    expect(m.tokens.markDoneFor('sess-1')).toBe(false)
    expect(lines).toEqual(['[claude-watcher][goals] code=mcp_hook_port_not_ours'])
  })

  it('markDone off: no line, no MCP fields, no token', () => {
    const { store, t1 } = seed()
    const m = mcp()
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1], false), false, null)
    expect(extras.appendPrompt).not.toContain('mark_task_done')
    expect([extras.mcpConfigPath, extras.allowedTools]).toEqual([null, null])
    expect(m.written).toEqual([])
  })

  it('a config file the disk refuses: no line, no flags, and the minted token is revoked', () => {
    const { store, t1 } = seed()
    let token = ''
    const m = mcp({
      configs: {
        write: (_s, t) => {
          token = t
          return null
        },
        remove: () => {}
      }
    })
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    expect(extras.appendPrompt).not.toContain('mark_task_done')
    expect([extras.mcpConfigPath, extras.allowedTools]).toEqual([null, null])
    expect(m.tokens.resolve(token)).toBeNull()
  })

  it("a Reopen of the same terminal keeps the operator's choice and mints for the new id", () => {
    const { store, t1 } = seed()
    const m = mcp()
    goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    m.tokens.revoke('sess-1') // the first session exited
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-2', worker([t1]), false, 'sess-1')
    expect(extras.mcpConfigPath).toBe('/cfg/sess-2.json')
    expect(m.tokens.resolve(m.written[1]?.token ?? '')).toMatchObject({ sessionId: 'sess-2' })
    expect(m.tokens.resolve(m.written[0]?.token ?? '')).toBeNull()
  })

  it('a resume in the same run gets the tool back with a fresh token', () => {
    const { store, t1 } = seed()
    const m = mcp()
    goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    m.tokens.revoke('sess-1') // archived
    const extras = goalSpawnExtras({ store, mcp: m }, 'sess-1', null, true, null)
    expect(extras.appendPrompt).toContain('mark_task_done')
    expect(m.written[1]?.token).not.toBe(m.written[0]?.token)
    expect(m.tokens.resolve(m.written[1]?.token ?? '')).toMatchObject({ sessionId: 'sess-1' })
  })

  it('a resume after a restart asks the past-session flag', () => {
    const { store, t1 } = seed()
    store.linkMany([t1], 'sess-old')
    const without = goalSpawnExtras({ store, mcp: mcp() }, 'sess-old', null, true, null)
    const flagged = goalSpawnExtras(
      { store, mcp: mcp({ pastTasksMarkDone: (id) => id === 'sess-old' }) },
      'sess-old',
      null,
      true,
      null
    )
    expect(without.mcpConfigPath).toBeNull()
    expect(flagged.mcpConfigPath).toBe('/cfg/sess-old.json')
  })

  it('a planner and a session with no open task get no token', () => {
    const { store, goalId, t1 } = seed()
    const m = mcp()
    goalSpawnExtras({ store, mcp: m }, 'sess-p', { kind: 'planner', goalId }, false, null)
    store.setTaskStatus(t1, 'done', 'operator')
    goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    expect(m.written).toEqual([])
  })
})
