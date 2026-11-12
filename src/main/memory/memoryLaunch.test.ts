// What a launch with memory on gets (spec 2026-11-11 memory, "Claude integration"): its own token,
// the memory server's config, the six tools pre-allowed, the index and the two env vars, all or
// nothing. A memory failure never fails the launch, and the memory server's bearers open nothing
// of the goals server's (and the other way round).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '../../shared/schemas/session'
import { GOALS_MCP_PATH, MEMORY_MCP_PATH, MEMORY_MCP_URL } from '../hooks/hookContract'
import { createSessionTokens, type SessionTokens } from '../mcp/sessionTokens'
import { createMcpEndpoint, mcpRoute, type JsonRpcResponse } from '../mcp/mcpEndpoint'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { MCP_SERVER_NAME, createMcpConfigs } from '../goals/mcp/mcpConfigFile'
import { createMemoryActivity } from './memoryActivity'
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
  markSessionDeletedInMemory,
  memorySpawnExtras,
  type MemorySpawnDeps
} from './memoryLaunch'

const NOW = 1_762_800_000_000

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

type Injected = [string, { chars: number; itemIds: readonly string[] }]

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
    tokens,
    configs: createMcpConfigs({
      dir: () => userData,
      serverName: 'claude-watcher-memory',
      area: 'memory',
      log: (line) => lines.push(line),
      report: () => undefined
    }),
    url: MEMORY_MCP_URL,
    activity: { injected: (id, value) => injected.push([id, value]) },
    log: (line) => lines.push(line),
    injected,
    lines,
    ...over
  }
}

const launch = { cwd: '/work/acme', workspaceId: 'w1' }

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

  it('mints a token, writes the config and returns the index, the tools and both env vars', () => {
    const on = spawnDeps()
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out.env).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_WATCHER_MEMORY: '1' })
    expect(out.allowedTools).toBe(
      MEMORY_TOOLS.map((t) => `mcp__claude-watcher-memory__${t}`).join(',')
    )
    expect(out.appendPrompt).toContain('# Memory (Claude Watcher)')
    expect(out.mcpConfigPath).not.toBeNull()
    expect(existsSync(out.mcpConfigPath ?? '')).toBe(true)
    expect(on.injected).toEqual([['s1', { chars: out.appendPrompt?.length, itemIds: [] }]])
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
      }
    })
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out.appendPrompt).toContain('test key')
    expect(on.injected[0]?.[1].itemIds).toEqual([item?.id])
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

  it('an unreadable index launches as if memory were off, mints nothing and logs a code', () => {
    const store = openStore()
    store.indexRows = () => {
      throw new Error('memory_read_failed')
    }
    const on = spawnDeps({ store: () => store })
    const mint = vi.spyOn(on.tokens, 'mint')
    const write = vi.spyOn(on.configs, 'write')
    const out = memorySpawnExtras(on, 's1', launch, null)
    expect(out).toEqual(NO_MEMORY_EXTRAS)
    expect(mint).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(on.lines).toEqual(['[claude-watcher][memory] code=memory_launch_failed'])
    expect(on.injected).toEqual([])
  })

  it('a launch that fails after its token is made leaves no token and no config file', () => {
    const on = spawnDeps({
      activity: {
        injected: () => {
          throw new Error('boom')
        }
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
    first.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
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
      names: { tagIdsByName: () => [], tagName: () => null, goalIdsByName: () => [] },
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
      names: { tagIdsByName: () => [], tagName: () => null, goalIdsByName: () => [] },
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

describe('markSessionDeletedInMemory', () => {
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
      }
    })
    markSessionDeletedInMemory(
      () => store,
      's1',
      () => undefined
    )
    expect(store.get(item.id)?.originDeletedAt).toBe(NOW)
  })

  it('a memory failure is logged by code and never thrown', () => {
    const lines: string[] = []
    const store = openStore()
    store.markSessionDeleted = () => {
      throw new Error('store_write_failed')
    }
    expect(() =>
      markSessionDeletedInMemory(
        () => store,
        's1',
        (line) => lines.push(line)
      )
    ).not.toThrow()
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_mark_deleted_failed'])
  })

  it('does nothing while memory is off', () => {
    expect(() =>
      markSessionDeletedInMemory(
        () => null,
        's1',
        () => undefined
      )
    ).not.toThrow()
  })
})
