// Tags — the board's FILTER BAR (2026-09-14, design option C). It replaced the header tag filter,
// whose "All tags" button did not read as a filter. The bar sits above the columns and says what it
// is: a `Filters` toggle, the active filter as a removable pill (`Tag is <chip> ×`), `+ Add filter`
// while none is on, and the count. Tag is the only filter type today, so `+ Add filter` opens the
// tag list DIRECTLY; a type step (`Tag ▸`) belongs here only once a second filter type exists.
//
// It starts COLLAPSED to a small `Filters` toggle, shorter than the bar, so it costs the board less
// height until it is used. The toggle opens the bar in place and stays at its left; collapsed with a
// filter on, it carries a count, because the pill is then out of sight while cards are still hidden.
// Open/closed is local view-state, never persisted.
//
// The choice is renderer view-state in tagsStore (one tag at a time, never persisted), offered from
// exactly what the ACTIVE workspace can see (T-11), and it CLEARS when the operator switches to a
// workspace that cannot see it (spec §4.1). It narrows the board and the rail; alerts ignore it.
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
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { TagChip } from '../TagChip/TagChip'
import styles from './FilterBar.module.css'

export interface FilterBarProps {
  /** Sessions the board shows under the current filter. */
  total: number
  /** Sessions in the active workspace, unfiltered. 0 ⇒ nothing to filter, so no bar. */
  workspaceTotal: number
  /** Opens the Tags dialog: the list's `Create tags…` row while no tag exists yet. Omitted ⇒ with no
   *  tag to offer, no bar at all (a control that opens onto nothing is not rendered). */
  onManageTags?: () => void
}

function countText(total: number, workspaceTotal: number, filtered: boolean): string {
  if (!filtered) return workspaceTotal === 1 ? '1 session' : `${workspaceTotal} sessions`
  return `${total} shown · ${workspaceTotal - total} hidden by the filter`
}

export function FilterBar({
  total,
  workspaceTotal,
  onManageTags
}: FilterBarProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  const controlsId = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  // The ONE list trigger on screen: `+ Add filter` with no filter on, the pill's button with one on.
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // Bumped when the list closes by a choice, Escape or ×. The trigger may then be a DIFFERENT
  // element (the pill replaces `+ Add filter`), so focus moves in an effect, after the render that
  // drew it.
  const [refocusTick, setRefocusTick] = useState(0)
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

  // Collapsing takes an open tag list with it: the list hangs off a control that is going away.
  function toggleExpanded(): void {
    setExpanded((v) => !v)
    setOpen(false)
  }

  if (workspaceTotal === 0) return null
  if (visible.length === 0 && onManageTags === undefined) return null

  const hiddenFilterOn = !expanded && active !== null

  return (
    <div
      className={styles.bar}
      role="group"
      aria-label="Filters"
      data-testid="filter-bar"
      data-expanded={expanded}
    >
      <button
        type="button"
        className={styles.toggle}
        data-testid="filter-toggle"
        aria-expanded={expanded}
        aria-controls={controlsId}
        title={expanded ? 'Hide filters' : 'Show filters'}
        {...(hiddenFilterOn ? { 'aria-label': 'Filters, 1 on' } : {})}
        onClick={toggleExpanded}
      >
        Filters
        {hiddenFilterOn && (
          <span className={styles.toggleCount} data-testid="filter-toggle-count">
            1
          </span>
        )}
      </button>
      {expanded && (
        <div id={controlsId} className={styles.controls}>
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
          <span className={styles.count} data-testid="filter-count">
            {countText(total, workspaceTotal, active !== null)}
          </span>
        </div>
      )}
    </div>
  )
}
