// What a card carries beside the reducer, and must follow when the card moves (`/clear` re-keys
// it) or leaves: its pending rename, its Context setup (spec 2026-10-18 §7), and its goal task
// links, MCP token and `--mcp-config` file (spec 2026-10-19 goals), and its memory token, config
// file, activity record, recall window and the origin of the items it saved (spec 2026-11-11
// memory, phase 3 recall).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { META, createHarness, prompt, said, stops } from '../../__fixtures__/extractorHarness'
import { dropCardState, moveCardState } from './cardState'
import { routeHookEnd } from './memorySavePoints'
import { createGoalsStore } from '../persistence/goals'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { MCP_SERVER_NAME, createMcpConfigs } from '../goals/mcp/mcpConfigFile'
import { createProposals } from '../goals/proposals'
import { MEMORY_MCP_PATH, MEMORY_MCP_URL } from '../hooks/hookContract'
import { mcpRoute } from '../mcp/mcpEndpoint'
import { createMemoryActivity } from '../memory/memoryActivity'
import { openMemoryDb } from '../memory/memoryDb'
import { createMemoryMcp } from '../memory/memoryLaunch'
import { createMemoryCommands } from '../memory/memoryCommands'
import { createMemoryStore, type MemoryStore } from '../memory/memoryStore'
import type { MemorySessionMeta } from '../memory/memoryTools'

type Rebind = (oldId: string, newId: string) => void
type Forget = (id: string) => void

let dir: string | null = null
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

function deps(): Parameters<typeof moveCardState>[0] & {
  pendingTitles: {
    rebind: ReturnType<typeof vi.fn<Rebind>>
    forget: ReturnType<typeof vi.fn<Forget>>
  }
  sessionSetup: {
    rebind: ReturnType<typeof vi.fn<Rebind>>
    forget: ReturnType<typeof vi.fn<Forget>>
  }
  goals: ReturnType<typeof createGoalsStore>
  tokens: ReturnType<typeof createGoalTokens>
  proposals: ReturnType<typeof createProposals>
  mcpConfigs: ReturnType<typeof createMcpConfigs>
  memoryMcp: ReturnType<typeof createMemoryMcp>
  memoryTokens: ReturnType<typeof createMemoryMcp>['tokens']
  memoryActivity: ReturnType<typeof createMemoryActivity>
  memoryStore: MemoryStore
  memoryRecall: {
    rebind: ReturnType<typeof vi.fn<Rebind>>
    forget: ReturnType<typeof vi.fn<Forget>>
  }
  lines: string[]
} {
  const userData = mkdtempSync(join(tmpdir(), 'cw-card-'))
  dir = userData
  const open = openMemoryDb(':memory:', { now: () => 1, log: () => {} })
  if (!open.ok) throw new Error('open failed')
  let n = 0
  const memoryStore = createMemoryStore({
    db: open.db,
    now: () => 1,
    newId: () => `m${++n}`,
    report: () => {},
    log: () => {}
  })
  const memoryActivity = createMemoryActivity()
  const memoryMcp = createMemoryMcp({
    dir: () => userData,
    report: () => {},
    enabled: () => true,
    store: () => memoryStore,
    session: (id) => (id === 'old' || id === 'new' ? LIVE : null),
    names: { tagIdsByName: () => [], tagName: () => null, goalIdsByName: () => [] },
    tasks: () => null,
    commands: () => null,
    activity: memoryActivity,
    now: () => 1,
    log: () => {}
  })
  const lines: string[] = []
  return {
    pendingTitles: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    sessionSetup: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    goals: createGoalsStore(),
    tokens: createGoalTokens(),
    proposals: createProposals(() => {}),
    mcpConfigs: createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => {},
      report: () => {}
    }),
    memoryMcp,
    memoryTokens: memoryMcp.tokens,
    memoryConfigs: memoryMcp.configs,
    memoryActivity,
    memoryStore,
    memoryCommands: createMemoryCommands({ db: open.db, newId: () => `c${++n}` }),
    memoryExtract: null,
    memoryRecall: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    lines,
    log: (line) => lines.push(line)
  }
}

/** A live session the memory tools can see, under either id of a /clear. */
const LIVE: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/acme',
  sessionName: 'build',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

describe('card state', () => {
  it("a /clear moves a planner's proposal, and a removed planner card takes it away", () => {
    const d = deps()
    d.proposals.set({
      plannerSessionId: 'old',
      goalId: 'g',
      groups: [{ taskIds: ['t'], note: '' }]
    })
    moveCardState(d, 'old', 'new')
    expect(d.proposals.list().map((p) => p.plannerSessionId)).toEqual(['new'])
    dropCardState(d, 'old')
    expect(d.proposals.list()).toHaveLength(1)
    dropCardState(d, 'new')
    expect(d.proposals.list()).toEqual([])
  })

  it('moves the pending rename and the Context setup to the new id', () => {
    const d = deps()
    moveCardState(d, 'old', 'new')
    expect(d.pendingTitles.rebind).toHaveBeenCalledWith('old', 'new')
    expect(d.sessionSetup.rebind).toHaveBeenCalledWith('old', 'new')
  })

  it('a /clear moves the recall window with the other memory state', () => {
    const d = deps()
    moveCardState(d, 'old', 'new')
    expect(d.memoryRecall.rebind.mock.calls).toEqual([['old', 'new']])
  })

  it('a dropped card forgets its recall window', () => {
    const d = deps()
    dropCardState(d, 'gone')
    expect(d.memoryRecall.forget.mock.calls).toEqual([['gone']])
  })

  it('drops the pending rename and the Context setup of a removed card', () => {
    const d = deps()
    dropCardState(d, 'gone')
    expect(d.pendingTitles.forget).toHaveBeenCalledWith('gone')
    expect(d.sessionSetup.forget).toHaveBeenCalledWith('gone')
  })

  it('a /clear moves task links and the token', () => {
    const d = deps()
    const task = d.goals.saveTask({ workspaceId: 'w1', goalId: null, title: 'T' }).saved.id
    d.goals.linkMany([task], 'old')
    const token = d.tokens.mint({ sessionId: 'old', workspaceId: 'w1', mode: 'worker' })
    const path = d.mcpConfigs.write('old', token, 'http://127.0.0.1:1/mcp/goals') ?? ''
    moveCardState(d, 'old', 'new')
    expect(d.goals.tasksForSession('new').map((t) => t.id)).toEqual([task])
    expect(d.goals.tasksForSession('old')).toEqual([])
    expect(d.tokens.resolve(token)).toMatchObject({ sessionId: 'new' })
    // claude keeps the file it loaded; a later forget of the NEW id removes it.
    dropCardState(d, 'old')
    expect(existsSync(path)).toBe(true)
    dropCardState(d, 'new')
    expect(existsSync(path)).toBe(false)
  })

  it('forget revokes the token and removes the config file', () => {
    const d = deps()
    const token = d.tokens.mint({ sessionId: 'gone', workspaceId: 'w1', mode: 'worker' })
    const path = d.mcpConfigs.write('gone', token, 'http://127.0.0.1:1/mcp/goals') ?? ''
    expect(existsSync(path)).toBe(true)
    dropCardState(d, 'gone')
    expect(d.tokens.resolve(token)).toBeNull()
    expect(existsSync(path)).toBe(false)
  })

  it('forget keeps the task links (a link to a gone session is hidden, not dropped)', () => {
    const d = deps()
    const task = d.goals.saveTask({ workspaceId: 'w1', goalId: null, title: 'T' }).saved.id
    d.goals.linkMany([task], 'gone')
    dropCardState(d, 'gone')
    expect(d.goals.tasksForSession('gone').map((t) => t.id)).toEqual([task])
  })

  it('a /clear moves the token, the config, the activity and the items to the new id', () => {
    const d = deps()
    const token = d.memoryTokens.mint({ sessionId: 'old' })
    const path = d.memoryMcp.configs.write('old', token, MEMORY_MCP_URL) ?? ''
    d.memoryActivity.injected('old', { chars: 40, itemIds: [] })
    const route = mcpRoute(MEMORY_MCP_PATH, d.memoryMcp.endpoint, () => {})
    const save = (key: string): unknown =>
      route.open(`Bearer ${token}`)?.({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'memory_save',
          arguments: { kind: 'specific', key, value: '4242', scope: 'workspace' }
        }
      })
    save('before clear')

    moveCardState(d, 'old', 'new')

    // The same claude keeps its loaded config: the same token now calls as the new id.
    expect(d.memoryTokens.resolve(token)).toEqual({ sessionId: 'new' })
    save('after clear')
    const origins = ['m1', 'm2'].map((id) => d.memoryStore.get(id)?.origin.sessionId)
    expect(origins).toEqual(['new', 'new'])
    expect(d.memoryActivity.get('new').injected).not.toBeNull()
    expect(d.memoryActivity.get('old').injected).toBeNull()
    dropCardState(d, 'old')
    expect(existsSync(path)).toBe(true)
    dropCardState(d, 'new')
    expect(existsSync(path)).toBe(false)
  })

  it('a removed card revokes its memory token and forgets its activity, and keeps its items', () => {
    const d = deps()
    const token = d.memoryTokens.mint({ sessionId: 'gone' })
    d.memoryActivity.injected('gone', { chars: 40, itemIds: [] })
    const item = d.memoryStore.add({
      text: { kind: 'specific', key: 'k', value: 'v' },
      workspaceId: 'w1',
      check: null,
      basis: 'stated',
      origin: { by: 'agent', sessionId: 'gone' },
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
    dropCardState(d, 'gone')
    expect(d.memoryTokens.resolve(token)).toBeNull()
    expect(d.memoryActivity.get('gone').injected).toBeNull()
    expect(d.memoryStore.get(item.id)?.origin.sessionId).toBe('gone')
  })

  it('a memory failure on /clear is logged by code and the rest of the card still moves', () => {
    const d = deps()
    d.memoryStore.rebindSession = () => {
      throw new Error('store_write_failed')
    }
    const token = d.memoryTokens.mint({ sessionId: 'old' })
    expect(() => moveCardState(d, 'old', 'new')).not.toThrow()
    expect(d.memoryTokens.resolve(token)).toEqual({ sessionId: 'new' })
    expect(d.pendingTitles.rebind).toHaveBeenCalledWith('old', 'new')
    expect(d.lines).toEqual(['[claude-watcher][memory] code=memory_rebind_failed'])
  })

  it('a /clear while memory is off moves the rest of the card', () => {
    const d = { ...deps(), memoryStore: null }
    expect(() => moveCardState(d, 'old', 'new')).not.toThrow()
    expect(d.sessionSetup.rebind).toHaveBeenCalledWith('old', 'new')
  })

  it('a /clear moves the save state and the commands to the new id', async () => {
    const h = createHarness()
    h.meta.set('old', META)
    h.ex.stop('old')
    h.commands.record({
      workspaceId: 'w1',
      folder: '/work/acme/shop',
      text: 'npm test',
      sessionId: 'old',
      at: 1
    })
    moveCardState(
      { ...deps(), memoryStore: h.store, memoryCommands: h.commands, memoryExtract: h.ex },
      'old',
      'new'
    )
    expect(h.state.get('old')?.originSessionId).toBe('new')
    expect(h.commands.markSessionDeleted('old', 2)).toBe(0)
    expect(h.commands.markSessionDeleted('new', 2)).toBe(1)
    await h.ex.idle()
  })

  it('the /clear path ends the old id before the rebind, so no end is missing', async () => {
    // R34. The feed's order: the kept SessionEnd (reason clear) of the OLD id is a save point while
    // the card still holds that id; the rebind comes later, when a hook of the new id adopts it.
    const h = createHarness()
    h.meta.set('old', META)
    h.write('old', prompt('the api now listens on port 9281'), said('moved it'), prompt('ok'))
    stops(h, 'old', 2)
    // The card moves with the rebind: from here only the new id has a stamp.
    const moveCard = {
      rebind: (oldId: string, newId: string): void => {
        h.meta.delete(oldId)
        h.meta.set(newId, META)
        h.ex.rebind(oldId, newId)
      }
    }
    // The feed's end of the hook callback for the kept `SessionEnd` (reason clear) of the old id.
    routeHookEnd({
      sessionId: 'old',
      evt: { hook_event_name: 'SessionEnd', reason: 'clear' },
      removed: true,
      knownLaunched: true,
      keep: () => true,
      archive: () => undefined,
      apply: () => undefined,
      extractor: h.ex,
      log: () => undefined
    })
    // Later: the new id's first hook adopts the card.
    moveCardState({ ...deps(), memoryExtract: moveCard }, 'old', 'new')
    await h.ex.idle()
    expect(h.logs).not.toContain('[claude-watcher][memory] code=memory_extract_end_missing')
    expect(h.calls).toHaveLength(1)
    expect(h.state.get('old')?.phase).toBe('done')
    expect(h.setMemory).toHaveBeenLastCalledWith(
      'old',
      expect.objectContaining({ state: 'nothing' })
    )
  })
})
