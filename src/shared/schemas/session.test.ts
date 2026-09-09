// The Session-shape behavioral checks (Story 0.2/0.3, trimmed in Story 6.4).
//
// The c9watch wire-boundary tests (list envelope, watch NDJSON line, id-keyed map +
// DuplicateSessionIdError) died with the CLI — those schemas are gone. What remains
// under test is the surviving `SessionSchema` (the reducer-storage + renderer
// contract) and its load-bearing policies:
//   1. TIMESTAMPS — strict ISO-8601 WITH tz offset, fails closed.
//   2. RE-PARSE — parse-once boundary (documented; not re-validated).
//   3. ID — blank id rejected at the schema.
//   4. PID — required int >= 0.
// Plus the original 0.2 policies (passthrough, status not enum-locked) AND the
// Story-0.3 polymorphic `pendingToolInput` correction (string AND object variants).
import { describe, it, expect } from 'vitest'
import { SessionSchema } from './session'

/** A minimal valid compact session (the always-present fields). */
const base = Object.freeze({
  id: 'a1b2c3',
  status: 'Working',
  projectPath: '/home/u/proj',
  pid: 1234,
  sessionName: 'my-session',
  workspaceId: 'default'
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

describe('Decision 3 — identity id (reject empty)', () => {
  it('rejects a blank id', () => {
    expect(ok({ ...base, id: '' })).toBe(false)
  })
  it('accepts a non-blank id', () => {
    expect(ok({ ...base, id: 'x' })).toBe(true)
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

describe('Workspaces — workspaceId is REQUIRED and fails closed on a blank one', () => {
  it('requires workspaceId and fails closed on a blank one', () => {
    const base = {
      id: 'abc',
      status: 'Working',
      projectPath: '/home/j/p',
      pid: 1,
      sessionName: 'p',
      workspaceId: 'default'
    }
    expect(SessionSchema.parse(base).workspaceId).toBe('default')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _drop, ...missing } = base
    expect(SessionSchema.safeParse(missing).success).toBe(false)
    expect(SessionSchema.safeParse({ ...base, workspaceId: '' }).success).toBe(false)
  })
})

describe('Original 0.2 policies (regression guard)', () => {
  it('passthrough admits unknown additions', () => {
    expect(ok({ ...base, brandNewField: 'x' })).toBe(true)
  })
  it('status is NOT enum-locked (a new status passes)', () => {
    expect(ok({ ...base, status: 'SomeFutureStatus' })).toBe(true)
  })
  it('a known-key malformation fails closed (status as number)', () => {
    expect(ok({ ...base, status: 5 })).toBe(false)
  })
})

describe('Story-0.3 — polymorphic pendingToolInput (string AND object variants)', () => {
  // Grounded in the live capture (2026-06-18): pendingToolInput is an OBJECT for
  // `pendingToolName: "Agent"` and a STRING for `Question`/others. Both MUST
  // validate; neither variant may fail-closed and drop the session.
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

describe('Dual timestamp precision + passthrough survival (Story 0.5 heritage)', () => {
  it('accepts MILLISECOND-precision modified (3 fractional digits, +00:00 offset)', () => {
    expect(ok({ ...base, modified: '2026-06-18T23:55:01.100+00:00' })).toBe(true)
  })
  it('accepts NANOSECOND-precision modified (9 fractional digits, +00:00 offset)', () => {
    expect(ok({ ...base, modified: '2026-06-19T02:53:59.581376035+00:00' })).toBe(true)
  })
  it('coerces a ms-precision modified to an epoch-millis number (parse-once transform)', () => {
    const r = SessionSchema.safeParse({ ...base, modified: '2026-06-18T23:55:01.100+00:00' })
    expect(r.success).toBe(true)
    expect(typeof (r.success ? r.data.modified : undefined)).toBe('number')
  })
  it('an undeclared addition survives onto the parsed value (fail-OPEN on additions)', () => {
    const r = SessionSchema.safeParse({ ...base, customTitle: 'epic0' })
    expect(r.success).toBe(true)
    expect(r.success ? (r.data as Record<string, unknown>).customTitle : undefined).toBe('epic0')
  })
})
