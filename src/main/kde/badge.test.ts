// Story 2.3 — `computeBadgeCount` tests (main-unit / node project).
//
// The badge count is a PURE function over the reducer's session map, derived via the SHIPPED
// `columnForStatus` classifier (single source of truth, AC-3) — never a parallel status list.
// Count = sessions in `needs-you` ONLY (AC-1; Jose 2026-06-19 / UX-DR3). `working` AND `idle`
// are both excluded. Because `columnForStatus` maps unknown/'' → `needs-you`
// (fail-toward-attention), an unrecognized status is COUNTED — matching the board's placement
// (consistency, AC-3).
// [Source: story 2.3 Task 1.3; AC-1/3/7; UX-DR3 (one-reserved-hue); src/main/c9watch/columns.ts]
import { describe, it, expect } from 'vitest'
import { computeBadgeCount } from './badge'
import type { Session } from '../../shared/schemas/session'

/** Build a minimal valid `Session` with the given id + status (the only fields the count
 *  classifier reads). The rest are filler — the count never reads them. */
function session(id: string, status: string): Session {
  return {
    id,
    status,
    projectPath: `/p/${id}`,
    pid: 1,
    sessionName: id
  }
}

/** Build an id-keyed map from a list of [id, status] pairs (mirrors reducer.snapshotMap()). */
function mapOf(pairs: ReadonlyArray<readonly [string, string]>): Map<string, Session> {
  const m = new Map<string, Session>()
  for (const [id, status] of pairs) m.set(id, session(id, status))
  return m
}

describe('computeBadgeCount — count = needs-you ONLY (AC-1/3; Jose 2026-06-19 / UX-DR3)', () => {
  it('empty map → 0', () => {
    expect(computeBadgeCount(new Map())).toBe(0)
  })

  it('only working/Connecting sessions → 0 (working is excluded)', () => {
    const m = mapOf([
      ['a', 'Working'],
      ['b', 'Connecting']
    ])
    expect(computeBadgeCount(m)).toBe(0)
  })

  it('a Connecting session counts 0 (it is `working`, not needs-you)', () => {
    expect(computeBadgeCount(mapOf([['a', 'Connecting']]))).toBe(0)
  })

  it('N needs-you sessions → N', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'NeedsPermission']
    ])
    expect(computeBadgeCount(m)).toBe(2)
  })

  it('idle (WaitingForInput) sessions are EXCLUDED → 0 (NOT counted in the gold chip)', () => {
    // Non-vacuous: a board full of idle sessions must NOT increment the needs-you badge.
    const m = mapOf([
      ['a', 'WaitingForInput'],
      ['b', 'WaitingForInput'],
      ['c', 'WaitingForInput']
    ])
    expect(computeBadgeCount(m)).toBe(0)
  })

  it('mixed → counts needs-you ONLY, excluding working AND idle', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'], // needs-you → counted
      ['b', 'WaitingForInput'], // idle → EXCLUDED
      ['c', 'Working'], // working → excluded
      ['d', 'NeedsPermission'], // needs-you → counted
      ['e', 'Connecting'] // working → excluded
    ])
    expect(computeBadgeCount(m)).toBe(2)
  })

  it('adding an idle session does NOT increment the badge (non-vacuous idle exclusion)', () => {
    const needsYouOnly = mapOf([['a', 'NeedsAttention']])
    const withIdleAdded = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'WaitingForInput'] // idle — must NOT bump the count
    ])
    expect(computeBadgeCount(needsYouOnly)).toBe(1)
    expect(computeBadgeCount(withIdleAdded)).toBe(1)
  })

  it('an unknown status counts as needs-you (fail-toward-attention, matches the board)', () => {
    const m = mapOf([
      ['a', 'SomeBrandNewStatus'],
      ['b', 'Working']
    ])
    expect(computeBadgeCount(m)).toBe(1)
  })

  it('an empty-string status counts as needs-you (fail-toward-attention)', () => {
    expect(computeBadgeCount(mapOf([['a', '']]))).toBe(1)
  })

  it('uses the SAME columnForStatus as the board (single source of truth, AC-3)', async () => {
    // Property-style check: every status the classifier puts in needs-you is counted; every
    // status it puts in working OR idle is not. Proves the count cannot drift from the board's
    // column assignment.
    const { columnForStatus } = await import('../c9watch/columns')
    const statuses = [
      'Working',
      'Connecting',
      'WaitingForInput',
      'NeedsAttention',
      'NeedsPermission',
      'Mystery',
      ''
    ]
    const expected = statuses.filter((s) => columnForStatus(s) === 'needs-you').length
    const m = mapOf(statuses.map((s, i) => [`s${i}`, s] as const))
    expect(computeBadgeCount(m)).toBe(expected)
  })

  it('is pure — does not mutate the input map', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'Working']
    ])
    const before = m.size
    computeBadgeCount(m)
    expect(m.size).toBe(before)
  })
})
