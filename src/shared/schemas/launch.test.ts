// Story 3.2 (FR-11) — the launch-arg schema fail-closed gate.
//
// The `session:launch` arg is UNTRUSTED cross-process input → parse-and-throw at the main
// boundary. These assert the our-shape fail-closed posture (NO `.passthrough()`): a valid
// `{ cwd }` parses; a blank/non-string/missing cwd fails closed. The never-log-the-value rule
// is enforced at the CALL SITE (the handler logs path/code only) — the schema just throws.
import { describe, it, expect } from 'vitest'
import { SessionLaunchSchema, LaunchCorrelatedSchema } from './launch'
import { CH } from '../ipc/contract'
import type { LaunchCorrelatedEvent } from '../ipc/contract'

describe('SessionLaunchSchema — the launch-arg fail-closed boundary (AC-6)', () => {
  it('accepts a valid non-empty cwd', () => {
    const r = SessionLaunchSchema.safeParse({ cwd: '/home/op/project' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.cwd).toBe('/home/op/project')
  })

  it('FAILS CLOSED on a blank cwd (mirrors SessionSchema.id / TerminalIdSchema)', () => {
    expect(SessionLaunchSchema.safeParse({ cwd: '' }).success).toBe(false)
  })

  it('FAILS CLOSED on a non-string cwd', () => {
    expect(SessionLaunchSchema.safeParse({ cwd: 42 }).success).toBe(false)
    expect(SessionLaunchSchema.safeParse({ cwd: null }).success).toBe(false)
  })

  it('FAILS CLOSED on a missing cwd', () => {
    expect(SessionLaunchSchema.safeParse({}).success).toBe(false)
  })

  it('THROWS (parse, not safeParse) on bad input so the handler rejects the invoke', () => {
    expect(() => SessionLaunchSchema.parse({ cwd: '' })).toThrow()
  })

  it('the parse error reports a PATH + CODE and does not require echoing the value', () => {
    const r = SessionLaunchSchema.safeParse({ cwd: 5 })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('cwd')
      expect(typeof issue?.code).toBe('string')
    }
  })
})

describe('Story 3.4 — CH.launchCorrelated channel + LaunchCorrelatedSchema (validate-at-source)', () => {
  it('the channel name is the lowercase domain:action const (no string literal)', () => {
    expect(CH.launchCorrelated).toBe('launch:correlated')
  })

  it('accepts a valid { terminalId, sessionId } binding', () => {
    const binding: LaunchCorrelatedEvent = {
      terminalId: 'launch-abc',
      sessionId: 'sess-uuid-1'
    }
    const r = LaunchCorrelatedSchema.safeParse(binding)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.terminalId).toBe('launch-abc')
      expect(r.data.sessionId).toBe('sess-uuid-1')
    }
  })

  it('FAILS CLOSED on a blank terminalId (the boundary never ships a half-formed binding)', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: '', sessionId: 's' }).success).toBe(false)
  })

  it('FAILS CLOSED on a blank sessionId', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 't', sessionId: '' }).success).toBe(false)
  })

  it('FAILS CLOSED on non-string / missing fields (our shape, no passthrough)', () => {
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 1, sessionId: 's' }).success).toBe(false)
    expect(LaunchCorrelatedSchema.safeParse({ terminalId: 't' }).success).toBe(false)
    expect(LaunchCorrelatedSchema.safeParse(null).success).toBe(false)
  })

  it('reports a PATH + CODE on a parse miss (never requires echoing the value)', () => {
    const r = LaunchCorrelatedSchema.safeParse({ terminalId: '', sessionId: 's' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues[0]
      expect(issue?.path.join('.')).toBe('terminalId')
      expect(typeof issue?.code).toBe('string')
    }
  })
})
