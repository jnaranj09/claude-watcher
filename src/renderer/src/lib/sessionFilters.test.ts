// The session filter model (spec 2026-10-16 §1): the ONE matcher the board and both Sessions pages
// use. jsdom `unit` project (it lives in the renderer).
import { describe, it, expect } from 'vitest'
import {
  NO_FILTERS,
  activeFilterCount,
  clearType,
  dayKey,
  dayWindow,
  effectiveFilters,
  isTypeOn,
  matchesFilters,
  type FilterSubject,
  type SessionFilters
} from './sessionFilters'

const NOW = new Date(2026, 9, 16, 15, 0, 0).getTime() // Fri 16 Oct 2026, 15:00 local
const row = (over: Partial<FilterSubject> = {}): FilterSubject => ({
  folder: '/home/u/api',
  tagIds: ['t-api'],
  launchedAt: new Date(2026, 9, 14, 9, 0).getTime(),
  endedAt: undefined,
  ...over
})
const f = (over: Partial<SessionFilters>): SessionFilters => ({ ...NO_FILTERS, ...over })

describe('matchesFilters', () => {
  it('no filter passes every row', () => {
    expect(matchesFilters(row(), NO_FILTERS, NOW)).toBe(true)
  })

  it('tags match ANY of the picked ids', () => {
    expect(matchesFilters(row(), f({ tagIds: ['t-web', 't-api'] }), NOW)).toBe(true)
    expect(matchesFilters(row(), f({ tagIds: ['t-web'] }), NOW)).toBe(false)
  })

  it('folders match ANY of the picked paths, exactly', () => {
    expect(matchesFilters(row(), f({ folders: ['/x', '/home/u/api'] }), NOW)).toBe(true)
    expect(matchesFilters(row(), f({ folders: ['/home/u'] }), NOW)).toBe(false)
  })

  it('types combine with AND', () => {
    expect(matchesFilters(row(), f({ tagIds: ['t-api'], folders: ['/other'] }), NOW)).toBe(false)
  })

  it('Launched today starts at local midnight', () => {
    const today = f({ launched: { kind: 'preset', range: 'today' } })
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 16, 0, 0).getTime() }), today, NOW)
    ).toBe(true)
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 15, 23, 59, 59).getTime() }), today, NOW)
    ).toBe(false)
  })

  it('Last 7 days is rolling from now', () => {
    const week = f({ launched: { kind: 'preset', range: '7d' } })
    expect(matchesFilters(row({ launchedAt: NOW - 7 * 86_400_000 + 1 }), week, NOW)).toBe(true)
    expect(matchesFilters(row({ launchedAt: NOW - 7 * 86_400_000 - 1 }), week, NOW)).toBe(false)
  })

  it('On a day covers that local day only', () => {
    const on14 = f({ launched: { kind: 'on', day: '2026-10-14' } })
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 14, 23, 59, 59).getTime() }), on14, NOW)
    ).toBe(true)
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 15, 0, 0).getTime() }), on14, NOW)
    ).toBe(false)
  })

  it('Since a day covers that day up to now', () => {
    const since12 = f({ launched: { kind: 'since', day: '2026-10-12' } })
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 12, 0, 0).getTime() }), since12, NOW)
    ).toBe(true)
    expect(
      matchesFilters(row({ launchedAt: new Date(2026, 9, 11, 23, 59).getTime() }), since12, NOW)
    ).toBe(false)
  })

  it('a row with no time is hidden by a filter on that time', () => {
    expect(
      matchesFilters(
        row({ launchedAt: undefined }),
        f({ launched: { kind: 'preset', range: '30d' } }),
        NOW
      )
    ).toBe(false)
    expect(matchesFilters(row(), f({ ended: { kind: 'preset', range: '30d' } }), NOW)).toBe(false)
  })

  it('Ended filters endedAt', () => {
    const ended = row({ endedAt: new Date(2026, 9, 15, 12, 0).getTime() })
    expect(matchesFilters(ended, f({ ended: { kind: 'on', day: '2026-10-15' } }), NOW)).toBe(true)
  })
})

describe('day windows', () => {
  it('dayKey is the LOCAL date', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05')
  })

  it('a day window spans local midnight to the next local midnight, even across a clock change', () => {
    // Whatever the test machine's zone, the window is built from calendar fields, never + 24 h.
    const { start, end } = dayWindow('2026-10-25')
    expect(start).toBe(new Date(2026, 9, 25).getTime())
    expect(end).toBe(new Date(2026, 9, 26).getTime())
  })

  it('a malformed day matches nothing', () => {
    const bad = f({ launched: { kind: 'on', day: 'nope' } })
    expect(matchesFilters(row(), bad, NOW)).toBe(false)
  })
})

describe('helpers', () => {
  it('activeFilterCount counts TYPES, not values', () => {
    expect(activeFilterCount(f({ tagIds: ['a', 'b'], folders: ['/x'] }))).toBe(2)
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
  })

  it('isTypeOn and clearType work per type', () => {
    const on = f({ tagIds: ['a'], ended: { kind: 'preset', range: 'today' } })
    expect(isTypeOn(on, 'tag')).toBe(true)
    expect(isTypeOn(on, 'folder')).toBe(false)
    expect(clearType(on, 'ended')).toEqual(f({ tagIds: ['a'] }))
  })

  it('effectiveFilters drops tags the surface cannot see, and keeps the same object when nothing drops', () => {
    const stored = f({ tagIds: ['a', 'gone'] })
    expect(effectiveFilters(stored, new Set(['a'])).tagIds).toEqual(['a'])
    const clean = f({ tagIds: ['a'] })
    expect(effectiveFilters(clean, new Set(['a']))).toBe(clean)
  })
})
