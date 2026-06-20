// Story 3.2 (FR-11) — the launched-set membership gate (AC: #4; F5).
//
// Asserts the per-run, born-empty, populate-on-join-only contract:
//   - empty at construction (per-run, not seeded from a prior run);
//   - a launch whose join lands adds the id;
//   - a launch whose join NEVER resolves (the t0 window) does NOT add an id (no false
//     membership) — modeled here by simply never calling add() for that id;
//   - add is idempotent; has() is the membership query Story 3.3 consumes;
//   - snapshot() is a defensive copy (mutating it never touches the authority).
import { describe, it, expect } from 'vitest'
import { createLaunchedSet } from './launchedSet'

describe('launchedSet — born here, populated on the Tgid join (AC-4)', () => {
  it('is EMPTY at construction (per-run, never seeded from a prior run)', () => {
    const set = createLaunchedSet()
    expect(set.size()).toBe(0)
    expect(set.has('any-id')).toBe(false)
    expect([...set.snapshot()]).toEqual([])
  })

  it('records a launched id when the join lands (add → has true)', () => {
    const set = createLaunchedSet()
    set.add('sess-uuid-1')
    expect(set.has('sess-uuid-1')).toBe(true)
    expect(set.size()).toBe(1)
  })

  it('does NOT record an id whose join never resolves (no false membership in the t0 window)', () => {
    const set = createLaunchedSet()
    // The optimistic-card path never calls add() until the Tgid join lands; if it never
    // lands, the id never enters the set. Assert the absence is real membership-negative.
    expect(set.has('never-joined-id')).toBe(false)
    expect(set.size()).toBe(0)
  })

  it('add is idempotent (a re-correlated id does not double-count)', () => {
    const set = createLaunchedSet()
    set.add('sess-uuid-1')
    set.add('sess-uuid-1')
    expect(set.size()).toBe(1)
  })

  it('never records a blank id (defensive — a join keys on a validated session id)', () => {
    const set = createLaunchedSet()
    set.add('')
    expect(set.size()).toBe(0)
  })

  it('snapshot() is a defensive copy — mutating it does not touch the authority', () => {
    const set = createLaunchedSet()
    set.add('a')
    const snap = set.snapshot() as Set<string>
    snap.add('b')
    expect(set.has('b')).toBe(false)
    expect(set.size()).toBe(1)
  })
})
