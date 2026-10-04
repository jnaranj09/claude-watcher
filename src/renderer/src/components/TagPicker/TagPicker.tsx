// Tags — the list that edits ONE card's tags (spec §4.3: the board card's `Tags…` button and the
// rail peek's `+ tag`). Offers only the tags the card's workspace can see (T-11 — the caller
// passes that list), in tag-list order. Every tick applies at once through `onChange`; there is no
// Save, because the card itself shows the result.
//
// Drawn by TagMenu, the board filter's tag list design (2026-09-29): a chip per row, a ✓ on the
// ones the card carries, no native checkbox. Each row is a `role="checkbox"` button, so it still
// reads as a checkbox. The chip carries the full name (`acme/prod`), like the filter list — the
// indented path label (D-13) is kept for the Tags dialog rail only.
//
// Mechanics mirror the card's move menu and WorkspaceSwitcher: Escape closes and STOPS (it must not
// also close a dialog or leave the focused view), a mousedown outside the anchor closes. Clicks and
// Enter/Space keydowns stop propagating, because on a board card this list is a DOM child of the
// card's own role="button" — without that, ticking a tag would also open the session.
import { useEffect, type JSX, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { TagMenu, TagMenuNote, TagMenuRow } from '../TagMenu/TagMenu'
import { applyPendingTags, useTags } from '../../stores/tagsStore'
import { useLeaving } from '../Presence/leaving'

export interface TagPickerProps {
  /** DOM id for the popup root. Lets a trigger button point `aria-controls` at it (SessionCard's
   *  Tags… button — design.md: no `aria-haspopup="menu"` here, this is a checkbox group). Optional:
   *  omit for a caller with no such trigger. */
  id?: string
  /** What the card may carry (global + its workspace), in tag-list order. */
  tags: readonly Tag[]
  /** The card's current tag ids. */
  selectedIds: readonly string[]
  /** The card's session. Its toggles still in flight (tagsStore's queue) show at once, and the
   *  next click builds on them (spec 2026-09-29 §2.3). Omitted → the plain `selectedIds`. */
  sessionId?: string | undefined
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
  sessionId,
  onChange,
  onClose,
  anchorRef,
  testId,
  label
}: TagPickerProps): JSX.Element {
  const pending = useTags((s) =>
    sessionId === undefined ? undefined : s.pendingBySession.get(sessionId)
  )
  const leaving = useLeaving()
  useEffect(() => {
    // Leaving (overlay motion): it is already closing; a second outside click must not close again.
    if (leaving) return
    const onMouseDown = (e: globalThis.MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      onClose('outside')
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchorRef, onClose, leaving])

  const selected = new Set(applyPendingTags(selectedIds, pending))

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
    // Do NOT preventDefault: the row button's own click (Enter / Space) must still happen.
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }

  return (
    <TagMenu
      align="end"
      role="group"
      ariaLabel={label}
      testId={testId}
      id={id}
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {tags.length === 0 ? (
        <TagMenuNote testId={`${testId}-empty`}>
          No tags here yet. Create them in the tag filter&apos;s Manage tags….
        </TagMenuNote>
      ) : (
        tags.map((t) => (
          <TagMenuRow
            key={t.id}
            tag={t}
            checked={selected.has(t.id)}
            role="checkbox"
            testId={`${testId}-row-${t.id}`}
            onClick={() => toggle(t.id)}
          />
        ))
      )}
    </TagMenu>
  )
}
