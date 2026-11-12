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
  timePickDays,
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

  it('a goal filter keeps cards linked to any picked goal', () => {
    const linked = row({ goalIds: ['g-1'] })
    expect(matchesFilters(linked, f({ goalIds: ['g-2', 'g-1'] }), NOW)).toBe(true)
    expect(matchesFilters(linked, f({ goalIds: ['g-2'] }), NOW)).toBe(false)
    expect(matchesFilters(row({ goalIds: [] }), f({ goalIds: ['g-1'] }), NOW)).toBe(false)
    // A surface that gives no goal ids matches nothing while a goal filter is on.
    expect(matchesFilters(row(), f({ goalIds: ['g-1'] }), NOW)).toBe(false)
    expect(matchesFilters(row(), NO_FILTERS, NOW)).toBe(true)
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

  it('a day window spans local midnight to the next local midnight', () => {
    // The clock-change days are pinned in sessionFilters.zone.test.ts (a fixed zone).
    const { start, end } = dayWindow('2026-10-14')
    expect(start).toBe(new Date(2026, 9, 14).getTime())
    expect(end).toBe(new Date(2026, 9, 15).getTime())
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

  it('activeFilterCount counts goal as one type', () => {
    expect(activeFilterCount(f({ goalIds: ['g-1', 'g-2'], tagIds: ['a'] }))).toBe(2)
    expect(isTypeOn(f({ goalIds: ['g-1'] }), 'goal')).toBe(true)
    expect(clearType(f({ goalIds: ['g-1'] }), 'goal')).toEqual(NO_FILTERS)
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
    const clean = f({ tagIds: ['a'], goalIds: ['g'] })
    expect(effectiveFilters(clean, new Set(['a']), new Set(['g']))).toBe(clean)
    expect(
      effectiveFilters(f({ goalIds: ['g', 'gone'] }), new Set(), new Set(['g'])).goalIds
    ).toEqual(['g'])
  })
})

describe('timePickDays — a pick as the days a day-granular store filters by', () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime()
  it('Today is since today', () => {
    expect(timePickDays({ kind: 'preset', range: 'today' }, now)).toEqual({ since: '2026-11-12' })
  })
  it('Last 7 days starts on the day seven days back', () => {
    expect(timePickDays({ kind: 'preset', range: '7d' }, now)).toEqual({ since: '2026-11-05' })
  })
  it('Last 30 days starts on the day thirty days back', () => {
    expect(timePickDays({ kind: 'preset', range: '30d' }, now)).toEqual({ since: '2026-10-13' })
  })
  it('On a day is that day alone', () => {
    expect(timePickDays({ kind: 'on', day: '2026-11-03' }, now)).toEqual({
      since: '2026-11-03',
      until: '2026-11-03'
    })
  })
  it('Since a day starts on it', () => {
    expect(timePickDays({ kind: 'since', day: '2026-11-03' }, now)).toEqual({ since: '2026-11-03' })
  })
})
