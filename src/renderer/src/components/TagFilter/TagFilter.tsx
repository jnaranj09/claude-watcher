// Tags — the header TAG FILTER (spec §4.3): a button beside the workspace switcher that narrows the
// board and the rail to ONE tag, plus the entry to the Tags dialog. A popover built like
// WorkspaceSwitcher — not a Select, because it also carries an action row (`Manage tags…`).
//
// It offers exactly what the ACTIVE workspace can see (T-11): All tags, the global tags, then this
// workspace's own. The choice is renderer view-state (tagsStore, never persisted) and it CLEARS when
// the operator switches to a workspace that cannot see it (spec §4.1). Alerts ignore it.
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
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
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import styles from './TagFilter.module.css'

export interface TagFilterProps {
  onManageTags: () => void
}

export function TagFilter({ onManageTags }: TagFilterProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
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

  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  const handleMenuKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeAndRefocus()
      }
    },
    [closeAndRefocus]
  )

  function pick(id: string | null): void {
    setTagFilter(id)
    closeAndRefocus()
  }

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        data-testid="tag-filter"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tag filter: ${active?.name ?? 'All tags'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <TagGlyphIcon size={13} className={styles.glyph ?? ''} />
        {active === null ? (
          <span className={styles.label}>All tags</span>
        ) : (
          <TagChip tag={active} />
        )}
      </button>
      {open && (
        <div className={styles.menu} role="menu" onKeyDown={handleMenuKeyDown}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={activeTagId === null}
            className={styles.row}
            data-testid="tag-filter-all"
            onClick={() => pick(null)}
          >
            All tags
          </button>
          {ordered.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === activeTagId}
              className={styles.row}
              data-testid={`tag-filter-row-${t.id}`}
              onClick={() => pick(t.id)}
            >
              <TagChip tag={t} />
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={styles.manage}
            data-testid="tag-filter-manage-tags"
            onClick={() => {
              setOpen(false)
              onManageTags()
            }}
          >
            Manage tags…
          </button>
        </div>
      )}
    </div>
  )
}
