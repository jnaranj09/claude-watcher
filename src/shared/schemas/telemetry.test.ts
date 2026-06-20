// Story 3.5 — the versioned telemetry-schema tests (jsdom `unit` project).
//
// Asserts the OUR-shape fail-closed contract (the OPPOSITE of session.ts's
// additions-pass `.passthrough()`):
//   - a valid v1 shape round-trips through parseTelemetryEvent;
//   - the version field is present + literal-gated (a wrong version FAILS);
//   - a negative waitMs fails closed;
//   - an out-of-enum column (e.g. 'working') fails closed;
//   - missing fields fail closed;
//   - the IPC arg schema (TelemetryAcknowledgeSchema) validates correctly.
// [Source: story 3.5 Task 1.4; AC-2; .claude/rules/zod-boundaries.md]
import { describe, it, expect } from 'vitest'
import {
  TelemetryEventSchema,
  TelemetryAcknowledgeSchema,
  parseTelemetryEvent,
  TELEMETRY_VERSION,
  type TelemetryEvent
} from './telemetry'

const validEvent: TelemetryEvent = {
  version: 1,
  kind: 'idle-wait',
  sessionId: 'abc-123-uuid',
  column: 'needs-you',
  enteredColumnAt: 1000,
  acknowledgedAt: 5000,
  waitMs: 4000,
  launched: true
}

describe('TelemetryEventSchema — versioned, our-shape, fail-closed (AC-2)', () => {
  it('round-trips a valid v1 needs-you event', () => {
    const parsed = parseTelemetryEvent(validEvent)
    expect(parsed).toEqual(validEvent)
    expect(parsed.version).toBe(TELEMETRY_VERSION)
  })

  it('round-trips a valid v1 idle event', () => {
    const idleEvent: TelemetryEvent = { ...validEvent, column: 'idle' }
    const parsed = parseTelemetryEvent(idleEvent)
    expect(parsed.column).toBe('idle')
  })

  it('a WRONG version fails closed (literal-gated — migration seam)', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, version: 2 })
    expect(r.success).toBe(false)
  })

  it('a MISSING version fails closed', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { version: _v, ...noVersion } = validEvent
    const r = TelemetryEventSchema.safeParse(noVersion)
    expect(r.success).toBe(false)
  })

  it('a negative waitMs fails closed (clock/edge anomaly MUST be skipped, not stored)', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, waitMs: -1 })
    expect(r.success).toBe(false)
  })

  it('waitMs = 0 is accepted (instantaneous acknowledge is a valid edge)', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, waitMs: 0 })
    expect(r.success).toBe(true)
  })

  it('an out-of-enum column "working" fails closed (working never records)', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, column: 'working' })
    expect(r.success).toBe(false)
  })

  it('an unknown column string fails closed', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, column: 'unknown-column' })
    expect(r.success).toBe(false)
  })

  it('a missing sessionId field fails closed', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sessionId: _s, ...noSessionId } = validEvent
    const r = TelemetryEventSchema.safeParse(noSessionId)
    expect(r.success).toBe(false)
  })

  it('a blank sessionId fails closed (min 1 guard)', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, sessionId: '' })
    expect(r.success).toBe(false)
  })

  it('a missing kind field fails closed', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kind: _k, ...noKind } = validEvent
    const r = TelemetryEventSchema.safeParse(noKind)
    expect(r.success).toBe(false)
  })

  it('a wrong kind fails closed', () => {
    const r = TelemetryEventSchema.safeParse({ ...validEvent, kind: 'other-kind' })
    expect(r.success).toBe(false)
  })

  it('a non-object blob fails closed (corrupt JSON value)', () => {
    expect(TelemetryEventSchema.safeParse(null).success).toBe(false)
    expect(TelemetryEventSchema.safeParse('garbage').success).toBe(false)
    expect(TelemetryEventSchema.safeParse(42).success).toBe(false)
  })

  it('parseTelemetryEvent throws on invalid input (parse-and-throw)', () => {
    expect(() => parseTelemetryEvent({ ...validEvent, version: 99 })).toThrow()
  })
})

describe('TelemetryAcknowledgeSchema — IPC arg, cross-process, untrusted (AC-1)', () => {
  it('accepts a valid { sessionId, acknowledgedAt } arg', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ sessionId: 'abc-uuid', acknowledgedAt: 5000 })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.sessionId).toBe('abc-uuid')
      expect(r.data.acknowledgedAt).toBe(5000)
    }
  })

  it('a blank sessionId fails closed (min 1)', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ sessionId: '', acknowledgedAt: 5000 })
    expect(r.success).toBe(false)
  })

  it('a missing sessionId fails closed', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ acknowledgedAt: 5000 })
    expect(r.success).toBe(false)
  })

  it('a missing acknowledgedAt fails closed', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ sessionId: 'abc-uuid' })
    expect(r.success).toBe(false)
  })

  it('a non-positive acknowledgedAt fails closed', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ sessionId: 'abc-uuid', acknowledgedAt: 0 })
    expect(r.success).toBe(false)
  })

  it('a negative acknowledgedAt fails closed', () => {
    const r = TelemetryAcknowledgeSchema.safeParse({ sessionId: 'abc-uuid', acknowledgedAt: -1 })
    expect(r.success).toBe(false)
  })
})
