// The board's FILTER BAR (2026-09-14, design option C; the controls row came 2026-09-14 later). It
// replaced the header tag filter, whose "All tags" button did not read as a filter. It sits above
// the columns in TWO rows:
//
//   - the CONTROLS row, always drawn: the search box, the `Filter` button, and the count on the
//     right. The count lives here so it shows whenever something is hidden, by either control.
//   - the CHIP row, drawn while the `Filter` button is pressed: the active filter as a removable pill
//     (`Tag is <chip> ×`), or `+ Add filter` while none is on. Tag is the only filter type today,
//     so `+ Add filter` opens the tag list DIRECTLY; a type step (`Tag ▸`) belongs here only once a
//     second filter type exists.
//
// The button is LIT while the chip row is open (like the rail's open tag toggles), and while it is
// closed with a filter on, because the pill is then out of sight while cards are still hidden. With
// a filter on it also carries the count. The search is not counted on it: the box already shows
// what it holds. Open/closed is local view-state, never persisted.
//
// The tag choice is renderer view-state in tagsStore (one tag at a time, never persisted), offered
// from exactly what the ACTIVE workspace can see (T-11), and it CLEARS when the operator switches to
// a workspace that cannot see it (spec §4.1). The search text is view-state in boardStore and is
// matched against the card NAME only (folder and the rest are future filter types). Both narrow the
// board and the rail; alerts ignore them.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  effectiveTagFilter,
  resetTagFilterIfHidden,
  setTagFilter,
  useTags,
  type TagsState
} from '../../stores/tagsStore'
import { boardStore, selectSearchQuery, useBoard } from '../../stores/boardStore'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { TagChip } from '../TagChip/TagChip'
import { TextInput } from '../TextInput/TextInput'
import styles from './FilterBar.module.css'

export interface FilterBarProps {
  /** Sessions the board shows under the current filter and search. */
  total: number
  /** Sessions in the active workspace, unfiltered. 0 ⇒ nothing to filter, so no bar. */
  workspaceTotal: number
  /** Opens the Tags dialog: the list's `Create tags…` row while no tag exists yet. Omitted ⇒ with no
   *  tag to offer, no `Filter` button (a control that opens onto nothing is not rendered). */
  onManageTags?: () => void
}

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
  onManageTags
}: FilterBarProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const chipRowId = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  // The ONE list trigger on screen: `+ Add filter` with no filter on, the pill's button with one on.
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // Bumped when the list closes by a choice, Escape or ×. The trigger may then be a DIFFERENT
  // element (the pill replaces `+ Add filter`), so focus moves in an effect, after the render that
  // drew it.
  const [refocusTick, setRefocusTick] = useState(0)
  const query = useBoard(selectSearchQuery)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const visible = useTags(useShallow((s: TagsState) => visibleTags(s.tags, activeWorkspaceId)))
  const activeTagId = useTags((s) => effectiveTagFilter(s, activeWorkspaceId))
  const active = visible.find((t) => t.id === activeTagId) ?? null
  // Global first, then this workspace's own — the order spec §4.3 lists them in.
  const ordered = [
    ...visible.filter((t) => t.workspaceId === null),
    ...visible.filter((t) => t.workspaceId !== null)
  ]

  // Spec §4.1 — a workspace switch (or a catalog change) that hides the chosen tag clears it.
  useEffect(() => {
    resetTagFilterIfHidden(activeWorkspaceId)
  }, [activeWorkspaceId, visible])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (refocusTick > 0) triggerRef.current?.focus()
  }, [refocusTick])

  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    setRefocusTick((n) => n + 1)
  }, [])

  // Escape peels ONE layer: it closes the list and must not also reach an Escape handler above it.
  const handleMenuKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeAndRefocus()
    },
    [closeAndRefocus]
  )

  // The same for the search box: Escape clears the text and stops there. An empty box has nothing
  // to peel, so its Escape passes through (Focused → Board still works from inside it).
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key !== 'Escape' || query === '') return
      e.stopPropagation()
      setSearch('')
    },
    [query]
  )

  function pick(id: string): void {
    setTagFilter(id)
    closeAndRefocus()
  }

  function remove(): void {
    setTagFilter(null)
    closeAndRefocus()
  }

  function createTags(): void {
    setOpen(false)
    onManageTags?.()
  }

  // Closing the chip row takes an open tag list with it: the list hangs off a control that is going away.
  function toggleExpanded(): void {
    setExpanded((v) => !v)
    setOpen(false)
  }

  if (workspaceTotal === 0) return null

  // No tag to offer and no way to make one: the `Filter` button would open onto nothing.
  const canFilter = visible.length > 0 || onManageTags !== undefined
  const filterOn = active !== null
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
            ariaLabel="Search sessions"
            placeholder="Search…"
            variant="toolbar"
            icon={<SearchIcon />}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        {canFilter && (
          <button
            type="button"
            className={styles.toggle}
            data-testid="filter-toggle"
            aria-expanded={expanded}
            aria-controls={chipRowId}
            title={expanded ? 'Hide filters' : 'Show filters'}
            aria-label={filterOn ? 'Filter, 1 on' : 'Filter'}
            data-lit={lit}
            onClick={toggleExpanded}
          >
            <FilterLinesIcon />
            Filter
            {filterOn && (
              <span className={styles.toggleCount} data-testid="filter-toggle-count">
                1
              </span>
            )}
          </button>
        )}
        <span className={styles.count} data-testid="filter-count">
          {countText(total, workspaceTotal, filterOn || searching)}
        </span>
      </div>
      {canFilter && expanded && (
        <div id={chipRowId} className={styles.chipRow}>
          <div className={styles.anchor} ref={anchorRef}>
            {active === null ? (
              <button
                type="button"
                ref={triggerRef}
                className={styles.add}
                data-testid="filter-add"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                + Add filter
              </button>
            ) : (
              <span className={styles.pill} data-testid="filter-pill-tag">
                <button
                  type="button"
                  ref={triggerRef}
                  className={styles.pillEdit}
                  data-testid="filter-pill-tag-edit"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label={`Tag filter: ${active.name}. Change it`}
                  onClick={() => setOpen((v) => !v)}
                >
                  <span className={styles.pillKey}>Tag is</span>
                  <TagChip tag={active} />
                </button>
                <button
                  type="button"
                  className={styles.pillRemove}
                  data-testid="filter-pill-tag-remove"
                  aria-label="Remove the tag filter"
                  title="Remove the tag filter"
                  onClick={remove}
                >
                  ×
                </button>
              </span>
            )}
            {open && (
              <div
                className={styles.menu}
                role="menu"
                aria-label="Filter by tag"
                onKeyDown={handleMenuKeyDown}
              >
                {ordered.length === 0 ? (
                  <>
                    <span className={styles.empty} data-testid="filter-no-tags">
                      No tags yet
                    </span>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.create}
                      data-testid="filter-create-tags"
                      onClick={createTags}
                    >
                      Create tags…
                    </button>
                  </>
                ) : (
                  ordered.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={t.id === activeTagId}
                      className={styles.row}
                      data-testid={`filter-tag-row-${t.id}`}
                      onClick={() => pick(t.id)}
                    >
                      <TagChip tag={t} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
