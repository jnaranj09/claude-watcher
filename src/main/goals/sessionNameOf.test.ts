// The session name a planner prompt shows (spec 2026-11-18 memory session goals, "Planner prompt").
import { describe, expect, it } from 'vitest'
import type { PastSession } from '../../shared/schemas/pastSession'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'
import { sessionNameOf } from './sessionNameOf'

const record = (name: string): PastSession => ({
  id: 's1',
  name,
  cwd: '/work',
  workspaceId: 'w1',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
})

const deps = (
  live: string | undefined,
  past: PastSession | null = null
): Parameters<typeof sessionNameOf>[0] => ({ liveName: () => live, record: () => past })

describe('sessionNameOf', () => {
  it('the live card name wins over the record', () => {
    expect(sessionNameOf(deps('build', record('old')), 's1')).toBe('build')
  })

  it('a live name holding a line break or an escape gets a space for each', () => {
    expect(sessionNameOf(deps('fix\nlogin'), 's1')).toBe('fix login')
    expect(sessionNameOf(deps('red\u001b[31m text'), 's1')).toBe('red [31m text')
  })

  it('a 500-character title is cut to the session name limit', () => {
    expect(sessionNameOf(deps('a'.repeat(500)), 's1')).toBe('a'.repeat(SESSION_NAME_MAX_LENGTH))
  })

  it('a name of only control characters is null', () => {
    expect(sessionNameOf(deps('\u0001\n\u001b '), 's1')).toBeNull()
  })

  it('the record name is used when the card has none, or an empty one', () => {
    expect(sessionNameOf(deps(undefined, record('billing api')), 's1')).toBe('billing api')
    expect(sessionNameOf(deps('', record('billing api')), 's1')).toBe('billing api')
  })

  it('no card and no record: null', () => {
    expect(sessionNameOf(deps(undefined), 's1')).toBeNull()
    expect(sessionNameOf(deps(''), 's1')).toBeNull()
  })
})
