// Story 1.1 — the REAL c9watch reducer (main-unit / node project).
//
// Replaces the Story-0.3 in-test `applyWatchLines` stand-in (in
// src/__fixtures__/fakeC9watchFeed.test.ts) with tests against the PRODUCTION
// reducer. The same fail-closed boundary contract the stand-in asserted MUST hold
// here (that test stays green too); these tests additionally cover the three
// FROZEN reducer decisions (R1/R2/R3), the monotonic-epoch idempotent apply, and
// reconnect-no-drop. All deterministic: injected `now()`, the fake feed, no live
// claude. [Source: story 1.1 Tasks 2/3/6; .claude/rules/zod-boundaries.md]
import { describe, it, expect, vi } from 'vitest'
import { createReducer, type SessionDelta } from './reducer'
import {
  fakeListSnapshot,
  fakeWatchLines,
  MALFORMED_LINE_INDEX,
  VALID_WATCH_LINE_COUNT
} from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

/** A valid `started`/`changed`/`status_changed` watch line whose top-level sessionId === session.id. */
function watchLine(
  event: 'started' | 'changed' | 'status_changed',
  id: string,
  over: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    event,
    sessionId: id,
    timestamp: '2026-06-18T23:57:10.134+00:00',
    session: {
      id,
      status: 'Working',
      projectPath: '/home/u/projects/x',
      pid: 999,
      sessionName: 'x',
      ...over
    }
  })
}

/** A lean `stopped` line: a minimal body that does NOT satisfy the full SessionSchema. */
function leanStopLine(sessionId: string, innerId?: string): string {
  return JSON.stringify({
    event: 'stopped',
    sessionId,
    ...(innerId !== undefined ? { session: { id: innerId } } : {})
  })
}

describe('reducer — fail-closed boundary (mirrors fakeC9watchFeed.test.ts contract)', () => {
  it('seeds from the list snapshot, keyed by id, with a monotonic epoch', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const { deltas, epoch } = r.seedFromSnapshot(fakeListSnapshot)
    expect(r.size()).toBe(fakeListSnapshot.sessions.length)
    // every seeded session emits a session.updated delta at the new epoch
    expect(deltas).toHaveLength(fakeListSnapshot.sessions.length)
    expect(deltas.every((d) => d.event.type === 'session.updated')).toBe(true)
    expect(deltas.every((d) => d.epoch === epoch)).toBe(true)
    expect(epoch).toBeGreaterThan(0)
  })

  it('drops the one malformed line, logs once by path+code, keeps the valid ones, no crash', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const { sessionsById } = r.seedFromSnapshotRaw(fakeListSnapshot)
    const sizeBefore = sessionsById.size

    expect(typeof fakeWatchLines[MALFORMED_LINE_INDEX]).toBe('string')

    let crashed = false
    let totalDeltas = 0
    try {
      for (const line of fakeWatchLines) {
        totalDeltas += r.applyLine(line).length
      }
    } catch {
      crashed = true
    }
    expect(crashed).toBe(false) // no crash — one bad line never poisons the stream

    // exactly one malformed line → log called exactly once
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged).toBeDefined()
    // STRUCTURAL: the record carries ONLY {path, code} — never the raw line/value.
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    expect(typeof logged?.path).toBe('string')
    expect(typeof logged?.code).toBe('string')
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).not.toContain('44444444-4444-4444') // raw bad-line fragment never leaks

    // valid sessions survived: changed dashboard (updated), started api (added),
    // stopped auth (removed). Net size unchanged vs the snapshot.
    const map = r.snapshotMap()
    expect(map.has('22222222-2222-4222-8222-222222222222')).toBe(true)
    expect(map.get('22222222-2222-4222-8222-222222222222')?.status).toBe('NeedsAttention')
    expect(map.has('55555555-5555-4555-8555-555555555555')).toBe(true)
    expect(map.has('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(map.has('47c6a173-9fe0-4f73-a8fc-0421af3fea24')).toBe(true)
    expect(map.size).toBe(sizeBefore)

    // VALID_WATCH_LINE_COUNT good lines each produced at least one delta.
    expect(totalDeltas).toBeGreaterThanOrEqual(VALID_WATCH_LINE_COUNT)
  })

  it('a line that is valid JSON but NOT an object (null/array/primitive) is dropped, never throws (never-crash)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    // `null` is the dangerous one: reading `.event` off it throws a TypeError that
    // would escape applyLine (contract: NEVER throws) and crash the main process via
    // the unguarded stdout 'data' handler. Also cover array + bare primitives.
    for (const bad of ['null', '[]', '42', '"x"', 'true']) {
      let crashed = false
      let deltas: SessionDelta[] = []
      try {
        deltas = r.applyLine(bad)
      } catch {
        crashed = true
      }
      expect(crashed).toBe(false) // applyLine MUST NOT throw on a non-object line
      expect(deltas).toHaveLength(0) // dropped, nothing applied
    }
    expect(r.size()).toBe(0) // nothing was ever folded into the map
    // each bad line dropped + logged by {path, code} only — never the value.
    expect(log).toHaveBeenCalledTimes(5)
    for (const call of log.mock.calls) {
      expect(Object.keys(call[0] ?? {}).sort()).toEqual(['code', 'path'])
    }
  })

  it('never logs the raw value even on a SCHEMA failure (known-key malformation)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    // pid as a string → fails the schema on a KNOWN key (not a JSON syntax error).
    const bad = JSON.stringify({
      event: 'started',
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
      timestamp: '2026-06-18T23:57:10.134+00:00',
      session: {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        status: 'Working',
        projectPath: '/secret/leak-me',
        pid: 'NOT-A-NUMBER',
        sessionName: 'leak'
      }
    })
    const deltas = r.applyLine(bad)
    expect(deltas).toHaveLength(0) // dropped
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    // the raw value (projectPath etc.) must never appear in the log
    expect(JSON.stringify(log.mock.calls)).not.toContain('leak-me')
  })
})

describe('reducer — Decision R1 (unknown-id changed vs started)', () => {
  it('started UPSERTS a brand-new id (genuine birth)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'bbbbbbbb-0000-4000-8000-000000000001'
    const deltas = r.applyLine(watchLine('started', id))
    expect(r.snapshotMap().has(id)).toBe(true)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.updated')
  })

  it('changed for an UNKNOWN id is a desync → UPSERT + desync_healed log (Story 5.7, AC#1/#2)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'cccccccc-0000-4000-8000-000000000001'
    const deltas = r.applyLine(watchLine('changed', id))
    expect(deltas).toHaveLength(1) // one session.updated delta — card upserted
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.snapshotMap().has(id)).toBe(true) // card IS now in the map
    expect(r.snapshotMap().get(id)?.id).toBe(id)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.code).toBe('desync_healed') // heal observable, not a drop
    expect(logged?.path).toBe('(desync)')
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('changed for a KNOWN id is a normal update', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'dddddddd-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id, { status: 'Working' }))
    const deltas = r.applyLine(watchLine('changed', id, { status: 'WaitingForInput' }))
    expect(deltas).toHaveLength(1)
    expect(r.snapshotMap().get(id)?.status).toBe('WaitingForInput')
  })

  // Story 5.2 — status_changed is the real c9watch 0.8.1 event value for live transitions.
  it('status_changed for a KNOWN id updates the session → one session.updated delta (AC#1)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'eeee0001-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id, { status: 'Working' }))
    const deltas = r.applyLine(watchLine('status_changed', id, { status: 'NeedsAttention' }))
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.snapshotMap().get(id)?.status).toBe('NeedsAttention')
  })

  it('status_changed for an UNKNOWN id is a desync → UPSERT + desync_healed log (Story 5.7, AC#1/#2)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'ffff0001-0000-4000-8000-000000000001'
    const deltas = r.applyLine(watchLine('status_changed', id))
    expect(deltas).toHaveLength(1) // one session.updated delta — card upserted
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.snapshotMap().has(id)).toBe(true) // card IS now in the map
    expect(r.snapshotMap().get(id)?.id).toBe(id)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.code).toBe('desync_healed') // heal observable, not a drop
    expect(logged?.path).toBe('(desync)')
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  // Story 5.7 AC#4 — RESURRECTION: a stopped id re-appearing via status_changed is treated as
  // an unknown-id heal → upserted as a fresh card. This LOCKS the chosen post-stop behavior.
  // (The ship gate still protects the board: a resurrected non-launched id is dropped there.)
  it('status_changed for a PREVIOUSLY-STOPPED id is resurrected via desync heal → upsert + desync_healed log (AC#4)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'aaaa5700-0000-4000-8000-000000000001'

    // 1. Seed the session via started.
    r.applyLine(watchLine('started', id, { status: 'Working' }))
    expect(r.snapshotMap().has(id)).toBe(true)

    // 2. Stop it — the id is removed from the map.
    r.applyLine(leanStopLine(id, id))
    expect(r.snapshotMap().has(id)).toBe(false)

    // 3. A later status_changed for the same id — the heal path does NOT distinguish
    //    "never seen" from "seen-then-stopped". It treats it as an unknown-id and upserts.
    log.mockClear()
    const deltas = r.applyLine(watchLine('status_changed', id, { status: 'Working' }))
    expect(deltas).toHaveLength(1) // resurrected → one session.updated delta
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.snapshotMap().has(id)).toBe(true) // fresh card in the map
    expect(r.snapshotMap().get(id)?.id).toBe(id)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.code).toBe('desync_healed')
    expect(logged?.path).toBe('(desync)')
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  // Story 5.7 AC#3 — a KNOWN-id normal update does NOT emit a desync_healed log.
  it('status_changed for a KNOWN id emits NO desync_healed log (normal update path, AC#3)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'bbbb5700-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id, { status: 'Working' }))
    log.mockClear() // clear the implicit started log (none expected, but be explicit)
    const deltas = r.applyLine(watchLine('status_changed', id, { status: 'NeedsAttention' }))
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(log).not.toHaveBeenCalled() // NO desync_healed log for a known-id update
  })
})

describe('reducer — Decision R2 (lean stopped removes the card via top-level sessionId)', () => {
  it('a lean stopped line (body fails full SessionSchema) still DELETES via top-level sessionId', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'eeeeeeee-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id))
    expect(r.snapshotMap().has(id)).toBe(true)

    // lean stop: only { sessionId, event:'stopped', session:{id} } — fails the full schema
    const deltas = r.applyLine(leanStopLine(id, id))
    expect(r.snapshotMap().has(id)).toBe(false) // card removed (no lingering stale Done card)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
    expect(log).not.toHaveBeenCalled() // a valid lean stop is NOT a failure
  })

  it('a stopped line with NO session body at all still deletes via sessionId', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'ffffffff-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id))
    const deltas = r.applyLine(leanStopLine(id))
    expect(r.snapshotMap().has(id)).toBe(false)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
  })

  it('a stopped line with a blank/missing top-level sessionId is dropped + logged (nothing to delete)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const deltas = r.applyLine(JSON.stringify({ event: 'stopped', sessionId: '' }))
    expect(deltas).toHaveLength(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(Object.keys(log.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('stopping an id NOT in the map yields no delta (idempotent, not an error)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const deltas = r.applyLine(leanStopLine('99999999-0000-4000-8000-000000000001'))
    expect(deltas).toHaveLength(0) // nothing to remove → no delta
    expect(log).not.toHaveBeenCalled()
  })
})

describe('reducer — Decision R3 (sessionId ≠ session.id)', () => {
  it('started/changed with mismatched sessionId vs session.id is DROPPED + logged', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const routed = 'aaaa0000-0000-4000-8000-000000000001'
    const inner = 'bbbb0000-0000-4000-8000-000000000002'
    const line = JSON.stringify({
      event: 'started',
      sessionId: routed,
      timestamp: '2026-06-18T23:57:10.134+00:00',
      session: {
        id: inner,
        status: 'Working',
        projectPath: '/x',
        pid: 1,
        sessionName: 'x'
      }
    })
    const deltas = r.applyLine(line)
    expect(deltas).toHaveLength(0)
    expect(r.snapshotMap().has(routed)).toBe(false)
    expect(r.snapshotMap().has(inner)).toBe(false) // neither identity keyed
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.path).toBe('sessionId')
    expect(logged?.code).toBe('id_mismatch')
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('a stopped line still deletes off top-level sessionId on a mismatch, and logs the mismatch', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const routed = 'cccc0000-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', routed))
    expect(r.snapshotMap().has(routed)).toBe(true)
    // stopped where inner session.id disagrees with the routing sessionId
    const deltas = r.applyLine(leanStopLine(routed, 'dddd0000-0000-4000-8000-000000000002'))
    expect(r.snapshotMap().has(routed)).toBe(false) // deleted off the authoritative sessionId
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
    expect(log).toHaveBeenCalledTimes(1) // mismatch still logged
    expect(log.mock.calls[0]?.[0]?.code).toBe('id_mismatch')
  })
})

describe('reducer — Decision determinism (injected now drives the stamp/epoch)', () => {
  it('the apply stamp is the injected now(), not the wall clock', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.applyLine(watchLine('started', '12340000-0000-4000-8000-000000000001'))
    expect(r.lastAppliedAt()).toBe(FIXED_NOW)
  })
})

describe('reducer — Decision R2/R3 epoch idempotency + reconnect-no-drop (AC-2/AC-3)', () => {
  it('re-applying the SAME snapshot converges to the same map (idempotent) and bumps the epoch', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const first = r.seedFromSnapshot(fakeListSnapshot)
    const mapAfterFirst = new Map(r.snapshotMap())
    const second = r.seedFromSnapshot(fakeListSnapshot)
    // map is identical (same keys + same session identities) — convergence.
    expect([...r.snapshotMap().keys()].sort()).toEqual([...mapAfterFirst.keys()].sort())
    // epoch is strictly monotonic across reconciles.
    expect(second.epoch).toBeGreaterThan(first.epoch)
    // re-applying an UNCHANGED snapshot emits NO deltas (nothing changed).
    expect(second.deltas).toHaveLength(0)
  })

  it('reconcile diffs the fresh snapshot: removed sessions emit session.removed, new emit session.updated', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.seedFromSnapshot(fakeListSnapshot)
    // a fresh snapshot that DROPS the auth session and ADDS a new one.
    const fresh = {
      diagnostics: fakeListSnapshot.diagnostics,
      sessions: [
        ...fakeListSnapshot.sessions.filter((s) => s.id !== '11111111-1111-4111-8111-111111111111'),
        {
          id: 'newnewew-0000-4000-8000-000000000001',
          status: 'Working',
          projectPath: '/home/u/projects/new',
          pid: 850000,
          sessionName: 'new'
        }
      ]
    }
    const { deltas } = r.seedFromSnapshot(fresh)
    const removed = deltas.filter((d) => d.event.type === 'session.removed')
    const updated = deltas.filter((d) => d.event.type === 'session.updated')
    expect(removed.map((d) => d.event.id)).toContain('11111111-1111-4111-8111-111111111111')
    expect(updated.map((d) => d.event.id)).toContain('newnewew-0000-4000-8000-000000000001')
    expect(r.snapshotMap().has('11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(r.snapshotMap().has('newnewew-0000-4000-8000-000000000001')).toBe(true)
  })

  it('reconnect (watch exit → fresh list diff) loses NO transition: a stop missed across the gap is healed level-triggered', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    r.seedFromSnapshot(fakeListSnapshot)
    // Simulate: a session stopped DURING the gap (we never saw its `stopped` line).
    // The reconnect `list` no longer contains it → reconcile must REMOVE it.
    const afterGap = {
      diagnostics: fakeListSnapshot.diagnostics,
      sessions: fakeListSnapshot.sessions.filter(
        (s) => s.id !== '33333333-3333-4333-8333-333333333333'
      )
    }
    const { deltas } = r.seedFromSnapshot(afterGap)
    // the missed stop is recovered as a removal (level-triggered, not replayed).
    expect(
      deltas.some(
        (d) =>
          d.event.type === 'session.removed' &&
          d.event.id === '33333333-3333-4333-8333-333333333333'
      )
    ).toBe(true)
    expect(r.snapshotMap().has('33333333-3333-4333-8333-333333333333')).toBe(false)
  })

  it('a malformed list snapshot THROWS (per-boundary failure mode; caller reconnects/backs off)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    expect(() => r.seedFromSnapshot({ not: 'an envelope' })).toThrow()
  })

  it('deltas carry the current epoch so the renderer can discard stale ones', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const seed = r.seedFromSnapshot(fakeListSnapshot)
    const lineDeltas: SessionDelta[] = r.applyLine(
      watchLine('started', 'aaaa1111-0000-4000-8000-000000000001')
    )
    // a watch-line delta is stamped with the CURRENT (latest) epoch.
    expect(lineDeltas[0]?.epoch).toBe(seed.epoch)
  })
})

// ---------------------------------------------------------------------------
// Hook-status feature: applyHookStatus + authority-window guard in applyLine
// ---------------------------------------------------------------------------

describe('reducer — applyHookStatus (hook-status feature)', () => {
  it('hook Working sets status to Working + emits session.updated', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0001-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id, { status: 'WaitingForInput' }))

    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)
    expect(deltas).toHaveLength(1)
    const evt0 = deltas[0]?.event
    expect(evt0?.type).toBe('session.updated')
    if (evt0?.type === 'session.updated') expect(evt0.status).toBe('Working')
    // The map should reflect Working
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
  })

  it('hook WaitingForInput sets status + emits session.updated', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0002-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id, { status: 'Working' }))

    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'WaitingForInput' }, 10_000)
    expect(deltas).toHaveLength(1)
    const evt2 = deltas[0]?.event
    expect(evt2?.type).toBe('session.updated')
    if (evt2?.type === 'session.updated') expect(evt2.status).toBe('WaitingForInput')
  })

  it('hook removed emits session.removed and deletes from map', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0003-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id))

    const deltas = r.applyHookStatus(id, { kind: 'removed' }, 10_000)
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
    expect(r.snapshotMap().has(id)).toBe(false)
  })

  it('unknown session_id → [] + log { path: "(hook)", code: "hook_unknown_id" } (no upsert)', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000001'
    // id NOT in the map

    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)
    expect(deltas).toHaveLength(0) // no-op
    expect(r.snapshotMap().has(id)).toBe(false) // NOT upserted (deliberate divergence)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.path).toBe('(hook)')
    expect(logged?.code).toBe('hook_unknown_id')
    // Only {path, code} — no body/value
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('authority window: c9watch line arriving before expiry keeps hook status, merges other fields', () => {
    // Simulate: hook stamps Working at T=0 with WINDOW=10000.
    // A c9watch line arrives at T=5000 (within the window) with WaitingForInput.
    // Expected: status stays Working (hook wins), but other fields (e.g. projectPath) update.
    let currentTime = FIXED_NOW
    const r = createReducer({ now: () => currentTime })
    const id = 'hook0005-0000-4000-8000-000000000001'

    // Seed the session
    r.applyLine(watchLine('started', id, { status: 'Working', projectPath: '/old' }))

    // Hook fires at T=0: stamps Working + hookAuthorityUntil = T + 10000
    currentTime = FIXED_NOW
    r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)

    // c9watch line arrives at T=5000 (within window): reports WaitingForInput + new projectPath
    currentTime = FIXED_NOW + 5_000 // within the 10s window
    const line = watchLine('status_changed', id, { status: 'WaitingForInput', projectPath: '/new' })
    const deltas = r.applyLine(line)

    // Delta is emitted (the merge still produces an update)
    expect(deltas).toHaveLength(1)
    const evtMerge = deltas[0]?.event
    expect(evtMerge?.type).toBe('session.updated')
    // Hook status is PRESERVED (Working, not WaitingForInput)
    if (evtMerge?.type === 'session.updated') expect(evtMerge.status).toBe('Working')
    // Other fields are still updated (merge not suppress)
    expect(r.snapshotMap().get(id)?.projectPath).toBe('/new')
  })

  it('authority window: c9watch line arriving after expiry lets c9watch resume authority', () => {
    let currentTime = FIXED_NOW
    const r = createReducer({ now: () => currentTime })
    const id = 'hook0006-0000-4000-8000-000000000001'

    // Seed the session
    r.applyLine(watchLine('started', id, { status: 'Working' }))

    // Hook fires at T=0: stamps Working + window=10000
    currentTime = FIXED_NOW
    r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)

    // c9watch line arrives AFTER the window: T = FIXED_NOW + 15000
    currentTime = FIXED_NOW + 15_000 // window has expired
    const line = watchLine('status_changed', id, { status: 'WaitingForInput' })
    const deltas = r.applyLine(line)

    expect(deltas).toHaveLength(1)
    // c9watch resumes: WaitingForInput wins after the window
    const evtExpired = deltas[0]?.event
    if (evtExpired?.type === 'session.updated') expect(evtExpired.status).toBe('WaitingForInput')
    expect(r.snapshotMap().get(id)?.status).toBe('WaitingForInput')
  })

  it('hook stamps hookAuthorityUntil using the SAME injected now() clock (single clock)', () => {
    const nowValues: number[] = []
    let currentTime = FIXED_NOW
    const r = createReducer({
      now: () => {
        nowValues.push(currentTime)
        return currentTime
      }
    })
    const id = 'hook0007-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id))
    nowValues.length = 0 // reset after seed

    r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)
    // The now() was called; the stamp should be FIXED_NOW + 10000
    // We verify this indirectly: a c9watch line at T = FIXED_NOW + 9999 is still suppressed
    currentTime = FIXED_NOW + 9_999
    const deltas = r.applyLine(watchLine('status_changed', id, { status: 'WaitingForInput' }))
    const evtClock = deltas[0]?.event
    if (evtClock?.type === 'session.updated') expect(evtClock.status).toBe('Working') // still suppressed → hook wins
  })

  it('snapshotMap does not expose statusSource or hookAuthorityUntil to callers', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0008-0000-4000-8000-000000000001'
    r.applyLine(watchLine('started', id))
    r.applyHookStatus(id, { kind: 'status', status: 'Working' }, 10_000)

    const snap = r.snapshotMap()
    const session = snap.get(id) as Record<string, unknown>
    expect(session).toBeDefined()
    // Internal hook fields must NOT be visible on the public Session snapshot
    expect(Object.prototype.hasOwnProperty.call(session, 'statusSource')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(session, 'hookAuthorityUntil')).toBe(false)
  })
})
