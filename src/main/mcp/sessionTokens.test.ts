// The per-session MCP bearer tokens any of the app's MCP servers uses: one live token per session,
// memory only, resolved to the grant it was minted for.
import { describe, it, expect } from 'vitest'
import { createSessionTokens } from './sessionTokens'

interface TestGrant {
  sessionId: string
  workspaceId: string
}

const grant = (sessionId: string): TestGrant => ({ sessionId, workspaceId: 'w1' })

describe('session tokens', () => {
  it('mint then resolve returns the grant the token was minted for', () => {
    const tokens = createSessionTokens<TestGrant>()
    const token = tokens.mint(grant('sess-a'))
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(tokens.resolve(token)).toEqual(grant('sess-a'))
  })

  it('a second mint for the same session replaces the first token', () => {
    const tokens = createSessionTokens<TestGrant>()
    const first = tokens.mint(grant('sess-a'))
    const second = tokens.mint({ sessionId: 'sess-a', workspaceId: 'w2' })
    expect(tokens.resolve(first)).toBeNull()
    expect(tokens.resolve(second)).toEqual({ sessionId: 'sess-a', workspaceId: 'w2' })
  })

  it('rebind keeps the token and rewrites the sessionId it calls as', () => {
    const tokens = createSessionTokens<TestGrant>()
    const token = tokens.mint(grant('sess-old'))
    tokens.rebind('sess-old', 'sess-new')
    expect(tokens.resolve(token)).toEqual(grant('sess-new'))
    tokens.revoke('sess-old')
    expect(tokens.resolve(token)).toEqual(grant('sess-new'))
  })

  it('revoke makes the token resolve to null', () => {
    const tokens = createSessionTokens<TestGrant>()
    const token = tokens.mint(grant('sess-a'))
    tokens.revoke('sess-a')
    expect(tokens.resolve(token)).toBeNull()
  })

  it('an unknown token resolves to null', () => {
    const tokens = createSessionTokens<TestGrant>(() => 'f'.repeat(64))
    tokens.mint(grant('sess-a'))
    expect(tokens.resolve('0'.repeat(64))).toBeNull()
    expect(tokens.resolve('')).toBeNull()
  })
})
