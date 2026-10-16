// Session filters (spec 2026-10-16) — the ONE filter model and matcher behind the board's filter
// bar and the Sessions dialog's Active and Past pages. Pure: no React, no store. Time comes in as
// `now` (state.md: inject now()). Name search is NOT here: it stays with each surface's own box.
//
// Day windows are LOCAL calendar days built from calendar fields (`new Date(y, m, d)`), never by
// adding 24 h, so a clock-change day still covers the whole day.
export type TimeRange = 'today' | '7d' | '30d'

export type TimePick =
  | { kind: 'preset'; range: TimeRange }
  | { kind: 'on'; day: string }
  | { kind: 'since'; day: string }

export type FilterType = 'tag' | 'folder' | 'launched' | 'ended'

export interface SessionFilters {
  /** Any of these tag ids; [] = off. */
  tagIds: readonly string[]
  /** Any of these exact folder paths; [] = off. */
  folders: readonly string[]
  launched: TimePick | null
  /** Offered on Past only. */
  ended: TimePick | null
}

/** What a surface hands the matcher for one row. */
export interface FilterSubject {
  folder: string
  tagIds: readonly string[]
  launchedAt: number | undefined
  endedAt: number | undefined
}

export const NO_FILTERS: SessionFilters = { tagIds: [], folders: [], launched: null, ended: null }

const DAY_MS = 86_400_000
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The LOCAL calendar day of `ms`, as 'YYYY-MM-DD'. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight of `day` to the next local midnight. A malformed key gives an empty window
 *  (NaN bounds), so nothing matches: it can only come from a bug, never from the operator. */
export function dayWindow(day: string): { start: number; end: number } {
  const m = DAY_KEY.exec(day)
  if (m === null) return { start: Number.NaN, end: Number.NaN }
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  return { start: new Date(y, mo, d).getTime(), end: new Date(y, mo, d + 1).getTime() }
}

/** [from, to) for a pick at `now`. `to` is open-ended for presets and `since`. */
function timeWindow(pick: TimePick, now: number): { from: number; to: number } {
  switch (pick.kind) {
    case 'preset': {
      if (pick.range === 'today') return { from: dayWindow(dayKey(now)).start, to: Infinity }
      const days = pick.range === '7d' ? 7 : 30
      return { from: now - days * DAY_MS, to: Infinity }
    }
    case 'on': {
      const w = dayWindow(pick.day)
      return { from: w.start, to: w.end }
    }
    case 'since':
      return { from: dayWindow(pick.day).start, to: Infinity }
    default: {
      const unreachable: never = pick
      return unreachable
    }
  }
}

function matchesTime(at: number | undefined, pick: TimePick | null, now: number): boolean {
  if (pick === null) return true
  if (at === undefined) return false
  const { from, to } = timeWindow(pick, now)
  return at >= from && at < to
}

export function matchesFilters(row: FilterSubject, f: SessionFilters, now: number): boolean {
  if (f.tagIds.length > 0 && !f.tagIds.some((id) => row.tagIds.includes(id))) return false
  if (f.folders.length > 0 && !f.folders.includes(row.folder)) return false
  return matchesTime(row.launchedAt, f.launched, now) && matchesTime(row.endedAt, f.ended, now)
}

export function isTypeOn(f: SessionFilters, type: FilterType): boolean {
  switch (type) {
    case 'tag':
      return f.tagIds.length > 0
    case 'folder':
      return f.folders.length > 0
    case 'launched':
      return f.launched !== null
    case 'ended':
      return f.ended !== null
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}

/** The number on the `Filter` button: how many TYPES are on (search is never counted). */
export function activeFilterCount(f: SessionFilters): number {
  return (['tag', 'folder', 'launched', 'ended'] as const).filter((t) => isTypeOn(f, t)).length
}

export function clearType(f: SessionFilters, type: FilterType): SessionFilters {
  switch (type) {
    case 'tag':
      return { ...f, tagIds: [] }
    case 'folder':
      return { ...f, folders: [] }
    case 'launched':
      return { ...f, launched: null }
    case 'ended':
      return { ...f, ended: null }
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}

/** `f` without the tag ids this surface cannot see (deleted, or out of its workspace / scope).
 *  A derived READ: nothing is written back. Returns `f` itself when nothing drops. */
export function effectiveFilters(
  f: SessionFilters,
  visibleTagIds: ReadonlySet<string>
): SessionFilters {
  const kept = f.tagIds.filter((id) => visibleTagIds.has(id))
  return kept.length === f.tagIds.length ? f : { ...f, tagIds: kept }
}
