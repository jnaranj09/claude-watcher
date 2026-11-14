// What a launch with memory on gets when it may load the memory mod (memory phase 3, addendum §2):
// a mod session gets the mod's folder and its config path in the env and no index on the command
// line; a skipped mod is phase 1 exactly, with the reason kept for Context; with memory off, or a
// refused config write, the mod is never asked for. Its token is the memory server's own, and a
// `/clear` rebind keeps the file and the token the mod process was started with.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MemoryRecallMode } from '../../shared/schemas/memory'
import { MEMORY_MCP_URL } from '../hooks/hookContract'
import { createMemoryActivity } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import {
  MEMORY_CONFIG_ENV,
  NO_MEMORY_EXTRAS,
  createMemoryMcp,
  memorySpawnExtras,
  type MemorySpawnDeps
} from './memoryLaunch'

const NOW = 1_762_800_000_000
const launch = { cwd: '/work/app', workspaceId: 'w1', excludeTaskIds: ['t1'] }

const dirs: string[] = []
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

/** Records of what one spawn did, beside its deps. */
interface Seen {
  injected: unknown[]
  recallModes: [string, MemoryRecallMode][]
  launchedCalls: [string, { excludeTaskIds: readonly string[] }][]
  revoked: string[]
  removed: string[]
  lines: string[]
  indexRows: () => number
}

function setup(over: Partial<MemorySpawnDeps> = {}): { deps: MemorySpawnDeps; seen: Seen } {
  const store = openStore()
  const indexRows = vi.spyOn(store, 'indexRows')
  const seen: Seen = {
    injected: [],
    recallModes: [],
    launchedCalls: [],
    revoked: [],
    removed: [],
    lines: [],
    indexRows: () => indexRows.mock.calls.length
  }
  const deps: MemorySpawnDeps = {
    enabled: () => true,
    hookListening: () => true,
    store: () => store,
    tasks: () => null,
    now: () => NOW,
    tokens: { mint: () => 'tok', revoke: (id) => seen.revoked.push(id) },
    configs: { write: () => '/data/mcp/a.json', remove: (id) => seen.removed.push(id) },
    url: MEMORY_MCP_URL,
    activity: {
      injected: (id, value) => seen.injected.push([id, value]),
      recallMode: (id, mode) => seen.recallModes.push([id, mode])
    },
    recallMod: () => ({ skip: 'setting_off' }),
    recall: { launched: (id, facts) => seen.launchedCalls.push([id, facts]) },
    log: (line) => seen.lines.push(line),
    ...over
  }
  return { deps, seen }
}

describe('memorySpawnExtras with the memory mod', () => {
  it('a mod session gets the folder and the config path in its env, and no index on the command line', () => {
    const { deps, seen } = setup({ recallMod: () => ({ dir: '/data/mods/watcher-memory' }) })
    const out = memorySpawnExtras(deps, 's1', launch, null)
    expect(out).toEqual({
      appendPrompt: null,
      pluginDir: '/data/mods/watcher-memory',
      mcpConfigPath: '/data/mcp/a.json',
      allowedTools: expect.stringContaining('mcp__claude-watcher-memory__memory_search'),
      env: { CLAUDE_WATCHER_MEMORY: '1', CLAUDE_WATCHER_MEMORY_CONFIG: '/data/mcp/a.json' }
    })
    expect([seen.injected, seen.indexRows(), seen.recallModes, seen.launchedCalls]).toEqual([
      [],
      0,
      [['s1', { mode: 'mod' }]],
      [['s1', { excludeTaskIds: ['t1'] }]]
    ])
  })

  it('a skipped mod is phase 1 exactly, and the reason is kept for Context', () => {
    const { deps, seen } = setup({ recallMod: () => ({ skip: 'claude_too_old' }) })
    const out = memorySpawnExtras(deps, 's1', launch, null)
    expect(out).toMatchObject({
      pluginDir: null,
      appendPrompt: expect.stringMatching(/^# Memory \(Claude Watcher\)/)
    })
    expect(out.env).toEqual({ CLAUDE_WATCHER_MEMORY: '1' })
    expect(out.appendPrompt).not.toContain('A block that starts with')
    expect([seen.injected.length, seen.recallModes, seen.launchedCalls]).toEqual([
      1,
      [['s1', { mode: 'launch', reason: 'claude_too_old' }]],
      []
    ])
  })

  it('with memory off the mod is never asked for and no recall mode is kept', () => {
    let asked = 0
    const { deps, seen } = setup({
      enabled: () => false,
      recallMod: () => {
        asked += 1
        return { dir: '/x' }
      }
    })
    expect(memorySpawnExtras(deps, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
    expect([asked, seen.recallModes, seen.launchedCalls]).toEqual([0, [], []])
  })

  it('a refused config write gives no mod either', () => {
    let asked = 0
    const { deps, seen } = setup({
      configs: { write: () => null, remove: () => undefined },
      recallMod: () => {
        asked += 1
        return { dir: '/x' }
      }
    })
    expect(memorySpawnExtras(deps, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
    expect([asked, seen.recallModes, seen.indexRows()]).toEqual([0, [], 0])
  })

  it('a throw in the mod branch leaves no token, no file and no mod', () => {
    const { deps, seen } = setup({
      recallMod: () => ({ dir: '/data/mods/watcher-memory' }),
      recall: {
        launched: () => {
          throw new Error('boom')
        }
      }
    })
    expect(memorySpawnExtras(deps, 's1', launch, null)).toEqual(NO_MEMORY_EXTRAS)
    expect([seen.revoked, seen.removed, seen.lines]).toEqual([
      ['s1'],
      ['s1'],
      ['[claude-watcher][memory] code=memory_launch_failed']
    ])
  })

  it('names the env var the mod reads', () => {
    expect(MEMORY_CONFIG_ENV).toBe('CLAUDE_WATCHER_MEMORY_CONFIG')
  })
})

describe('the memory mod’s token', () => {
  function server(): ReturnType<typeof createMemoryMcp> {
    const userData = mkdtempSync(join(tmpdir(), 'cw-memlaunch-mod-'))
    dirs.push(userData)
    return createMemoryMcp({
      dir: () => userData,
      report: () => undefined,
      enabled: () => true,
      store: () => null,
      session: () => null,
      names: { tagIdsByName: () => [], tagName: () => null, goalIdsByName: () => [] },
      tasks: () => null,
      commands: () => null,
      activity: createMemoryActivity(),
      now: () => NOW,
      log: () => undefined
    })
  }

  /** A mod session spawned on `mcp`'s own tokens and files; the bearer its env's file holds. */
  function spawnModSession(mcp: ReturnType<typeof createMemoryMcp>): {
    path: string
    bearer: string
  } {
    const { deps } = setup({
      tokens: mcp.tokens,
      configs: mcp.configs,
      recallMod: () => ({ dir: '/data/mods/watcher-memory' })
    })
    const path = memorySpawnExtras(deps, 's1', launch, null).env[MEMORY_CONFIG_ENV] ?? ''
    const file: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const bearer = String(
      (file as { mcpServers: Record<string, { headers: { Authorization: string } }> }).mcpServers[
        'claude-watcher-memory'
      ]?.headers.Authorization
    )
    return { path, bearer }
  }

  it('the file the env names holds the memory server’s own token for the session', () => {
    const mcp = server()
    const { bearer } = spawnModSession(mcp)
    expect(mcp.tokens.resolve(bearer.slice('Bearer '.length))).toEqual({ sessionId: 's1' })
  })

  it('after a /clear rebind the mod’s file stays and its token calls as the new id', () => {
    const mcp = server()
    const { path, bearer } = spawnModSession(mcp)
    mcp.tokens.rebind('s1', 's2')
    mcp.configs.rebind('s1', 's2')
    expect([existsSync(path), mcp.tokens.resolve(bearer.slice('Bearer '.length))]).toEqual([
      true,
      { sessionId: 's2' }
    ])
  })

  it('a removed card revokes the token and deletes the file the mod reads', () => {
    const mcp = server()
    const { path, bearer } = spawnModSession(mcp)
    mcp.tokens.rebind('s1', 's2')
    mcp.configs.rebind('s1', 's2')
    mcp.tokens.revoke('s2')
    mcp.configs.remove('s2')
    expect([existsSync(path), mcp.tokens.resolve(bearer.slice('Bearer '.length))]).toEqual([
      false,
      null
    ])
  })
})
