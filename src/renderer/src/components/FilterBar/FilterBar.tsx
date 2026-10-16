// The board's FILTER BAR (2026-09-14, design option C; the controls row came 2026-09-14 later). It
// replaced the header tag filter, whose "All tags" button did not read as a filter. It sits above
// the columns in TWO rows:
//
//   - the CONTROLS row, always drawn: the search box, the `Filter` button, and the count on the
//     right. The count lives here so it shows whenever something is hidden, by either control.
//   - the CHIP row, drawn while the `Filter` button is pressed: `FilterChips` (spec 2026-10-16),
//     the one chip row the Sessions dialog's pages also render, offering tag, folder and launch
//     time here. The lists, pills, calendar and their keys all live there.
//
// The button is LIT while the chip row is open (like the rail's open tag toggles), and while it is
// closed with a filter on, because the pills are then out of sight while cards are still hidden.
// With filters on it also carries how many TYPES are on (`activeFilterCount`). The search is not
// counted on it: the box already shows what it holds. Open/closed is local view-state, never
// persisted. The button shows whenever the workspace has sessions: folder and time need no tag.
//
// The filters are kept PER WORKSPACE in `boardStore.filtersByWorkspace` (view-state, never
// persisted): switching away keeps them, switching back brings them all back. Tags are offered
// from exactly what the ACTIVE workspace can see (T-11), and a stored tag it cannot see is dropped
// at read time (`useBoardFilter`). The search text is ONE global box in boardStore, matched against
// the card NAME only. Both narrow the board and the rail; alerts ignore them.
import { useCallback, useId, useState, type JSX, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTags, type TagsState } from '../../stores/tagsStore'
import { boardStore, selectSearchQuery, useBoard, useBoardFilter } from '../../stores/boardStore'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { activeFilterCount, type FilterType } from '../../lib/sessionFilters'
import { Button } from '../Button/Button'
import { FilterChips } from '../FilterChips/FilterChips'
import { TextInput } from '../TextInput/TextInput'
import styles from './FilterBar.module.css'

export interface FilterBarProps {
  /** Sessions the board shows under the current filter and search. */
  total: number
  /** Sessions in the active workspace, unfiltered. 0 ⇒ nothing to filter, so no bar. */
  workspaceTotal: number
  /** Opens the Tags dialog: the tag list's `Create tags` row while no tag exists yet. */
  onManageTags?: () => void
  /** The clock the time filters read (state.md: inject now()). */
  now?: () => number
}

/** The types the board offers, in pill order (Ended is Past's only). */
const BOARD_TYPES: readonly FilterType[] = ['tag', 'folder', 'launched']

function countText(total: number, workspaceTotal: number, filtered: boolean): string {
  if (!filtered) return workspaceTotal === 1 ? '1 session' : `${workspaceTotal} sessions`
  return `${total} shown · ${workspaceTotal - total} hidden`
}

function setSearch(query: string): void {
  boardStore.getState().setSearchQuery(query)
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

/** The search box's magnifier, on the same 16-unit grid and stroke, drawn at 14px. */
function SearchIcon(): JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

export function FilterBar({
  total,
  workspaceTotal,
  onManageTags,
  now = Date.now
}: FilterBarProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const chipRowId = useId()
  const query = useBoard(selectSearchQuery)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const filter = useBoardFilter(activeWorkspaceId, now)
  const visible = useTags(useShallow((s: TagsState) => visibleTags(s.tags, activeWorkspaceId)))
  // Global first, then this workspace's own — the order spec §4.3 lists them in.
  const ordered = [
    ...visible.filter((t) => t.workspaceId === null),
    ...visible.filter((t) => t.workspaceId !== null)
  ]
  // The folders this workspace's cards run in (never another workspace's).
  const folders = useBoard(
    useShallow((s) => [
      ...new Set(
        Object.values(s.sessionsById)
          .filter((x) => x.workspaceId === activeWorkspaceId)
          .map((x) => x.projectPath)
      )
    ])
  )

  // The search box: Escape clears the text and stops there. An empty box has nothing to peel, so
  // its Escape passes through (Focused → Board still works from inside it).
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key !== 'Escape' || query === '') return
      e.stopPropagation()
      setSearch('')
    },
    [query]
  )

  if (workspaceTotal === 0) return null

  const count = activeFilterCount(filter.filters)
  const filterOn = count > 0
  const searching = query.trim() !== ''
  const lit = expanded || filterOn

  return (
    <div
      className={styles.bar}
      role="group"
      aria-label="Search and filters"
      data-testid="filter-bar"
    >
      <div className={styles.controlsRow} data-testid="filter-controls-row">
        <div className={styles.searchSlot}>
          <TextInput
            value={query}
            onChange={setSearch}
            testId="board-search"
            glass="field"
            ariaLabel="Search sessions"
            placeholder="Search…"
            variant="toolbar"
            icon={<SearchIcon />}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        <Button
          variant="secondary"
          lit={lit}
          testId="filter-toggle"
          aria-expanded={expanded}
          aria-controls={chipRowId}
          title={expanded ? 'Hide filters' : 'Show filters'}
          aria-label={filterOn ? `Filter, ${count} on` : 'Filter'}
          onClick={() => setExpanded((v) => !v)}
        >
          <FilterLinesIcon />
          Filter
          {filterOn && (
            <span className={styles.toggleCount} data-testid="filter-toggle-count">
              {count}
            </span>
          )}
        </Button>
        <span
          className={styles.count}
          data-testid="filter-count"
          data-count="total"
          data-session-count=""
        >
          {countText(total, workspaceTotal, filterOn || searching)}
        </span>
      </div>
      {expanded && (
        <FilterChips
          id={chipRowId}
          filters={filter.filters}
          onChange={(next) => boardStore.getState().setBoardFilters(activeWorkspaceId, next)}
          types={BOARD_TYPES}
          tags={ordered}
          folders={folders}
          now={now}
          testIdPrefix="filter"
          {...(onManageTags !== undefined ? { onManageTags } : {})}
        />
      )}
    </div>
  )
}
