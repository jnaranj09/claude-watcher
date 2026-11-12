// Memory — the rail's top (spec 2026-11-11 memory §8, owner's pick: option B): the Past sessions
// page's `RailFilter` unchanged — the search box and the `Filter` button on one line, the wrapping
// chip row under it. The chip types are the filter list's (`MEMORY_CHIP_TYPES`, from
// `MEMORY_FILTER_FIELDS`); folder, session and goal pick one value each (main filters by one).
import type { JSX } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { MEMORY_LIMITS } from '../../../../shared/schemas/memory'
import type { SessionFilters } from '../../lib/sessionFilters'
import { SearchIcon } from '../Icon/MenuIcons'
import { RailFilter } from '../SessionsDialog/RailFilter'
import { TextInput } from '../TextInput/TextInput'
import { MEMORY_COPY } from './memoryCopy'
import { MEMORY_CHIP_TYPES, MEMORY_SINGLE_PICKS } from './memoryFilterMap'

export interface MemoryFiltersProps {
  query: string
  onQuery: (next: string) => void
  filters: SessionFilters
  onChange: (next: SessionFilters) => void
  tags: readonly Tag[]
  goals: readonly { id: string; name: string }[]
  folders: readonly string[]
  sessionNames: readonly string[]
  now: () => number
}

export function MemoryFilters({
  query,
  onQuery,
  filters,
  onChange,
  tags,
  goals,
  folders,
  sessionNames,
  now
}: MemoryFiltersProps): JSX.Element {
  return (
    <RailFilter
      search={
        <TextInput
          variant="toolbar"
          icon={<SearchIcon />}
          testId="memory-search"
          ariaLabel="Search memory"
          placeholder={MEMORY_COPY.search}
          maxLength={MEMORY_LIMITS.query}
          value={query}
          onChange={onQuery}
        />
      }
      filters={filters}
      onChange={onChange}
      types={MEMORY_CHIP_TYPES}
      tags={tags}
      folders={folders}
      goals={goals}
      sessionNames={sessionNames}
      single={MEMORY_SINGLE_PICKS}
      now={now}
      testIdPrefix="memory-filter"
    />
  )
}
