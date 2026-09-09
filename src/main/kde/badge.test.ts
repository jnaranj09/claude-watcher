// Story 2.3 — `computeBadgeCount` tests (main-unit / node project).
// Story 3.3 — extended with the launched-vs-external membership gate.
//
// The badge count is a PURE function over the reducer's session map, derived via the SHIPPED
// `columnForStatus` classifier (single source of truth, AC-3) — never a parallel status list.
// Count = sessions in `needs-you` ONLY (AC-1; Jose 2026-06-19 / UX-DR3) AND launched by the
// Cockpit (`isLaunched(id)` — Story 3.3 AC-3). `working` AND `idle` are both excluded; an
// EXTERNAL (non-launched / Konsole / prior-run) needs-you session is ALSO excluded — it never
// bumps the tray badge. Because `columnForStatus` maps unknown/'' → `needs-you`
// (fail-toward-attention), an unrecognized LAUNCHED status is COUNTED — matching the board's
// placement (consistency, AC-3).
//
// Story 3.3 BEHAVIOR CHANGE (test diff = evidence, F4): the pre-3.3 count was launched-agnostic
// (every needs-you session counted). Every existing case below now passes an explicit
// `isLaunched` predicate; the previously-passing counts are preserved by an ALL-LAUNCHED
// predicate (`allLaunched`), and NEW cases assert external exclusion + a launched/external mix.
// [Source: story 2.3 Task 1.3 + story 3.3 Task 6; AC-1/3/7; UX-DR3 (one-reserved-hue);
//  src/main/c9watch/columns.ts; src/main/pty/launchedSet.ts]
import { describe, it, expect } from 'vitest'
import { computeBadgeCount } from './badge'
import type { Session } from '../../shared/schemas/session'

/** All sessions are app-launched (preserves every pre-3.3 count — the launched-agnostic case). */
const allLaunched = (): boolean => true
/** A predicate from an explicit launched-id set (the production shape: `launchedSet.has`). */
function launchedFrom(ids: ReadonlyArray<string>): (id: string) => boolean {
  const set = new Set(ids)
  return (id) => set.has(id)
}

/** Build a minimal valid `Session` with the given id + status (the only fields the count
 *  classifier reads). The rest are filler — the count never reads them. */
function session(id: string, status: string): Session {
  return {
    id,
    status,
    projectPath: `/p/${id}`,
    pid: 1,
    sessionName: id,
    workspaceId: 'default'
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
    expect(computeBadgeCount(new Map(), allLaunched)).toBe(0)
  })

  it('only working/Connecting sessions → 0 (working is excluded)', () => {
    const m = mapOf([
      ['a', 'Working'],
      ['b', 'Connecting']
    ])
    expect(computeBadgeCount(m, allLaunched)).toBe(0)
  })

  it('a Connecting session counts 0 (it is `working`, not needs-you)', () => {
    expect(computeBadgeCount(mapOf([['a', 'Connecting']]), allLaunched)).toBe(0)
  })

  it('N needs-you sessions → N', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'NeedsPermission']
    ])
    expect(computeBadgeCount(m, allLaunched)).toBe(2)
  })

  it('idle (WaitingForInput) sessions are EXCLUDED → 0 (NOT counted in the gold chip)', () => {
    // Non-vacuous: a board full of idle sessions must NOT increment the needs-you badge.
    const m = mapOf([
      ['a', 'WaitingForInput'],
      ['b', 'WaitingForInput'],
      ['c', 'WaitingForInput']
    ])
    expect(computeBadgeCount(m, allLaunched)).toBe(0)
  })

  it('mixed → counts needs-you ONLY, excluding working AND idle', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'], // needs-you → counted
      ['b', 'WaitingForInput'], // idle → EXCLUDED
      ['c', 'Working'], // working → excluded
      ['d', 'NeedsPermission'], // needs-you → counted
      ['e', 'Connecting'] // working → excluded
    ])
    expect(computeBadgeCount(m, allLaunched)).toBe(2)
  })

  it('adding an idle session does NOT increment the badge (non-vacuous idle exclusion)', () => {
    const needsYouOnly = mapOf([['a', 'NeedsAttention']])
    const withIdleAdded = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'WaitingForInput'] // idle — must NOT bump the count
    ])
    expect(computeBadgeCount(needsYouOnly, allLaunched)).toBe(1)
    expect(computeBadgeCount(withIdleAdded, allLaunched)).toBe(1)
  })

  it('an unknown status counts as needs-you (fail-toward-attention, matches the board)', () => {
    const m = mapOf([
      ['a', 'SomeBrandNewStatus'],
      ['b', 'Working']
    ])
    expect(computeBadgeCount(m, allLaunched)).toBe(1)
  })

  it('an empty-string status counts as needs-you (fail-toward-attention)', () => {
    expect(computeBadgeCount(mapOf([['a', '']]), allLaunched)).toBe(1)
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
    expect(computeBadgeCount(m, allLaunched)).toBe(expected)
  })

  it('is pure — does not mutate the input map', () => {
    const m = mapOf([
      ['a', 'NeedsAttention'],
      ['b', 'Working']
    ])
    const before = m.size
    computeBadgeCount(m, allLaunched)
    expect(m.size).toBe(before)
  })
})

describe('computeBadgeCount — launched-only membership gate (Story 3.3 / AC-3; F4 behavior change)', () => {
  it('an EXTERNAL (non-launched) needs-you session is NOT counted → 0', () => {
    // The single needs-you session was NOT launched by the Cockpit → the tray badge stays 0.
    // This is the load-bearing behavior change: pre-3.3 this would have counted 1.
    const m = mapOf([['ext', 'NeedsAttention']])
    expect(computeBadgeCount(m, launchedFrom([]))).toBe(0)
  })

  it('a LAUNCHED needs-you session IS counted → 1 (the positive case)', () => {
    const m = mapOf([['mine', 'NeedsAttention']])
    expect(computeBadgeCount(m, launchedFrom(['mine']))).toBe(1)
  })

  it('a launched + external needs-you MIX counts ONLY the launched ones', () => {
    const m = mapOf([
      ['mine-1', 'NeedsAttention'], // launched needs-you → counted
      ['mine-2', 'NeedsPermission'], // launched needs-you → counted
      ['ext-1', 'NeedsAttention'], // EXTERNAL needs-you → EXCLUDED
      ['ext-2', 'NeedsPermission'], // EXTERNAL needs-you → EXCLUDED
      ['mine-3', 'WaitingForInput'], // launched but idle → excluded (status)
      ['ext-3', 'Working'] // external + working → excluded (both)
    ])
    expect(computeBadgeCount(m, launchedFrom(['mine-1', 'mine-2', 'mine-3']))).toBe(2)
  })

  it('an external UNKNOWN status is NOT counted (membership gate beats fail-toward-attention)', () => {
    // Fail-toward-attention puts an unknown status in needs-you, but an EXTERNAL session is
    // still excluded — the membership gate is checked first, so it never bumps the badge.
    const m = mapOf([['ext', 'SomeBrandNewStatus']])
    expect(computeBadgeCount(m, launchedFrom([]))).toBe(0)
  })

  it('no launched members at all → 0 even with many external needs-you sessions', () => {
    const m = mapOf([
      ['ext-1', 'NeedsAttention'],
      ['ext-2', 'NeedsPermission'],
      ['ext-3', '']
    ])
    expect(computeBadgeCount(m, launchedFrom([]))).toBe(0)
  })
})
