// What a launch with memory on gets (spec 2026-11-11 memory, "Claude integration"): its own token,
// the memory server's config, every memory tool pre-allowed, the index (its open tasks too) and
// its env var, all or nothing. A memory failure never fails the launch, and the memory server's
// bearers open nothing of the goals server's (and the other way round).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskSchema, type GoalsView } from '../../shared/schemas/goal'
import type { MemoryItem } from '../../shared/schemas/memory'
import type { Session } from '../../shared/schemas/session'
import { GOALS_MCP_PATH, MEMORY_MCP_PATH, MEMORY_MCP_URL } from '../hooks/hookContract'
import { createSessionTokens, type SessionTokens } from '../mcp/sessionTokens'
import { createMcpEndpoint, mcpRoute, type JsonRpcResponse } from '../mcp/mcpEndpoint'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { MCP_SERVER_NAME, createMcpConfigs } from '../goals/mcp/mcpConfigFile'
import { META, T0, createHarness, flush, prompt, said } from '../../__fixtures__/extractorHarness'
import { formatDay } from './formatDay'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import {
  MEMORY_NOT_AVAILABLE,
  MEMORY_TOOLS,
  type MemoryGrant,
  type MemorySessionMeta
} from './memoryTools'
import {
  NO_MEMORY_EXTRAS,
  createMemoryMcp,
  liveSessionMeta,
  markSessionsDeletedInMemory,
  memorySpawnExtras,
  type MemorySpawnDeps
} from './memoryLaunch'

const NOW = 1_762_800_000_000

type MemoryItemMeta = MemoryItem['meta']

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cw-memlaunch-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function openStore(): MemoryStore {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  let n = 0
  return createMemoryStore({
    db: open.db,
    now: () => NOW,
    newId: () => `m${++n}`,
    report: () => undefined,
    log: () => undefined
  })
}

type Injected = [string, Parameters<MemoryActivityLog['injected']>[1]]

function spawnDeps(over: Partial<Omit<MemorySpawnDeps, 'tokens'>> = {}): MemorySpawnDeps & {
  tokens: SessionTokens<MemoryGrant>
  injected: Injected[]
  lines: string[]
} {
  const tokens = createSessionTokens<MemoryGrant>()
  const injected: Injected[] = []
  const lines: string[] = []
  const store = openStore()
  const userData = tempDir()
  return {
    enabled: () => true,
    hookListening: () => true,
    store: () => store,
    tasks: () => null,
    now: () => NOW,
    names: { goalName: () => null, tagName: () => null },
    tokens,
    configs: createMcpConfigs({
      dir: () => userData,
      serverName: 'claude-watcher-memory',
      area: 'memory',
      log: (line) => lines.push(line),
      report: () => undefined
    }),
    url: MEMORY_MCP_URL,
    activity: { injected: (id, value) => injected.push([id, value]), recallMode: () => undefined },
    // Phase 1 (the index at launch); the memory mod's own cases: memoryLaunch.mod.test.ts.
    recallMod: () => ({ skip: 'setting_off' }),
    recall: { launched: () => undefined },
    log: (line) => lines.push(line),
    injected,
    lines,
    ...over
  }
}

const launch = { cwd: '/work/acme', workspaceId: 'w1', excludeTaskIds: [], resume: false }

/** An open task made `createdAt` NOW, in `/work/acme` unless `over` says otherwise. */
function openTask(
  id: string,
  title: string,
  over: Record<string, unknown> = {}
): GoalsView['tasks'][number] {
  return TaskSchema.parse({
    id,
    workspaceId: 'w1',
    title,
    status: 'open',
    createdAt: NOW,
    folder: '/work/acme',
    ...over
  })
}

describe('memorySpawnExtras', () => {
  it('returns nothing at all while memory is off, the hook port is down or the store is missing', () => {
    const off = spawnDeps({ enabled: () => false })
    const portDown = spawnDeps({ hookListening: () => false })
    const noStore = spawnDeps({ store: () => null })
    for (const deps of [off, portDown, noStore]) {
      expect(memorySpawnExtras(deps, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
      expect(deps.injected).toEqual([])
    }
    expect(NO_MEMORY_EXTRAS.env).toEqual({})
  })

  it('mints a token, writes the config and returns the index, the tools and its env var', () => {
    const on = spawnDeps()
    const out = memorySpawnExtras(on, 's1', launch, null)
    // Claude's own auto memory is not memory's to set: `pty/spawnExtras.ts`, from its setting.
    expect(out.env).toEqual({ CLAUDE_WATCHER_MEMORY: '1' })
    expect(out.allowedTools).toBe(
      MEMORY_TOOLS.map((t) => `mcp__claude-watcher-memory__${t}`).join(',')
    )
    expect(out.allowedTools?.split(',')).toContain('mcp__claude-watcher-memory__task_report')
    expect(out.appendPrompt).toContain('# Memory (Claude Watcher)')
    expect(out.mcpConfigPath).not.toBeNull()
    expect(existsSync(out.mcpConfigPath ?? '')).toBe(true)
    expect(on.injected).toEqual([
      ['s1', { chars: out.appendPrompt?.length, itemIds: [], groups: [] }]
    ])
  })

  it('the index lists the items saved for the launch folder in its workspace', () => {
    const on = spawnDeps()
    const store = on.store()
    const item = store?.add({
      text: { kind: 'specific', key: 'test key', value: '4242' },
      workspaceId: 'w1',
      check: null,
      basis: 'stated',
      origin: { by: 'agent', sessionId: 's0' },
      meta: {
        folder: '/work/acme',
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      source: null
    })
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out.appendPrompt).toContain('test key')
    expect(on.injected[0]?.[1].itemIds).toEqual([item?.id])
    // The launch path records the section's groups too (Context's rows per reason).
    expect(on.injected[0]?.[1].groups).toEqual([{ reason: 'folder', itemIds: [item?.id], more: 0 }])
  })

  it('the index lists the open tasks of the launch folder in its workspace, with no item id', () => {
    const view = {
      goals: [],
      tasks: [
        openTask('t1', 'Turn the cache on'),
        openTask('t2', 'Elsewhere', { workspaceId: 'w2' }),
        openTask('t3', 'Closed', { status: 'done' })
      ]
    }
    const on = spawnDeps({ tasks: () => view })
    const out = memorySpawnExtras(on, 's1', launch, null)
    const day = formatDay(NOW)
    expect(out.appendPrompt?.split('\n').slice(-3)).toEqual([
      '',
      '## Open tasks for this folder',
      `- Turn the cache on · open since ${day} · last seen today · id=t1`
    ])
    expect(on.injected[0]?.[1].itemIds).toEqual([])
  })

  it('a task in the goal launch block is not repeated in the memory index', () => {
    const view = { goals: [], tasks: [openTask('t1', 'In the block'), openTask('t2', 'Not in it')] }
    const on = spawnDeps({ tasks: () => view })
    const out = memorySpawnExtras(on, 's1', { ...launch, excludeTaskIds: ['t1'] }, null)
    expect(out.appendPrompt).not.toContain('In the block')
    expect(out.appendPrompt).not.toContain('id=t1')
    expect(out.appendPrompt).toContain('Not in it')
  })

  /** Saves one specific of w1 in `/elsewhere` with `meta`. */
  function saveElsewhere(deps: MemorySpawnDeps, key: string, meta: Partial<MemoryItemMeta>): void {
    deps.store()?.add({
      text: { kind: 'specific', key, value: '4242' },
      workspaceId: 'w1',
      check: null,
      basis: 'stated',
      origin: { by: 'agent', sessionId: 's0' },
      meta: {
        folder: '/elsewhere',
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: [],
        ...meta
      },
      source: null
    })
  }

  it("a launch whose goal block tasks share a goal lists that goal's items, from any folder", () => {
    const view = {
      goals: [],
      tasks: [openTask('t1', 'One', { goalId: 'g1' }), openTask('t2', 'Two', { goalId: 'g1' })]
    }
    const on = spawnDeps({
      tasks: () => view,
      names: { goalName: (id) => (id === 'g1' ? 'Billing v2' : null), tagName: () => null }
    })
    saveElsewhere(on, 'billing port', { goalId: 'g1' })
    const out = memorySpawnExtras(on, 's1', { ...launch, excludeTaskIds: ['t1', 't2'] }, null)
    const lines = out.appendPrompt?.split('\n') ?? []
    const heading = lines.indexOf('## Saved for goal "Billing v2"')
    expect(heading).toBeGreaterThan(-1)
    expect(lines[heading + 1]).toMatch(/^- billing port = 4242 \(seen /)
  })

  it('a launch never prints the tags group or the template group', () => {
    const on = spawnDeps({ names: { goalName: () => null, tagName: () => 'infra' } })
    saveElsewhere(on, 'tagged key', { tagIds: ['a'] })
    saveElsewhere(on, 'template key', { templateId: 'tp1' })
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out.appendPrompt).not.toContain('## Saved with the same tags')
    expect(out.appendPrompt).not.toContain('## Saved from the same template')
    expect(out.appendPrompt).toContain('2 more; use memory_search')
  })

  it('the token it mints is the one in the config file and resolves to the session', () => {
    const on = spawnDeps()
    const mint = vi.spyOn(on.tokens, 'mint')
    memorySpawnExtras(on, 's1', launch, null)
    const token = mint.mock.results[0]?.value as string
    expect(on.tokens.resolve(token)).toEqual({ sessionId: 's1' })
  })

  it('revokes the token and config of the session a Reopen replaces', () => {
    const on = spawnDeps()
    const mint = vi.spyOn(on.tokens, 'mint')
    const first = memorySpawnExtras(on, 's0', launch, null)
    const oldToken = mint.mock.results[0]?.value as string
    memorySpawnExtras(on, 's1', launch, 's0')
    expect(on.tokens.resolve(oldToken)).toBeNull()
    expect(existsSync(first.mcpConfigPath ?? '')).toBe(false)
  })

  it('a refused config write leaves no token behind', () => {
    const on = spawnDeps({
      configs: { write: () => null, remove: () => undefined }
    })
    const revoke = vi.spyOn(on.tokens, 'revoke')
    const mint = vi.spyOn(on.tokens, 'mint')
    expect(memorySpawnExtras(on, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
    expect(revoke).toHaveBeenCalledWith('s1')
    expect(on.tokens.resolve(mint.mock.results[0]?.value as string)).toBeNull()
    expect(on.injected).toEqual([])
  })

  it('an unreadable index launches as if memory were off, leaves no token or file and logs a code', () => {
    const store = openStore()
    store.indexRows = () => {
      throw new Error('memory_read_failed')
    }
    const on = spawnDeps({ store: () => store })
    const mint = vi.spyOn(on.tokens, 'mint')
    const write = vi.spyOn(on.configs, 'write')
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out).toEqual(NO_MEMORY_EXTRAS)
    // The index is built after the config is written (a mod session builds none), so the token
    // and the file were made, then dropped by the catch.
    expect(on.tokens.resolve(mint.mock.results[0]?.value as string)).toBeNull()
    expect(existsSync(write.mock.results[0]?.value as string)).toBe(false)
    expect(on.lines).toEqual(['[claude-watcher][memory] code=memory_launch_failed'])
    expect(on.injected).toEqual([])
  })

  it('a launch that fails after its token is made leaves no token and no config file', () => {
    const on = spawnDeps({
      activity: {
        injected: () => {
          throw new Error('boom')
        },
        recallMode: () => undefined
      }
    })
    const mint = vi.spyOn(on.tokens, 'mint')
    const write = vi.spyOn(on.configs, 'write')
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out).toEqual(NO_MEMORY_EXTRAS)
    const token = mint.mock.results[0]?.value as string
    const path = write.mock.results[0]?.value as string
    expect(typeof token).toBe('string')
    expect(on.tokens.resolve(token)).toBeNull()
    expect(existsSync(path)).toBe(false)
    expect(on.lines).toEqual(['[claude-watcher][memory] code=memory_launch_failed'])
  })

  it('a getter that throws launches as if memory were off, with a code', () => {
    const on = spawnDeps({
      enabled: () => {
        throw new Error('settings gone')
      }
    })
    expect(memorySpawnExtras(on, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
    expect(on.lines).toEqual(['[claude-watcher][memory] code=memory_launch_failed'])
  })

  it('a Reopen after memory was turned off still drops the old token and config file', () => {
    let enabled = true
    const on = spawnDeps({ enabled: () => enabled })
    const mint = vi.spyOn(on.tokens, 'mint')
    const first = memorySpawnExtras(on, 's0', launch, null)
    const oldToken = mint.mock.results[0]?.value as string
    enabled = false
    expect(memorySpawnExtras(on, 's1', launch, 's0')).toEqual(NO_MEMORY_EXTRAS)
    expect(on.tokens.resolve(oldToken)).toBeNull()
    expect(existsSync(first.mcpConfigPath ?? '')).toBe(false)
  })

  it("a write to one launch's empty env never turns the env on for a later launch", () => {
    const off = spawnDeps({ enabled: () => false })
    const first = memorySpawnExtras(off, 's1', launch, null)
    first.env.CLAUDE_WATCHER_MEMORY = '1'
    expect(memorySpawnExtras(off, 's2', launch, null).env).toEqual({})
    expect(NO_MEMORY_EXTRAS.env).toEqual({})
    expect(Object.isFrozen(NO_MEMORY_EXTRAS)).toBe(true)
    expect(Object.isFrozen(NO_MEMORY_EXTRAS.env)).toBe(true)
  })
})

describe('the memory MCP server', () => {
  function server(store: () => MemoryStore | null): ReturnType<typeof createMemoryMcp> {
    const userData = tempDir()
    return createMemoryMcp({
      dir: () => userData,
      report: () => undefined,
      enabled: () => true,
      store,
      session: (id) => (id === 's1' ? sessionMeta : null),
      names: {
        tagIdsByName: () => [],
        tagName: () => null,
        goalIdsByName: () => [],
        goalName: () => null
      },
      tasks: () => null,
      commands: () => null,
      activity: createMemoryActivity(),
      now: () => NOW,
      log: () => undefined
    })
  }
  const sessionMeta: MemorySessionMeta = {
    workspaceId: 'w1',
    folder: '/work/acme',
    sessionName: 'build',
    tagIds: [],
    templateId: null,
    goalId: null,
    taskIds: []
  }
  const callSearch = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'memory_search', arguments: { query: 'test' } }
  }

  it('with the database unreadable at start, every tool answers that memory is not available', () => {
    const mcp = server(() => null)
    const token = mcp.tokens.mint({ sessionId: 's1' })
    const open = mcpRoute(MEMORY_MCP_PATH, mcp.endpoint, () => undefined).open(`Bearer ${token}`)
    for (const name of MEMORY_TOOLS) {
      const res = open?.({ ...callSearch, params: { name, arguments: {} } })
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: MEMORY_NOT_AVAILABLE }], isError: true }
      } satisfies JsonRpcResponse)
    }
  })

  it('a memory bearer never opens the goals route, and a goals bearer never opens memory', () => {
    const memory = server(() => openStore())
    const goalTokens = createGoalTokens()
    const goals = createMcpEndpoint({
      tokens: goalTokens,
      tools: { list: () => [], call: () => ({ kind: 'invalid_params' }) },
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => undefined
    })
    const memoryRoute = mcpRoute(MEMORY_MCP_PATH, memory.endpoint, () => undefined)
    const goalsRoute = mcpRoute(GOALS_MCP_PATH, goals, () => undefined)
    const memoryBearer = `Bearer ${memory.tokens.mint({ sessionId: 's1' })}`
    const goalsBearer = `Bearer ${goalTokens.mint({ sessionId: 's1', workspaceId: 'w1', mode: 'worker' })}`
    expect(goalsRoute.open(memoryBearer)).toBeNull()
    expect(memoryRoute.open(goalsBearer)).toBeNull()
    expect(memoryRoute.open(memoryBearer)).not.toBeNull()
    expect(goalsRoute.open(goalsBearer)).not.toBeNull()
  })

  it('names the memory server in its config files, in the folder the goals start sweep clears', () => {
    const userData = tempDir()
    const mcp = createMemoryMcp({
      dir: () => userData,
      report: () => undefined,
      enabled: () => true,
      store: () => null,
      session: () => null,
      names: {
        tagIdsByName: () => [],
        tagName: () => null,
        goalIdsByName: () => [],
        goalName: () => null
      },
      tasks: () => null,
      commands: () => null,
      activity: createMemoryActivity(),
      now: () => NOW,
      log: () => undefined
    })
    const path = mcp.configs.write('s1', 'tok', MEMORY_MCP_URL) ?? ''
    expect(path.startsWith(join(userData, 'mcp'))).toBe(true)
    // The memory instance has no `clearStale` of its own: the goals instance's one sweep at start
    // (index.ts) removes every server's files, so a second sweep could only delete live ones.
    expect('clearStale' in mcp.configs).toBe(false)
    createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => undefined,
      report: () => undefined
    }).clearStale()
    expect(readdirSync(join(userData, 'mcp'))).toEqual([])
  })
})

describe('liveSessionMeta', () => {
  const session = {
    id: 's1',
    status: 'Working',
    projectPath: '/work/acme',
    pid: 1,
    sessionName: 'build',
    workspaceId: 'w1',
    tagIds: ['t1'],
    templateId: 'tpl'
  } satisfies Session

  it("reads the card on any board and the session's tasks", () => {
    const meta = liveSessionMeta({
      boards: () => [
        { sessionOf: () => undefined },
        { sessionOf: (id) => (id === 's1' ? session : undefined) }
      ],
      tasksForSession: () => [
        { id: 'k1', goalId: 'g1' },
        { id: 'k2', goalId: 'g1' }
      ]
    })
    expect(meta('s1')).toEqual({
      workspaceId: 'w1',
      folder: '/work/acme',
      sessionName: 'build',
      tagIds: ['t1'],
      templateId: 'tpl',
      goalId: 'g1',
      taskIds: ['k1', 'k2']
    })
  })

  it('names no goal when the tasks span goals or are loose', () => {
    const meta = (tasks: { id: string; goalId: string | null }[]): MemorySessionMeta | null =>
      liveSessionMeta({
        boards: () => [{ sessionOf: () => session }],
        tasksForSession: () => tasks
      })('s1')
    expect(
      meta([
        { id: 'k1', goalId: 'g1' },
        { id: 'k2', goalId: 'g2' }
      ])?.goalId
    ).toBeNull()
    expect(meta([{ id: 'k1', goalId: null }])?.goalId).toBeNull()
    expect(meta([])?.goalId).toBeNull()
  })

  it('is null for a session that is not live on any board', () => {
    const meta = liveSessionMeta({ boards: () => [], tasksForSession: () => [] })
    expect(meta('s1')).toBeNull()
  })
})

/** Memory as `markSessionsDeletedInMemory` reads it: only the item store (null = memory off). */
function memoryOf(store: MemoryStore | null): Parameters<typeof markSessionsDeletedInMemory>[0] {
  return { store: () => store, commands: () => null, extractor: () => null, now: () => NOW }
}

describe('markSessionsDeletedInMemory', () => {
  it("marks the session's items deleted and keeps them", () => {
    const store = openStore()
    const item = store.add({
      text: { kind: 'specific', key: 'k', value: 'v' },
      workspaceId: 'w1',
      check: null,
      basis: 'stated',
      origin: { by: 'agent', sessionId: 's1' },
      meta: {
        folder: null,
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      source: null
    })
    markSessionsDeletedInMemory(memoryOf(store), ['s1'], () => undefined)
    expect(store.get(item.id)?.originDeletedAt).toBe(NOW)
  })

  it('marks each session of a list, and a failed one does not stop the next', () => {
    const lines: string[] = []
    const store = openStore()
    const marked: string[] = []
    const markOne = store.markSessionDeleted
    store.markSessionDeleted = (id) => {
      if (id === 'bad') throw new Error('store_write_failed')
      marked.push(id)
      return markOne(id)
    }
    markSessionsDeletedInMemory(memoryOf(store), ['s1', 'bad', 's2'], (line) => lines.push(line))
    expect(marked).toEqual(['s1', 's2'])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_mark_deleted_failed'])
  })

  it('a memory failure is logged by code and never thrown', () => {
    const lines: string[] = []
    const store = openStore()
    store.markSessionDeleted = () => {
      throw new Error('store_write_failed')
    }
    expect(() =>
      markSessionsDeletedInMemory(memoryOf(store), ['s1'], (line) => lines.push(line))
    ).not.toThrow()
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_mark_deleted_failed'])
  })

  it('does nothing while memory is off', () => {
    expect(() => markSessionsDeletedInMemory(memoryOf(null), ['s1'], () => undefined)).not.toThrow()
  })

  it('a deleted session marks its commands and forgets its save', async () => {
    const h = createHarness()
    h.meta.set('s1', META)
    h.set.manual = true
    h.write('s1', prompt('the api now listens on port 9281'), said('moved it'), prompt('ok'))
    h.commands.record({
      workspaceId: 'w1',
      folder: '/work/acme/shop',
      text: 'npm test',
      sessionId: 's1',
      at: T0
    })
    h.ex.stop('s1')
    h.ex.ended('s1')
    await flush()
    expect(h.calls).toHaveLength(1)
    markSessionsDeletedInMemory(
      { store: () => h.store, commands: () => h.commands, extractor: () => h.ex, now: () => NOW },
      ['s1'],
      () => undefined
    )
    expect(h.calls[0]?.cancel).toHaveBeenCalledTimes(1)
    expect(h.state.get('s1')).toBeNull()
    const all = { query: null, folder: null, offset: 0, limit: 10 }
    expect(h.commands.list('w1', all).rows.map((c) => c.sessionDeletedAt)).toEqual([NOW])
    h.calls[0]?.resolve({ ok: false, reason: 'cancelled', issue: null })
    await h.ex.idle()
  })

  it('a failed forget still marks the items and the commands', () => {
    const lines: string[] = []
    const store = openStore()
    const marked: string[] = []
    store.markSessionDeleted = (id) => {
      marked.push(`item ${id}`)
      return 0
    }
    markSessionsDeletedInMemory(
      {
        store: () => store,
        commands: () => ({
          markSessionDeleted: (id) => {
            marked.push(`command ${id}`)
            return 0
          }
        }),
        extractor: () => ({
          forget: () => {
            throw new Error('boom')
          }
        }),
        now: () => NOW
      },
      ['s1'],
      (line) => lines.push(line)
    )
    expect(marked).toEqual(['item s1', 'command s1'])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_forget_failed'])
  })

  it('a failed commands mark logs its own code and still forgets the save and marks the items', () => {
    const lines: string[] = []
    const done: string[] = []
    markSessionsDeletedInMemory(
      {
        store: () => ({ markSessionDeleted: () => done.push('items') }),
        commands: () => ({
          markSessionDeleted: () => {
            throw new Error('boom')
          }
        }),
        extractor: () => ({ forget: () => void done.push('forget') }),
        now: () => NOW
      },
      ['s1'],
      (line) => lines.push(line)
    )
    expect(done).toEqual(['forget', 'items'])
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_mark_commands_deleted_failed'])
  })
})
