// Start sessions from goal tasks (spec 2026-10-19 goals, "Start from tasks without the planner"):
// the checks before anything launches, the folder fallback, one launch per group, and what each
// spawn of such a session gets (its tasks linked to the minted id, and the prompt block).
import { describe, it, expect, vi } from 'vitest'
import { createGoalsStore, GOAL_ERROR, type GoalsStore } from '../persistence/goals'
import { GOAL_FOLDER_MISSING, LAUNCH_CANCELLED } from '../../shared/schemas/goal'
import type { GoalsStartRequest } from '../../shared/schemas/goal'
import type { LaunchRequest } from '../pty/launchSession'
import {
  goalCommandFields,
  goalSpawnExtras,
  startGoalSessions,
  startPlanner,
  type GoalLaunch,
  type GoalMcpSpawn,
  type GoalSpawnDeps,
  type StartGoalSessionsDeps
} from './goalLaunch'
import { createGoalTokens, type GoalTokens } from './mcp/goalTokens'
import { buildPlannerPrompt } from './goalPrompt'
import { composeClaudeCommand, QUESTION_FORMAT_PROMPT } from '../pty/claudeBin'
import { MCP_SERVER_NAME, createMcpConfigs } from './mcp/mcpConfigFile'
import { createStorageHealth } from '../storageHealth'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function seed(): { store: GoalsStore; goalId: string; t1: string; t2: string; t3: string } {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
  const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship v2' }, '/work').saved.id
  const t1 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Write the spec' }).saved.id
  const t2 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Cut the release' }).saved.id
  const t3 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Tell the team' }).saved.id
  return { store, goalId, t1, t2, t3 }
}

/** A goal from before folders were required (`defaultCwd` null), with one open task. */
function legacySeed(): { store: GoalsStore; goalId: string; t1: string } {
  const file = {
    version: 1,
    goals: [{ id: 'old', workspaceId: 'w1', name: 'Old goal', createdAt: 1 }],
    tasks: [
      { id: 'ot1', workspaceId: 'w1', goalId: 'old', title: 'a', status: 'open', createdAt: 1 }
    ]
  }
  const store = createGoalsStore({
    blobStore: { read: () => file, write: () => {}, backup: () => {} }
  })
  return { store, goalId: 'old', t1: 'ot1' }
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
  it("a goal's tasks start in the goal folder, never the workspace's or a picker", async () => {
    const { store, goalId, t1, t2 } = seed()
    const groups = [{ taskIds: [t1] }, { taskIds: [t2] }]
    store.setGoalFolder(goalId, '/goal')
    const withGoal = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await startGoalSessions(req({ goalId, groups }), withGoal)
    expect(withGoal.launched.map((l) => l.cwd)).toEqual(['/goal', '/goal'])
    expect(withGoal.pickDirectory).not.toHaveBeenCalled()
  })

  it('daily tasks use the workspace folder, then ask once', async () => {
    let n = 0
    const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
    const t1 = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'a' }).saved.id
    const groups = [{ taskIds: [t1] }]
    const withWorkspace = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await startGoalSessions(req({ groups }), withWorkspace)
    expect(withWorkspace.launched.map((l) => l.cwd)).toEqual(['/ws'])
    expect(withWorkspace.pickDirectory).not.toHaveBeenCalled()
    const asks = deps(store)
    await startGoalSessions(req({ groups }), asks)
    expect(asks.launched.map((l) => l.cwd)).toEqual(['/picked'])
    expect(asks.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('a goal with no folder refuses with goal_folder_missing and never opens the picker', async () => {
    const { store, goalId, t1 } = legacySeed()
    const d = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await expect(
      startGoalSessions(req({ goalId, groups: [{ taskIds: [t1] }] }), d)
    ).rejects.toThrow(GOAL_FOLDER_MISSING)
    expect(d.pickDirectory).not.toHaveBeenCalled()
    expect(d.launched).toEqual([])
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
        cwd: '/work',
        name: 'Write the spec +1',
        workspaceId: 'w1',
        goalLaunch: { kind: 'worker', taskIds: [t1, t3], markDone: false }
      },
      {
        cwd: '/work',
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

  it('a session with no tasks, a fresh launch with no goalLaunch, and a planner with no MCP get nothing', () => {
    const { store, goalId, t1 } = seed()
    store.linkMany([t1], 'sess-1')
    const none = { appendPrompt: null, mcpConfigPath: null, allowedTools: null }
    expect(goalSpawnExtras(noMcp(store), 'sess-unlinked', null, true, null)).toEqual(none)
    expect(goalSpawnExtras(noMcp(store), 'sess-1', null, false, null)).toEqual(none)
    // A planner's prompt names its tools, so it comes with them or not at all.
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

  it('a refused config write reports goals write_failed to storage health, and the session starts without the tool or the line', () => {
    const { store, t1 } = seed()
    const userData = mkdtempSync(join(tmpdir(), 'cw-goal-mcp-'))
    try {
      writeFileSync(join(userData, 'mcp'), 'not a folder') // the disk refuses the folder
      const health = createStorageHealth({ onChange: () => {} })
      const configs = createMcpConfigs({
        dir: () => userData,
        serverName: MCP_SERVER_NAME,
        log: () => {},
        report: health.reporterFor('goals')
      })
      const extras = goalSpawnExtras(
        { store, mcp: mcp({ configs }) },
        'sess-1',
        worker([t1]),
        false,
        null
      )
      expect(health.get().problems).toEqual([{ store: 'goals', code: 'write_failed' }])
      expect([extras.mcpConfigPath, extras.allowedTools]).toEqual([null, null])
      expect(extras.appendPrompt).toContain(t1)
      expect(extras.appendPrompt).not.toContain('mark_task_done')
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
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

  it('a session with no open task gets no token', () => {
    const { store, t1 } = seed()
    const m = mcp()
    store.setTaskStatus(t1, 'done', 'operator')
    goalSpawnExtras({ store, mcp: m }, 'sess-1', worker([t1]), false, null)
    expect(m.written).toEqual([])
  })

  it('a planner gets its prompt, a planner token bound to its goal, and the three planner tools', () => {
    const { store, goalId, t1, t2, t3 } = seed()
    store.setTaskStatus(t2, 'done', 'operator')
    const m = mcp()
    const extras = goalSpawnExtras(
      { store, mcp: m },
      'sess-p',
      { kind: 'planner', goalId },
      false,
      null
    )
    expect(extras.appendPrompt).toBe(
      buildPlannerPrompt({
        goalName: 'Ship v2',
        tasks: [
          { id: t1, title: 'Write the spec', status: 'open' },
          { id: t2, title: 'Cut the release', status: 'done' },
          { id: t3, title: 'Tell the team', status: 'open' }
        ]
      })
    )
    expect(extras.mcpConfigPath).toBe('/cfg/sess-p.json')
    expect(extras.allowedTools).toBe(
      'mcp__claude-watcher__list_tasks,mcp__claude-watcher__create_task,mcp__claude-watcher__propose_split'
    )
    expect(m.tokens.resolve(m.written[0]?.token ?? '')).toEqual({
      sessionId: 'sess-p',
      workspaceId: 'w1',
      mode: 'planner',
      goalId
    })
    // A planner closes no work: it never counts as a session that could mark tasks done.
    expect(m.tokens.markDoneFor('sess-p')).toBe(false)
    // Linked to nothing: the planner's card shows no goal line.
    expect(store.tasksForSession('sess-p')).toEqual([])
  })

  it('a planner gets nothing when the hook port is not ours, the write is refused, or its goal is gone', () => {
    const { store, goalId } = seed()
    const none = { appendPrompt: null, mcpConfigPath: null, allowedTools: null }
    const planner: GoalLaunch = { kind: 'planner', goalId }

    const notOurs = mcp({ hookListening: () => false })
    expect(goalSpawnExtras({ store, mcp: notOurs }, 'sess-p', planner, false, null)).toEqual(none)
    expect(notOurs.written).toEqual([])

    const minted: string[] = []
    const refused = mcp({ configs: { write: () => null, remove: () => {} } })
    const mint = refused.tokens.mint.bind(refused.tokens)
    refused.tokens.mint = (grant) => {
      const t = mint(grant)
      minted.push(t)
      return t
    }
    expect(goalSpawnExtras({ store, mcp: refused }, 'sess-p', planner, false, null)).toEqual(none)
    expect(minted).toHaveLength(1)
    expect(refused.tokens.resolve(minted[0] ?? '')).toBeNull()

    store.removeGoal(goalId)
    const gone = mcp()
    expect(goalSpawnExtras({ store, mcp: gone }, 'sess-p', planner, false, null)).toEqual(none)
    expect(gone.written).toEqual([])
  })
})

describe('startPlanner', () => {
  it('launches one planner named after the goal (cut to the name limit), in its folder', async () => {
    const { store, goalId } = seed()
    store.saveGoal({ id: goalId, workspaceId: 'w1', name: 'G'.repeat(80) })
    const d = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await expect(startPlanner(goalId, { ...d, hookListening: () => true })).resolves.toEqual({
      terminalIds: ['term-1']
    })
    expect(d.launched).toEqual([
      {
        cwd: '/work',
        name: `${'G'.repeat(59)}…`,
        workspaceId: 'w1',
        goalLaunch: { kind: 'planner', goalId }
      }
    ])
    expect(d.pickDirectory).not.toHaveBeenCalled()
  })

  it('a goal with no folder refuses with goal_folder_missing and launches nothing', async () => {
    const { store, goalId } = legacySeed()
    const d = deps(store, { workspaces: { get: () => ({ defaultCwd: '/ws' }) } })
    await expect(startPlanner(goalId, { ...d, hookListening: () => true })).rejects.toThrow(
      GOAL_FOLDER_MISSING
    )
    expect(d.pickDirectory).not.toHaveBeenCalled()
    expect(d.launched).toEqual([])
  })

  it('refuses before anything launches: an unknown goal, hooks not ours, a too-old claude, a missing folder', async () => {
    const { store, goalId } = seed()
    store.setGoalFolder(goalId, '/goal')
    const cases: [string, Parameters<typeof startPlanner>[1], string][] = [
      ['nope', { ...deps(store), hookListening: () => true }, GOAL_ERROR.goalNotFound],
      [goalId, { ...deps(store), hookListening: () => false }, 'hooks_unavailable'],
      [
        goalId,
        { ...deps(store, { claudeVersionAllowsLaunch: () => false }), hookListening: () => true },
        'claude_version'
      ],
      [
        goalId,
        { ...deps(store, { isDirectory: () => false }), hookListening: () => true },
        'folder_missing'
      ]
    ]
    for (const [id, d, code] of cases) {
      await expect(startPlanner(id, d)).rejects.toThrow(code)
      expect((d as unknown as { launched: unknown[] }).launched).toEqual([])
    }
  })
})

describe('goalCommandFields', () => {
  const extras = {
    appendPrompt: 'TASK BLOCK',
    mcpConfigPath: '/ud/mcp/abc.json',
    allowedTools: 'mcp__claude-watcher__mark_task_done'
  }

  it('hands the task block (after the question nudge), the MCP config and the tools on', () => {
    expect(goalCommandFields(extras)).toEqual({
      appendSystemPrompt: `${QUESTION_FORMAT_PROMPT}\n\nTASK BLOCK`,
      mcpConfigPaths: ['/ud/mcp/abc.json'],
      allowedTools: 'mcp__claude-watcher__mark_task_done'
    })
  })

  it('null extras give the question prompt alone and no MCP flag in the command', () => {
    const fields = goalCommandFields({
      appendPrompt: null,
      mcpConfigPath: null,
      allowedTools: null
    })
    expect(fields).toEqual({
      appendSystemPrompt: QUESTION_FORMAT_PROMPT,
      mcpConfigPaths: [],
      allowedTools: null
    })
    const base = {
      claudeCommand: 'claude',
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
      displayName: 'x',
      hookSettingsPath: null,
      model: null,
      permissionMode: null,
      effort: null,
      initialPrompt: null,
      resume: false,
      pluginDir: null
    }
    const bare = composeClaudeCommand({ ...base, ...fields })
    expect(bare).not.toContain('--mcp-config')
    expect(bare).not.toContain('--allowedTools')
    const full = composeClaudeCommand({ ...base, ...goalCommandFields(extras) })
    expect(full).toContain('--mcp-config')
    expect(full).toContain('/ud/mcp/abc.json')
    expect(full).toContain('--allowedTools')
    expect(full).toContain('TASK BLOCK')
  })
})
