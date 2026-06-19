// Story 0.3 — the session-adapter behavioral checks, migrated to Vitest so the
// Stop hook's `vitest run` exercises the Story-0.2 Zod identity adapter (AC-4).
//
// This preserves the coverage of the zero-dep `tests/schema/session.check.mjs`
// (which stays in the repo as a belt-and-suspenders zero-dep gate) — the 4
// human-resolved Story-0.2 review decisions:
//   1. TIMESTAMPS — strict ISO-8601 WITH tz offset, fails closed.
//   2. RE-PARSE — parse-once boundary (documented; not re-validated).
//   3. ID KEYING — blank id rejected; duplicate id SIGNALS (DuplicateSessionIdError).
//   4. PID — required int >= 0.
// Plus the original 0.2 policies (passthrough, status not enum-locked, list
// wrapper not a bare array, watch NDJSON line) AND the Story-0.3 polymorphic
// `pendingToolInput` correction (string AND object variants validate).
// [Source: 0-2 File List (`tests/schema/session.check.mjs`); 0-2 Completion Notes]
import { describe, it, expect } from 'vitest'
import {
  SessionSchema,
  ListEnvelopeSchema,
  WatchLineSchema,
  keyById,
  parseListKeyedById,
  DuplicateSessionIdError
} from './session'

/** A minimal valid compact session (the always-present fields). */
const base = Object.freeze({
  id: 'a1b2c3',
  status: 'Working',
  projectPath: '/home/u/proj',
  pid: 1234,
  sessionName: 'my-session'
})

const ok = (input: unknown): boolean => SessionSchema.safeParse(input).success

describe('Decision 1 — strict ISO-8601 timestamps (fail closed)', () => {
  it('accepts ISO with Z offset', () => {
    expect(ok({ ...base, modified: '2024-01-15T10:00:00Z' })).toBe(true)
  })
  it('accepts ISO with ±HH:MM offset', () => {
    expect(ok({ ...base, modified: '2024-01-15T10:00:00+02:00' })).toBe(true)
  })
  it('accepts ISO with millisecond fraction', () => {
    expect(ok({ ...base, modified: '2024-01-15T10:00:00.123Z' })).toBe(true)
  })
  it('accepts ISO with nanosecond fraction (truncated to ms)', () => {
    expect(ok({ ...base, modified: '2024-01-15T10:00:00.123456789Z' })).toBe(true)
  })
  it('transforms the timestamp to an epoch-millis number', () => {
    const r = SessionSchema.safeParse({ ...base, modified: '2024-01-15T10:00:00Z' })
    expect(r.success).toBe(true)
    expect(typeof (r.success ? r.data.modified : undefined)).toBe('number')
  })
  it('rejects a tz-less ISO timestamp', () => {
    expect(ok({ ...base, modified: '2024-01-15T10:00:00' })).toBe(false)
  })
  it('rejects a bare year', () => {
    expect(ok({ ...base, modified: '2020' })).toBe(false)
  })
  it('rejects a free-form date', () => {
    expect(ok({ ...base, modified: 'Jan 1 2020' })).toBe(false)
  })
  it('rejects numeric junk', () => {
    expect(ok({ ...base, modified: '12345' })).toBe(false)
  })
  it('rejects garbage', () => {
    expect(ok({ ...base, modified: 'not-a-date' })).toBe(false)
  })
})

describe('Decision 3 — id keying (reject empty, signal on duplicate)', () => {
  it('rejects a blank id', () => {
    expect(ok({ ...base, id: '' })).toBe(false)
  })
  it('accepts a non-blank id', () => {
    expect(ok({ ...base, id: 'x' })).toBe(true)
  })
  it('THROWS DuplicateSessionIdError on duplicate ids', () => {
    const dup = [SessionSchema.parse(base), SessionSchema.parse({ ...base, pid: 5678 })]
    expect(() => keyById(dup)).toThrow(DuplicateSessionIdError)
  })
  it('keys unique ids without throwing (size 2)', () => {
    const unique = [SessionSchema.parse(base), SessionSchema.parse({ ...base, id: 'a2' })]
    expect(keyById(unique).size).toBe(2)
  })
})

describe('Decision 4 — pid int >= 0 (required)', () => {
  it('accepts pid 0', () => {
    expect(ok({ ...base, pid: 0 })).toBe(true)
  })
  it('accepts a positive int pid', () => {
    expect(ok({ ...base, pid: 1234 })).toBe(true)
  })
  it('rejects a float pid', () => {
    expect(ok({ ...base, pid: 1.5 })).toBe(false)
  })
  it('rejects a negative pid', () => {
    expect(ok({ ...base, pid: -1 })).toBe(false)
  })
  it('rejects NaN pid', () => {
    expect(ok({ ...base, pid: Number.NaN })).toBe(false)
  })
  it('rejects a missing pid (still required)', () => {
    expect(ok({ ...base, pid: undefined })).toBe(false)
  })
})

describe('Original 0.2 policies (regression guard)', () => {
  it('passthrough admits unknown additions', () => {
    expect(ok({ ...base, brandNewC9Field: 'x' })).toBe(true)
  })
  it('status is NOT enum-locked (a new status passes)', () => {
    expect(ok({ ...base, status: 'SomeFutureStatus' })).toBe(true)
  })
  it('a known-key malformation fails closed (status as number)', () => {
    expect(ok({ ...base, status: 5 })).toBe(false)
  })
  it('validates the list wrapper and keys by id (size 2)', () => {
    const list = {
      diagnostics: { claudeProcessesFound: 2, fdaLikelyNeeded: false, processesWithCwd: 2 },
      sessions: [base, { ...base, id: 'a2' }]
    }
    expect(ListEnvelopeSchema.safeParse(list).success).toBe(true)
    expect(parseListKeyedById(list).sessionsById.size).toBe(2)
  })
  it('rejects a bare array as a list (must be the wrapper)', () => {
    expect(ListEnvelopeSchema.safeParse([base]).success).toBe(false)
  })
  it('validates a watch NDJSON line and coerces its timestamp to epoch-millis', () => {
    const line = {
      event: 'changed',
      session: base,
      sessionId: 'a1b2c3',
      timestamp: '2024-01-15T10:00:00+02:00'
    }
    const r = WatchLineSchema.safeParse(line)
    expect(r.success).toBe(true)
    expect(typeof (r.success ? r.data.timestamp : undefined)).toBe('number')
  })
  it('rejects a watch line with a tz-less timestamp', () => {
    const line = {
      event: 'changed',
      session: base,
      sessionId: 'a1b2c3',
      timestamp: '2024-01-15T10:00:00'
    }
    expect(WatchLineSchema.safeParse(line).success).toBe(false)
  })
})

describe('Story-0.3 — polymorphic pendingToolInput (string AND object variants)', () => {
  // Grounded in the live c9watch 0.8.1 capture (2026-06-18): pendingToolInput is
  // an OBJECT for `pendingToolName: "Agent"` and a STRING for `Question`/others.
  // Both MUST validate; neither variant may fail-closed and drop the session.
  it('accepts a STRING pendingToolInput (e.g. a Question session)', () => {
    expect(
      ok({ ...base, pendingToolName: 'Question', pendingToolInput: 'Which file should I edit?' })
    ).toBe(true)
  })
  it('accepts an OBJECT pendingToolInput (e.g. an Agent session)', () => {
    expect(
      ok({
        ...base,
        pendingToolName: 'Agent',
        pendingToolInput: {
          description: 'Implement story 0.3',
          prompt: 'Run the dev-story workflow',
          subagent_type: 'general-purpose'
        }
      })
    ).toBe(true)
  })
  it('accepts an absent pendingToolInput (still optional)', () => {
    expect(ok({ ...base })).toBe(true)
  })
})
