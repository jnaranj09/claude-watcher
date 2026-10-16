// The `Filter` button (spec 2026-10-16 §3) — ONE button for the board's filter bar and the Sessions
// dialog's rail (`RailFilter`). It opens and closes the caller's chip row (`aria-controls`).
//
// It is LIT while the chip row is open, and while it is closed with a filter on, because the pills
// are then out of sight while rows are still hidden. With filters on it also carries how many TYPES
// are on (`activeFilterCount`): `Filter, N on`. The search is never counted: its box already shows
// what it holds.
import type { JSX } from 'react'
import { Button } from '../Button/Button'
import styles from './FilterToggle.module.css'

export interface FilterToggleProps {
  /** Whether the caller's chip row is drawn. */
  expanded: boolean
  /** How many filter types are on (`activeFilterCount`). */
  count: number
  /** The chip row's DOM id. */
  controls: string
  onToggle: () => void
  /** `filter-toggle` on the board; the count is `${testId}-count`. */
  testId: string
}

/** The button's icon: three lines getting shorter (the "filter list" mark), drawn on the ☰ icon's
 *  grid and stroke so the two header-sized buttons match. */
function FilterLinesIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M4.5 8h7M6.5 12h3"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function FilterToggle({
  expanded,
  count,
  controls,
  onToggle,
  testId
}: FilterToggleProps): JSX.Element {
  const filterOn = count > 0
  return (
    <Button
      variant="secondary"
      lit={expanded || filterOn}
      testId={testId}
      aria-expanded={expanded}
      aria-controls={controls}
      title={expanded ? 'Hide filters' : 'Show filters'}
      aria-label={filterOn ? `Filter, ${count} on` : 'Filter'}
      onClick={onToggle}
    >
      <FilterLinesIcon />
      Filter
      {filterOn && (
        <span className={styles.count} data-testid={`${testId}-count`}>
          {count}
        </span>
      )}
    </Button>
  )
}
