// Story 4.2 (FR-14) — unit tests for the liveness compute (main-unit / node project).
//
// Proves (via DI-injected fakes — no real node-pty / Electron, AR-11):
//   (a) External (non-launched) sessions are EXCLUDED from the result.
//   (b) `Working` sessions count toward `workingCount`; Connecting/`needs-you`/`idle`
//       are live but NOT working (workingCount unchanged).
//   (c) Empty intersection → total === 0, workingCount === 0, sessions === [] (the
//       no-prompt path that skips the guard).
//   (d) Identity keyed by `id` (never pid).
//   (e) Merges across multiple reducer windows; deduplication by id.
//   (f) Unknown status → `needs-you` (fail-toward-attention, not Working).
//
// Mirrors badge.test.ts's launched∩map∩classifier assertion style.
// [Source: story 4.2 Task 6.2; src/main/kde/badge.test.ts precedent; AR-11]

import { describe, it, expect } from 'vitest'
import { computeLiveLaunchedSessions, type ReducerLike } from './computeLiveLaunchedSessions'
import type { Session } from '../../shared/schemas/session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Session (only the fields the compute reads). */
function session(id: string, status: string): Session {
  return { id, status, sessionName: `sess-${id}`, projectPath: `/p/${id}`, pid: 1 }
}

/** Build a fake reducer with a given map of [id, status] pairs. */
function fakeReducer(pairs: ReadonlyArray<readonly [string, string]>): ReducerLike {
  const m = new Map<string, Session>()
  for (const [id, status] of pairs) m.set(id, session(id, status))
  return { snapshotMap: () => m }
}

/** All-launched predicate (every id is app-launched). */
const allLaunched = (): boolean => true

/** Build a launched predicate from an explicit id set. */
function launchedFrom(ids: ReadonlyArray<string>): (id: string) => boolean {
  const set = new Set(ids)
  return (id) => set.has(id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeLiveLaunchedSessions — empty cases', () => {
  it('empty reducer → total === 0, workingCount === 0, sessions === []', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(0)
    expect(result.workingCount).toBe(0)
    expect(result.sessions).toHaveLength(0)
  })

  it('no reducers at all → total === 0 (nothing live)', () => {
    const result = computeLiveLaunchedSessions({ reducers: [], isLaunched: allLaunched })
    expect(result.total).toBe(0)
    expect(result.workingCount).toBe(0)
    expect(result.sessions).toHaveLength(0)
  })

  it('sessions present but NONE launched → total === 0 (external sessions excluded)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [
        fakeReducer([
          ['ext-1', 'Working'],
          ['ext-2', 'NeedsAttention']
        ])
      ],
      isLaunched: () => false // nothing launched
    })
    expect(result.total).toBe(0)
    expect(result.workingCount).toBe(0)
    expect(result.sessions).toHaveLength(0)
  })
})

describe('computeLiveLaunchedSessions — column classification', () => {
  it('Working launched session → total 1, workingCount 1', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['a', 'Working']])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(1)
    expect(result.workingCount).toBe(1)
    expect(result.sessions[0]).toMatchObject({ id: 'a', column: 'working' })
  })

  it('Connecting launched session → total 1, workingCount 0 (a fresh spawn is idle, nothing to lose)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['b', 'Connecting']])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(1)
    expect(result.workingCount).toBe(0)
    expect(result.sessions[0]).toMatchObject({ id: 'b', column: 'idle' })
  })

  it('NeedsAttention launched session → total 1, workingCount 0 (needs-you is live, not working)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['c', 'NeedsAttention']])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(1)
    expect(result.workingCount).toBe(0)
    expect(result.sessions[0]).toMatchObject({ id: 'c', column: 'needs-you' })
  })

  it('WaitingForInput launched session → total 1, workingCount 0 (idle is live, not working)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['d', 'WaitingForInput']])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(1)
    expect(result.workingCount).toBe(0)
    expect(result.sessions[0]).toMatchObject({ id: 'd', column: 'idle' })
  })

  it('unknown status → needs-you (fail-toward-attention, NOT Working)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['e', 'SomeFutureStatus']])],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(1)
    expect(result.workingCount).toBe(0)
    expect(result.sessions[0]).toMatchObject({ id: 'e', column: 'needs-you' })
  })
})

describe('computeLiveLaunchedSessions — mixed launched + external', () => {
  it('only the LAUNCHED subset is counted; external sessions skipped', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [
        fakeReducer([
          ['launched-1', 'Working'],
          ['external-2', 'NeedsAttention'], // NOT launched
          ['launched-3', 'WaitingForInput']
        ])
      ],
      isLaunched: launchedFrom(['launched-1', 'launched-3'])
    })
    expect(result.total).toBe(2)
    expect(result.workingCount).toBe(1)
    const ids = result.sessions.map((s) => s.id).sort()
    expect(ids).toEqual(['launched-1', 'launched-3'])
  })

  it('mixed Working + needs-you + idle → correct workingCount', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [
        fakeReducer([
          ['a', 'Working'],
          ['b', 'Connecting'],
          ['c', 'NeedsPermission'],
          ['d', 'WaitingForInput']
        ])
      ],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(4)
    expect(result.workingCount).toBe(1) // only Working — Connecting is idle now
  })
})

describe('computeLiveLaunchedSessions — multi-window merge', () => {
  it('merges maps across two reducer windows; deduplicates by id', () => {
    const r1 = fakeReducer([
      ['a', 'Working'],
      ['b', 'NeedsAttention']
    ])
    const r2 = fakeReducer([
      ['b', 'NeedsAttention'],
      ['c', 'WaitingForInput']
    ]) // 'b' duplicated
    const result = computeLiveLaunchedSessions({
      reducers: [r1, r2],
      isLaunched: allLaunched
    })
    expect(result.total).toBe(3) // a, b, c — not 4
    expect(result.workingCount).toBe(1) // only 'a'
    const ids = result.sessions.map((s) => s.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

describe('computeLiveLaunchedSessions — identity by id, never pid', () => {
  it('result sessions carry the stable id (never pid)', () => {
    const result = computeLiveLaunchedSessions({
      reducers: [fakeReducer([['uuid-abc', 'Working']])],
      isLaunched: allLaunched
    })
    const s = result.sessions[0]
    expect(s).toBeDefined()
    if (s) {
      expect(s.id).toBe('uuid-abc')
      // No pid field on LiveLaunchedSession (identity = id)
      expect(Object.prototype.hasOwnProperty.call(s, 'pid')).toBe(false)
    }
  })
})
