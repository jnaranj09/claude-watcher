// The per-launch MCP bearer tokens (spec 2026-10-19 goals, Decisions: one token per launch, memory
// only, says which session calls and in which mode).
import { describe, it, expect } from 'vitest'
import { createGoalTokens, type Grant } from './goalTokens'

const worker = (sessionId: string): Grant => ({ sessionId, workspaceId: 'w1', mode: 'worker' })

describe('goal tokens', () => {
  it('resolve returns the grant for its token and null for any other', () => {
    const tokens = createGoalTokens()
    const a = tokens.mint(worker('sess-a'))
    const b = tokens.mint(worker('sess-b'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(tokens.resolve(a)).toEqual(worker('sess-a'))
    expect(tokens.resolve(b)).toEqual(worker('sess-b'))
    expect(tokens.resolve('0'.repeat(64))).toBeNull()
    expect(tokens.resolve('')).toBeNull()
    expect(tokens.resolve(a.slice(0, 63))).toBeNull()
  })

  it('rebind moves the grant', () => {
    const tokens = createGoalTokens()
    const token = tokens.mint(worker('sess-old'))
    tokens.rebind('sess-old', 'sess-new')
    expect(tokens.resolve(token)).toEqual(worker('sess-new'))
    expect(tokens.markDoneFor('sess-new')).toBe(true)
    expect(tokens.markDoneFor('sess-old')).toBe(false)
  })

  it('revoke drops it', () => {
    const tokens = createGoalTokens()
    const token = tokens.mint(worker('sess-a'))
    tokens.revoke('sess-a')
    expect(tokens.resolve(token)).toBeNull()
  })

  it('a new mint for the same session replaces its old token', () => {
    const tokens = createGoalTokens()
    const first = tokens.mint(worker('sess-a'))
    const second = tokens.mint(worker('sess-a'))
    expect(tokens.resolve(first)).toBeNull()
    expect(tokens.resolve(second)).toEqual(worker('sess-a'))
  })

  it('markDoneFor remembers a worker grant past its revoke, and never a planner', () => {
    const tokens = createGoalTokens()
    tokens.mint(worker('sess-a'))
    tokens.revoke('sess-a')
    tokens.mint({ sessionId: 'sess-p', workspaceId: 'w1', mode: 'planner', goalId: 'g1' })
    expect(tokens.markDoneFor('sess-a')).toBe(true)
    expect(tokens.markDoneFor('sess-p')).toBe(false)
    expect(tokens.markDoneFor('sess-never')).toBe(false)
  })
})
