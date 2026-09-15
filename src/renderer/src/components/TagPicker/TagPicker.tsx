// Tags — the checkbox list that edits ONE card's tags (spec §4.3: the board card's `Tags…` menu
// and the rail peek's `Edit`). Offers only the tags the card's workspace can see (T-11 — the caller
// passes that list), in tag-list order. Every tick applies at once through `onChange`; there is no
// Save, because the card itself shows the result.
//
// Checkboxes are allowed: design.md scopes the TextInput rule to TEXT fields.
//
// Mechanics mirror the card's move menu and WorkspaceSwitcher: Escape closes and STOPS (it must not
// also close a dialog or leave the focused view), a mousedown outside the anchor closes. Clicks and
// Enter/Space keydowns stop propagating, because on a board card this list is a DOM child of the
// card's own role="button" — without that, ticking a tag would also open the session.
import { useEffect, type JSX, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { TagChip } from '../TagChip/TagChip'
import styles from './TagPicker.module.css'

export interface TagPickerProps {
  /** DOM id for the popup root. Lets a trigger button point `aria-controls` at it (SessionCard's
   *  Tags… button — design.md: no `aria-haspopup="menu"` here, this is a checkbox group). Optional:
   *  omit for a caller with no such trigger. */
  id?: string
  /** What the card may carry (global + its workspace), in tag-list order. */
  tags: readonly Tag[]
  /** The card's current tag ids. */
  selectedIds: readonly string[]
  /** The new tag list, in the order of `tags`. */
  onChange: (tagIds: string[]) => void
  onClose: (reason: 'escape' | 'outside') => void
  /** The element holding BOTH the trigger and this list — a mousedown outside it closes the list. */
  anchorRef: RefObject<HTMLElement | null>
  testId: string
  /** The accessible name, e.g. "Tags for billing api". */
  label: string
}

export function TagPicker({
  id,
  tags,
  selectedIds,
  onChange,
  onClose,
  anchorRef,
  testId,
  label
}: TagPickerProps): JSX.Element {
  useEffect(() => {
    const onMouseDown = (e: globalThis.MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      onClose('outside')
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorRef, onClose])

  const selected = new Set(selectedIds)

  function toggle(id: string): void {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(tags.filter((t) => next.has(t.id)).map((t) => t.id))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose('escape')
      return
    }
    // Do NOT preventDefault: the checkbox's own toggle must still happen.
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }

  return (
    <div
      className={styles.picker}
      role="group"
      aria-label={label}
      data-testid={testId}
      {...(id !== undefined ? { id } : {})}
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {tags.length === 0 ? (
        <p className={styles.empty} data-testid={`${testId}-empty`}>
          No tags here yet. Create them in the tag filter&apos;s Manage tags….
        </p>
      ) : (
        tags.map((t) => (
          <label key={t.id} className={styles.row} data-testid={`${testId}-row-${t.id}`}>
            <input
              type="checkbox"
              className={styles.checkbox}
              data-testid={`${testId}-check-${t.id}`}
              checked={selected.has(t.id)}
              onChange={() => toggle(t.id)}
            />
            <TagChip tag={t} />
          </label>
        ))
      )}
    </div>
  )
}
