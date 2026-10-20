// What a card carries beside the reducer, and must follow when the card moves (`/clear` re-keys
// it) or leaves: its pending rename, its Context setup (spec 2026-10-18 §7), and its goal task
// links, MCP token and `--mcp-config` file (spec 2026-10-19 goals).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dropCardState, moveCardState } from './cardState'
import { createGoalsStore } from '../persistence/goals'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { createMcpConfigs } from '../goals/mcp/mcpConfigFile'

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
  mcpConfigs: ReturnType<typeof createMcpConfigs>
} {
  const userData = mkdtempSync(join(tmpdir(), 'cw-card-'))
  dir = userData
  return {
    pendingTitles: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    sessionSetup: { rebind: vi.fn<Rebind>(), forget: vi.fn<Forget>() },
    goals: createGoalsStore(),
    tokens: createGoalTokens(),
    mcpConfigs: createMcpConfigs({ dir: () => userData, log: () => {}, report: () => {} })
  }
}

describe('card state', () => {
  it('moves the pending rename and the Context setup to the new id', () => {
    const d = deps()
    moveCardState(d, 'old', 'new')
    expect(d.pendingTitles.rebind).toHaveBeenCalledWith('old', 'new')
    expect(d.sessionSetup.rebind).toHaveBeenCalledWith('old', 'new')
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
})
