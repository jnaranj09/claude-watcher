// The Sessions dialog's rail filter (spec 2026-10-16 §3), and the Memory dialog's (spec 2026-11-11
// memory §8): the page's search box and the board's `Filter` button (`FilterToggle`) on one line,
// and the shared chip row (`FilterChips`, wrapping) under it while the button is pressed. The
// Sessions pages keep their filters per page and SCOPE while the dialog is open (`useScopedFilters`,
// railFilters.ts, held by SessionsDialog so a page switch keeps them); Memory keeps them per page.
// Either way they are gone when the dialog closes: view-state, never persisted.
//
// The chip row's lists float over the rail's rows and the form beside it (FilterChips' own
// positioning and z-index). Nothing above them in the dialog clips: the rail (`.list`), the column
// grid and the panel set no overflow; only `.rows`, a sibling under the chip row, scrolls.
import { useId, useState, type JSX, type ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { activeFilterCount, type FilterType, type SessionFilters } from '../../lib/sessionFilters'
import { FilterChips, type ListType } from '../FilterChips/FilterChips'
import { FilterToggle } from '../FilterBar/FilterToggle'
import styles from './SessionsDialog.module.css'

export interface RailFilterProps {
  /** The page's own search box, drawn unchanged beside the button. */
  search: ReactNode
  filters: SessionFilters
  onChange: (next: SessionFilters) => void
  types: readonly FilterType[]
  tags: readonly Tag[]
  folders: readonly string[]
  /** Memory's Goal and Session values, and its one-value lists (FilterChips' props). */
  goals?: readonly { id: string; name: string }[]
  sessionNames?: readonly string[]
  single?: readonly ListType[]
  now: () => number
  /** 'active-filter' | 'past-filter' | 'memory-filter': FilterChips' ids, and
   *  `${testIdPrefix}-toggle`. */
  testIdPrefix: string
}

export function RailFilter({
  search,
  filters,
  onChange,
  types,
  tags,
  folders,
  goals = [],
  sessionNames = [],
  single = [],
  now,
  testIdPrefix
}: RailFilterProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const chipRowId = useId()
  return (
    <>
      <div className={styles.railTop}>
        <div className={styles.railSearch}>{search}</div>
        <FilterToggle
          expanded={expanded}
          count={activeFilterCount(filters)}
          controls={chipRowId}
          onToggle={() => setExpanded((v) => !v)}
          testId={`${testIdPrefix}-toggle`}
        />
      </div>
      {expanded && (
        <FilterChips
          id={chipRowId}
          wrap
          filters={filters}
          onChange={onChange}
          types={types}
          tags={tags}
          folders={folders}
          goals={goals}
          sessionNames={sessionNames}
          single={single}
          now={now}
          testIdPrefix={testIdPrefix}
        />
      )}
    </>
  )
}
