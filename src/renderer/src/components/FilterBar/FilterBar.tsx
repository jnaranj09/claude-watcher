// The board's FILTER BAR (2026-09-14, design option C; the controls row came 2026-09-14 later). It
// replaced the header tag filter, whose "All tags" button did not read as a filter. It sits above
// the columns in TWO rows:
//
//   - the CONTROLS row, always drawn: the search box, the `Filter` button, and the count on the
//     right. The count lives here so it shows whenever something is hidden, by either control.
//   - the CHIP row, drawn while the `Filter` button is pressed: `FilterChips` (spec 2026-10-16),
//     the one chip row the Sessions dialog's pages also render, offering tag, folder, goal and
//     launch time here. The lists, pills, calendar and their keys all live there.
//
// The `Filter` button is `FilterToggle`, the one the Sessions dialog's rail also draws (lit, count,
// `Filter, N on`). Open/closed is local view-state, never persisted. The button shows whenever
// the workspace has sessions: folder and time need no tag.
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
import { selectGoalsIn, useGoals } from '../../stores/goalsStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { activeFilterCount, type FilterType } from '../../lib/sessionFilters'
import { FilterChips } from '../FilterChips/FilterChips'
import { SearchIcon } from '../Icon/MenuIcons'
import { TextInput } from '../TextInput/TextInput'
import { FilterToggle } from './FilterToggle'
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
const BOARD_TYPES: readonly FilterType[] = ['tag', 'folder', 'goal', 'launched']

function countText(total: number, workspaceTotal: number, filtered: boolean): string {
  if (!filtered) return workspaceTotal === 1 ? '1 session' : `${workspaceTotal} sessions`
  return `${total} shown · ${workspaceTotal - total} hidden`
}

function setSearch(query: string): void {
  boardStore.getState().setSearchQuery(query)
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
  const goals = useGoals(selectGoalsIn(activeWorkspaceId))
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
        <FilterToggle
          expanded={expanded}
          count={count}
          controls={chipRowId}
          onToggle={() => setExpanded((v) => !v)}
          testId="filter-toggle"
        />
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
          goals={goals}
          now={now}
          testIdPrefix="filter"
          {...(onManageTags !== undefined ? { onManageTags } : {})}
        />
      )}
    </div>
  )
}
