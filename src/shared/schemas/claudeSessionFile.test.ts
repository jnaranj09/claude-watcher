// Claude per-process session record — unit tests for the third fail-closed Zod boundary.
//
// Runs under the `unit` Vitest project (jsdom) — src/shared/schemas/ matches its glob.
//
// The happy-path shape is VERBATIM (minus operator content) from a live file,
// `~/.claude/sessions/<pid>.json` on claude 2.1.257 (2026-09-01). The file carries far more
// than the two fields the app reads (cwd, name, status, socket path, …) — `.passthrough()`
// keeps them without the app depending on any of them.
//
// Every negative case is a FAULT-INJECTION target: dropping the matching constraint in
// claudeSessionFile.ts must turn it red.

import { describe, it, expect } from 'vitest'
import { ClaudeSessionFileSchema, parseClaudeSessionFile } from './claudeSessionFile'

const LIVE_SHAPE = {
  pid: 32969,
  sessionId: '95978bbd-0000-4000-8000-000000000001',
  startedAt: 1788288776000,
  version: '2.1.257',
  kind: 'interactive',
  entrypoint: 'cli',
  name: 'ZYPF',
  status: 'idle',
  cwd: '/home/operator/project'
}

describe('ClaudeSessionFileSchema — fail-closed boundary over ~/.claude/sessions/<pid>.json', () => {
  it('parses the live shape and keeps the fields it does not read (passthrough)', () => {
    const result = ClaudeSessionFileSchema.safeParse(LIVE_SHAPE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.pid).toBe(32969)
    expect(result.data.sessionId).toBe('95978bbd-0000-4000-8000-000000000001')
    expect((result.data as Record<string, unknown>)['name']).toBe('ZYPF')
  })

  it('fails closed on a blank sessionId (it is the identity key)', () => {
    expect(ClaudeSessionFileSchema.safeParse({ ...LIVE_SHAPE, sessionId: '' }).success).toBe(false)
  })

  it('fails closed on a missing sessionId', () => {
    const rest: Record<string, unknown> = { ...LIVE_SHAPE }
    delete rest['sessionId']
    expect(ClaudeSessionFileSchema.safeParse(rest).success).toBe(false)
  })

  it('fails closed on a pid that is not a positive integer', () => {
    expect(ClaudeSessionFileSchema.safeParse({ ...LIVE_SHAPE, pid: '32969' }).success).toBe(false)
    expect(ClaudeSessionFileSchema.safeParse({ ...LIVE_SHAPE, pid: 0 }).success).toBe(false)
    expect(ClaudeSessionFileSchema.safeParse({ ...LIVE_SHAPE, pid: 1.5 }).success).toBe(false)
  })
})

describe('parseClaudeSessionFile — the total, never-throwing reader over a parsed object', () => {
  it('returns the record for a valid object', () => {
    expect(parseClaudeSessionFile(LIVE_SHAPE)?.sessionId).toBe(LIVE_SHAPE.sessionId)
  })

  it('returns null (never throws) for non-objects and malformed records', () => {
    expect(parseClaudeSessionFile(null)).toBeNull()
    expect(parseClaudeSessionFile('not an object')).toBeNull()
    expect(parseClaudeSessionFile({ pid: 1 })).toBeNull()
  })
})

// Agent view (claude 2.1.291, 2026-10-06 drive runs): ← parks the conversation into a background
// job. The terminal's record gains `parkedJobId`; the job's record has `kind: "bg"` + `jobId`.
describe('ClaudeSessionFileSchema — agent-view fields (parked session)', () => {
  it('reads kind, jobId and parkedJobId when present', () => {
    const parked = parseClaudeSessionFile({ ...LIVE_SHAPE, parkedJobId: 'cda9ce2d' })
    expect(parked?.parkedJobId).toBe('cda9ce2d')
    expect(parked?.kind).toBe('interactive')
    const job = parseClaudeSessionFile({ ...LIVE_SHAPE, kind: 'bg', jobId: 'cda9ce2d' })
    expect(job?.kind).toBe('bg')
    expect(job?.jobId).toBe('cda9ce2d')
  })

  it('reads them as absent on a record that has none (every pre-agent-view record)', () => {
    const plain = parseClaudeSessionFile({ pid: 1, sessionId: 's' })
    expect(plain?.parkedJobId).toBeUndefined()
    expect(plain?.jobId).toBeUndefined()
    expect(plain?.kind).toBeUndefined()
  })

  it('keeps the record but drops a MALFORMED agent-view field (not parked, not a job)', () => {
    const odd = parseClaudeSessionFile({ ...LIVE_SHAPE, parkedJobId: 42, jobId: '', kind: {} })
    expect(odd?.sessionId).toBe(LIVE_SHAPE.sessionId)
    expect(odd?.parkedJobId).toBeUndefined()
    expect(odd?.jobId).toBeUndefined()
    expect(odd?.kind).toBeUndefined()
  })
})
