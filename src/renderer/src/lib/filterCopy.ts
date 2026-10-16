// Filter bar copy. The pills, the day rows, the type names and the remove labels come first. The
// filter bar's "why is this empty" sentence follows, shared by the empty board (`.`) and an empty
// column (` here.`), so the two always name the same cause. design.md: three nothings, three
// answers — a board emptied by the search or the tag filter must never read like an empty one.

import type { FilterType, TimePick, TimeRange } from './sessionFilters'
import { dayWindow } from './sessionFilters'

/** `No sessions tagged prod match “dep”` — names what hides the cards: the tag, the search, or
 *  both. `query` is the search text as typed; it is trimmed here. Ends WITHOUT punctuation. */
export function hiddenByFilterSentence(tagName: string | null, query: string): string {
  const q = query.trim()
  const tagged = tagName !== null ? ` tagged ${tagName}` : ''
  return q === '' ? `No sessions${tagged}` : `No sessions${tagged} match “${q}”`
}

/** How to get every card back, naming each control that is hiding some. */
export function clearFilterHint(tagOn: boolean, query: string): string {
  const searching = query.trim() !== ''
  if (searching && tagOn) return 'Clear the search or remove the tag filter to see every session.'
  if (searching) return 'Clear the search to see every session.'
  return 'Remove the tag filter to see every session.'
}

export const TIME_RANGE_LABEL: Readonly<Record<TimeRange, string>> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days'
}

/** The type menu's rows and the pills' first word. Same words as the Active / Past form labels. */
export const FILTER_TYPE_LABEL: Readonly<Record<FilterType, string>> = {
  tag: 'Tag',
  folder: 'Folder',
  launched: 'Launched',
  ended: 'Ended'
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }

/** `Wed, Oct 14` in en-US — the operator's own locale. */
export function formatDay(day: string): string {
  return new Date(dayWindow(day).start).toLocaleDateString(undefined, DAY_FORMAT)
}

/** The time pill: `Launched today`, `Ended in last 7 days`, `Launched on Wed, Oct 14`, … */
export function timePillText(type: 'launched' | 'ended', pick: TimePick): string {
  const word = FILTER_TYPE_LABEL[type]
  switch (pick.kind) {
    case 'preset':
      return pick.range === 'today'
        ? `${word} today`
        : `${word} in ${TIME_RANGE_LABEL[pick.range].toLowerCase()}`
    case 'on':
      return `${word} on ${formatDay(pick.day)}`
    case 'since':
      return `${word} since ${formatDay(pick.day)}`
    default: {
      const unreachable: never = pick
      return unreachable
    }
  }
}

/** The `On a day` / `Since a day` rows: they name the current pick when it is theirs. */
export function timePickRowLabel(pick: TimePick | null, mode: 'on' | 'since'): string {
  if (pick !== null && pick.kind === mode) {
    return `${mode === 'on' ? 'On' : 'Since'} ${formatDay(pick.day)}`
  }
  return mode === 'on' ? 'On a day' : 'Since a day'
}

/** A folder's last path segment (the pill and the row's main text). */
export function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

export function removeFilterLabel(type: FilterType): string {
  return `Remove the ${FILTER_TYPE_LABEL[type].toLowerCase()} filter`
}
