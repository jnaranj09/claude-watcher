// Story 0.3 — the AC-3 FAIL-CLOSED fixture-replay test (the load-bearing test).
//
// The real reducer/store does NOT exist yet (Epic 1), so this exercises the parse
// BOUNDARY that DOES exist — the Story-0.2 Zod adapter (`parseListKeyedById` +
// `WatchLineSchema` from src/shared/schemas/session.ts). It replays the fake feed
// through a small in-test "apply loop" (a stand-in for the future reducer) and
// asserts the fail-closed contract:
//
//   - the ONE malformed line is DROPPED (it never enters the map, never throws out
//     of the loop),
//   - a log collector is called EXACTLY ONCE, with the error PATH + CODE only —
//     NEVER the raw line value (Critical Guardrail #6 / 0-2 Guardrail #6: a
//     ZodError stringifies its input and can leak PTY content / secrets),
//   - the map still reflects ALL the valid sessions (one bad line does not poison
//     the good ones),
//   - no crash.
//
// This IS the AC-3 deliverable AND pre-builds the exact fail-closed assertion
// Epic-1 Story 1.1 will reuse against the REAL reducer. [Source: epics.md#Story 0.3
// AC-3; architecture.md#Testing & Test Seams ("malformed NDJSON line between two
// good → store == 2 sessions, log called once, no crash"); #Process Patterns
// (fail-closed per-boundary #1; never-log-parsed-value)]
import { describe, it, expect, vi } from 'vitest'
import { parseListKeyedById, WatchLineSchema, type Session } from '../shared/schemas/session'
import {
  fakeListSnapshot,
  fakeWatchLines,
  MALFORMED_LINE_INDEX,
  VALID_WATCH_LINE_COUNT,
  C9WATCH_FIXTURE_VERSION
} from './fakeC9watchFeed'

/** A single error-path record — PATH + CODE only, NEVER the parsed/raw value. */
interface BoundaryErrorRecord {
  /** Where the failure happened in the input (Zod issue path joined by '.'). */
  path: string
  /** The Zod issue code (e.g. 'invalid_type') OR 'invalid_json' for non-JSON. */
  code: string
}

/** Result of the apply loop — the keyed map plus the injected-clock stamp of the
 * last applied delta (proves the `now()` seam is wired deterministically). */
interface ApplyResult {
  map: Map<string, Session>
  /** Epoch-millis (from the injected clock) at which the last delta was applied. */
  lastAppliedAt: number | null
}

/**
 * The in-test "apply loop" — a stand-in for the Epic-1 reducer. Folds raw NDJSON
 * lines into a Map keyed by session `id`, dropping + logging (by path+code only)
 * any line that is not valid JSON or fails the schema. Takes an INJECTED `now()`
 * clock (per the architecture's "inject now() for epoch-millis determinism") and
 * stamps each applied delta with it — exactly what the Epic-1 reducer will do.
 * FAIL-CLOSED, never throws.
 */
function applyWatchLines(
  initial: Map<string, Session>,
  lines: readonly string[],
  log: (err: BoundaryErrorRecord) => void,
  now: () => number = () => Date.now()
): ApplyResult {
  const map = new Map(initial)
  let lastAppliedAt: number | null = null
  for (const line of lines) {
    // 1) JSON boundary — a corrupt/truncated line is dropped + logged by path.
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(line)
    } catch {
      // NEVER log `line` — log path + code only.
      log({ path: '(line)', code: 'invalid_json' })
      continue
    }
    // 2) Schema boundary — validate via the real Story-0.2 adapter.
    const result = WatchLineSchema.safeParse(parsedJson)
    if (!result.success) {
      // Log the FIRST issue's path + code only — never `result.error` (it carries
      // the raw input) and never the line.
      const issue = result.error.issues[0]
      log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
      continue
    }
    // 3) Apply the validated delta to the keyed map; stamp via the injected clock.
    lastAppliedAt = now()
    const { event, session } = result.data
    if (event === 'stopped') {
      map.delete(session.id)
    } else {
      map.set(session.id, session)
    }
  }
  return { map, lastAppliedAt }
}

describe('AC-3 — fail-closed fixture replay against the real Zod adapter', () => {
  it('the fixture is schema-versioned (drift is a one-line bump)', () => {
    expect(C9WATCH_FIXTURE_VERSION).toBe('0.8.1')
  })

  it('parses the list snapshot wrapper and keys the sessions by id', () => {
    const { sessionsById, envelope } = parseListKeyedById(fakeListSnapshot)
    expect(sessionsById.size).toBe(fakeListSnapshot.sessions.length)
    // diagnostics survive (but their counts are illustrative — not asserted here).
    expect(typeof envelope.diagnostics.claudeProcessesFound).toBe('number')
    // Both polymorphic pendingToolInput variants survived the parse (fail-OPEN on
    // a real Agent object was the live bug; this proves it is fixed).
    const question = sessionsById.get('11111111-1111-4111-8111-111111111111')
    const agent = sessionsById.get('47c6a173-9fe0-4f73-a8fc-0421af3fea24')
    expect(typeof question?.pendingToolInput).toBe('string')
    expect(typeof agent?.pendingToolInput).toBe('object')
  })

  it('drops the one malformed line, logs once by path+code, keeps the valid ones, no crash', () => {
    const { sessionsById } = parseListKeyedById(fakeListSnapshot)
    const sizeBefore = sessionsById.size

    const log = vi.fn<(err: BoundaryErrorRecord) => void>()

    // The fixture has exactly one malformed line, interleaved between good ones.
    expect(typeof fakeWatchLines[MALFORMED_LINE_INDEX]).toBe('string')

    const FIXED_NOW = 1_750_000_000_000
    let result: ApplyResult | undefined
    expect(() => {
      // Deterministic clock injected — no wall-clock dependence.
      result = applyWatchLines(sessionsById, fakeWatchLines, log, () => FIXED_NOW)
    }).not.toThrow() // no crash

    // The malformed line was dropped → log called EXACTLY once.
    expect(log).toHaveBeenCalledTimes(1)

    // It logged PATH + CODE only — and the raw malformed line never leaked.
    const logged = log.mock.calls[0]?.[0]
    expect(logged).toBeDefined()
    expect(typeof logged?.path).toBe('string')
    expect(typeof logged?.code).toBe('string')
    // STRUCTURAL guarantee (stronger than substring-scanning): the record carries
    // ONLY {path, code} — no field that could carry the raw line/parsed value. This
    // holds regardless of WHICH boundary failed (invalid_json vs a schema issue
    // whose path could itself contain a field name like "event"). [Review finding #2]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).not.toContain('44444444-4444-4444') // the raw bad-line fragment

    // The injected clock drove the apply stamp deterministically (the seam Epic-1
    // reuses): the last applied delta is stamped with our fixed `now()`.
    expect(result?.lastAppliedAt).toBe(FIXED_NOW)

    // The store still reflects the valid sessions (fail-closed: one bad line does
    // not poison the good ones). Deltas applied:
    //   [0] changed dashboard (still present, updated)
    //   [2] started api (new → present)
    //   [3] stopped auth-service (removed)
    const map = (result as ApplyResult).map
    expect(map.has('22222222-2222-4222-8222-222222222222')).toBe(true) // dashboard updated
    expect(map.get('22222222-2222-4222-8222-222222222222')?.status).toBe('NeedsAttention')
    expect(map.has('55555555-5555-4555-8555-555555555555')).toBe(true) // api started
    expect(map.has('11111111-1111-4111-8111-111111111111')).toBe(false) // auth stopped
    // The Agent + dashboard sessions from the snapshot are untouched & present.
    expect(map.has('47c6a173-9fe0-4f73-a8fc-0421af3fea24')).toBe(true)

    // Net size: started +1, stopped -1 → unchanged vs the snapshot.
    expect(map.size).toBe(sizeBefore)
  })

  it('the fixture really exercises VALID_WATCH_LINE_COUNT good lines', () => {
    let valid = 0
    for (const line of fakeWatchLines) {
      try {
        if (WatchLineSchema.safeParse(JSON.parse(line)).success) valid += 1
      } catch {
        /* malformed JSON — counts as not-valid */
      }
    }
    expect(valid).toBe(VALID_WATCH_LINE_COUNT)
  })
})
