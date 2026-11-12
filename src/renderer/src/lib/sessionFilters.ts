// Session filters (spec 2026-10-16) — the ONE filter model and matcher behind the board's filter
// bar and the Sessions dialog's Active and Past pages. Pure: no React, no store. Time comes in as
// `now` (state.md: inject now()). Name search is NOT here: it stays with each surface's own box.
// The Memory dialog's chip row holds its filters in this model too (spec 2026-11-11 memory §8);
// `session`, `updated` and `sessionDeleted` are its types alone. Main applies them (the dialog
// sends them as `MemoryFilters`), so `matchesFilters` never reads them.
//
// Day windows are LOCAL calendar days built from calendar fields (`new Date(y, m, d)`), never by
// adding 24 h, so a clock-change day still covers the whole day.
export type TimeRange = 'today' | '7d' | '30d'

export type TimePick =
  | { kind: 'preset'; range: TimeRange }
  | { kind: 'on'; day: string }
  | { kind: 'since'; day: string }

export type FilterType =
  | 'tag'
  | 'folder'
  | 'goal'
  | 'launched'
  | 'ended'
  | 'session'
  | 'updated'
  | 'sessionDeleted'

/** Every type, in the order the `Filter` button counts them. */
const FILTER_TYPES: readonly FilterType[] = [
  'tag',
  'folder',
  'goal',
  'launched',
  'ended',
  'session',
  'updated',
  'sessionDeleted'
]

export interface SessionFilters {
  /** Any of these tag ids; [] = off. */
  tagIds: readonly string[]
  /** Any of these exact folder paths; [] = off. */
  folders: readonly string[]
  /** Any of these goal ids (a card linked, by a task, to any of them); [] = off. Board only. */
  goalIds: readonly string[]
  launched: TimePick | null
  /** Offered on Past only. */
  ended: TimePick | null
  /** Memory only: the name of the session that saved the item; [] = off. */
  sessionNames: readonly string[]
  /** Memory only: when the item last changed. */
  updated: TimePick | null
  /** Memory only: only items whose session was deleted. */
  sessionDeleted: boolean
}

/** What a surface hands the matcher for one row. */
export interface FilterSubject {
  folder: string
  tagIds: readonly string[]
  /** The goals this row's linked tasks belong to. Absent (a surface with no goal filter) = the
   *  row matches nothing while a goal filter is on. */
  goalIds?: readonly string[]
  launchedAt: number | undefined
  endedAt: number | undefined
}

export const NO_FILTERS: SessionFilters = {
  tagIds: [],
  folders: [],
  goalIds: [],
  launched: null,
  ended: null,
  sessionNames: [],
  updated: null,
  sessionDeleted: false
}

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

/** A pick as the days a day-granular store filters by (the Memory dialog's `since` / `until`):
 *  `Today` and `Since a day` from that day on, `On a day` that one day, `Last 7 days` and
 *  `Last 30 days` from the day `now` minus that many days falls on (the matcher's window above,
 *  widened to its whole first day). */
export function timePickDays(pick: TimePick, now: number): { since: string; until?: string } {
  switch (pick.kind) {
    case 'preset':
      if (pick.range === 'today') return { since: dayKey(now) }
      return { since: dayKey(now - (pick.range === '7d' ? 7 : 30) * DAY_MS) }
    case 'on':
      return { since: pick.day, until: pick.day }
    case 'since':
      return { since: pick.day }
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
  if (f.goalIds.length > 0 && !f.goalIds.some((id) => row.goalIds?.includes(id) === true)) {
    return false
  }
  return matchesTime(row.launchedAt, f.launched, now) && matchesTime(row.endedAt, f.ended, now)
}

export function isTypeOn(f: SessionFilters, type: FilterType): boolean {
  switch (type) {
    case 'tag':
      return f.tagIds.length > 0
    case 'folder':
      return f.folders.length > 0
    case 'goal':
      return f.goalIds.length > 0
    case 'launched':
      return f.launched !== null
    case 'ended':
      return f.ended !== null
    case 'session':
      return f.sessionNames.length > 0
    case 'updated':
      return f.updated !== null
    case 'sessionDeleted':
      return f.sessionDeleted
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}

/** The number on the `Filter` button: how many TYPES are on (search is never counted). */
export function activeFilterCount(f: SessionFilters): number {
  return FILTER_TYPES.filter((t) => isTypeOn(f, t)).length
}

export function clearType(f: SessionFilters, type: FilterType): SessionFilters {
  switch (type) {
    case 'tag':
      return { ...f, tagIds: [] }
    case 'folder':
      return { ...f, folders: [] }
    case 'goal':
      return { ...f, goalIds: [] }
    case 'launched':
      return { ...f, launched: null }
    case 'ended':
      return { ...f, ended: null }
    case 'session':
      return { ...f, sessionNames: [] }
    case 'updated':
      return { ...f, updated: null }
    case 'sessionDeleted':
      return { ...f, sessionDeleted: false }
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}

/** `f` without the tag ids this surface cannot see (deleted, or out of its workspace / scope) and
 *  the goal ids that no longer exist. A derived READ: nothing is written back. Returns `f` itself
 *  when nothing drops. A surface with no goal filter (the Sessions dialog) omits the goal ids: none
 *  are live there, so none are kept. */
export function effectiveFilters(
  f: SessionFilters,
  visibleTagIds: ReadonlySet<string>,
  liveGoalIds: ReadonlySet<string> = new Set()
): SessionFilters {
  const tagIds = f.tagIds.filter((id) => visibleTagIds.has(id))
  const goalIds = f.goalIds.filter((id) => liveGoalIds.has(id))
  return tagIds.length === f.tagIds.length && goalIds.length === f.goalIds.length
    ? f
    : { ...f, tagIds, goalIds }
}
