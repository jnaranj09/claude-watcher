// Memory's filters (spec 2026-11-11 memory §8) — the bridge between the chip row's model
// (`SessionFilters`, what `FilterChips` edits) and the store's (`MemoryFilters`, what
// `window.memory.list` takes). The chip types come from the ONE filter list, `MEMORY_FILTER_FIELDS`:
// each field names the chip it is drawn as, by its control (a folder list, a name list, the tag
// list, the time picker, an on/off row). `CHIP_FOR` is keyed by every field name, so a field added
// to the list fails the type check until it is drawn here, and `MemoryFilters.test.tsx` fails when
// a field is drawn but never sent. Pure: no React, no store.
import type { Tag } from '../../../../shared/ipc/contract'
import {
  MEMORY_FILTER_FIELDS,
  type MemoryFilterName,
  type MemoryFilters
} from '../../../../shared/memory/filterFields'
import { timePickDays, type FilterType, type SessionFilters } from '../../lib/sessionFilters'
import type { ListType } from '../FilterChips/FilterChips'

/** The chip each field is drawn as. `since` and `until` are ONE chip, `Updated` (a time pick sets
 *  both). `includeStale` is not a chip: it is the header's `Show stale`, beside `Include global`,
 *  because both choose which rows exist, not which match. */
const CHIP_FOR: Readonly<Record<MemoryFilterName, FilterType | 'header'>> = {
  folder: 'folder',
  session: 'session',
  tags: 'tag',
  since: 'updated',
  until: 'updated',
  goal: 'goal',
  sessionDeleted: 'sessionDeleted',
  includeStale: 'header'
}

/** The chip types `+ Add filter` offers, in the filter list's order. */
export const MEMORY_CHIP_TYPES: readonly FilterType[] = [
  ...new Set(
    MEMORY_FILTER_FIELDS.flatMap((field) => {
      const chip = CHIP_FOR[field.name]
      return chip === 'header' ? [] : [chip]
    })
  )
]

/** Main filters folder, session and goal by ONE value each: their lists pick one. */
export const MEMORY_SINGLE_PICKS: readonly ListType[] = ['folder', 'session', 'goal']

export interface MemoryFilterContext {
  /** The tags the scope offers: a picked id is sent as its name (main matches tags by name). */
  tags: readonly Tag[]
  /** The scope's goals: a picked id is sent as its name. */
  goals: readonly { id: string; name: string }[]
  showStale: boolean
  now: number
}

/** The chip row's filters as the store's. A pick that no longer resolves (a gone tag or goal)
 *  sends nothing for it. Optional keys are left out, never set to undefined. */
export function toMemoryFilters(f: SessionFilters, ctx: MemoryFilterContext): MemoryFilters {
  const out: MemoryFilters = {}
  const folder = f.folders[0]
  if (folder !== undefined) out.folder = folder
  const session = f.sessionNames[0]
  if (session !== undefined) out.session = session
  const tags = ctx.tags.filter((t) => f.tagIds.includes(t.id)).map((t) => t.name)
  if (tags.length > 0) out.tags = tags
  if (f.updated !== null) {
    const days = timePickDays(f.updated, ctx.now)
    out.since = days.since
    if (days.until !== undefined) out.until = days.until
  }
  const goal = ctx.goals.find((g) => g.id === f.goalIds[0])
  if (goal !== undefined) out.goal = goal.name
  if (f.sessionDeleted) out.sessionDeleted = true
  if (ctx.showStale) out.includeStale = true
  return out
}
