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
// The list is PORTALED to document.body and placed under its trigger by `useAnchoredPlacement`,
// as Select's is (spec 2026-11-14 memory context index, ruling C4): drawn inside its anchor, a
// form's scroll body (the Memory dialog's Tags field) would cut it. It follows the trigger on
// scroll and resize. Out of the DOM order, Tab from the trigger no longer reaches it, so opening
// it moves focus to its first row (once it is placed and seen), as Select's list does; Tab and
// Shift+Tab walk the rows.
//
// Mechanics mirror the card's move menu and WorkspaceSwitcher: Escape closes and STOPS (it must not
// also close a dialog or leave the focused view), and so does Tab past the last row or Shift+Tab
// before the first; each hands focus back to the trigger first, so the next Tab continues from
// there (Select has no Tab rule: its list sits last in the page). A mousedown outside both the
// anchor and the list closes and leaves focus where the operator clicked. Clicks and Enter/Space keydowns stop propagating, because on a board card this list is a
// React child of the card's own role="button" (a portal still bubbles React events to it) —
// without that, ticking a tag would also open the session.
import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import type { Tag } from '../../../../shared/ipc/contract'
import { TagMenu, TagMenuNote, TagMenuRow } from '../TagMenu/TagMenu'
import { applyPendingTags, useTags } from '../../stores/tagsStore'
import { useLeaving } from '../Presence/leaving'
import { useAnchoredPlacement } from '../Popover/useAnchoredPlacement'

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
  /** `escape`: a key closed it (Escape, or Tab past either end), and focus is already back on the
   *  trigger; `outside`: a mousedown outside the anchor and the list. */
  onClose: (reason: 'escape' | 'outside') => void
  /** The element holding the trigger — a mousedown outside it and outside the list closes the
   *  list. */
  anchorRef: RefObject<HTMLElement | null>
  /** The button that opens the list: the list sits under it, its right edges lined up (left edges when
   *  that would leave the window). */
  triggerRef: RefObject<HTMLElement | null>
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
  triggerRef,
  testId,
  label
}: TagPickerProps): JSX.Element {
  const pending = useTags((s) =>
    sessionId === undefined ? undefined : s.pendingBySession.get(sessionId)
  )
  const leaving = useLeaving()
  const listRef = useRef<HTMLDivElement | null>(null)
  // The list keeps its own minimum width (TagMenu.module.css), never the small trigger's.
  const placement = {
    ...useAnchoredPlacement(true, triggerRef, listRef, 'end'),
    minWidth: undefined
  }
  // Focus the first row once the list is placed: a list still hidden for its first measure cannot
  // take focus. With no row (no tag in scope) the list itself takes it, so its keys (Escape, Tab)
  // stay the list's and do not reach the dialog behind it.
  const measured = placement.visibility !== 'hidden'
  const focusedOnOpen = useRef(false)
  useEffect(() => {
    if (!measured || focusedOnOpen.current) return
    focusedOnOpen.current = true
    const list = listRef.current
    const target =
      list?.querySelector<HTMLElement>('[data-popover-item]') ??
      list?.querySelector<HTMLElement>('[role="group"]')
    target?.focus()
  }, [measured])
  useEffect(() => {
    // Leaving (overlay motion): it is already closing; a second outside click must not close again.
    if (leaving) return
    const onMouseDown = (e: globalThis.MouseEvent): void => {
      // Both roots: the list is portaled OUT of the anchor.
      const target = e.target as Node
      if (anchorRef.current?.contains(target) === true) return
      if (listRef.current?.contains(target) === true) return
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

  /** A key closed the list: focus goes back to the trigger first. */
  function closeFromKey(): void {
    triggerRef.current?.focus()
    onClose('escape')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeFromKey()
      return
    }
    if (e.key === 'Tab') {
      const rows = [...(listRef.current?.querySelectorAll('[data-popover-item]') ?? [])]
      const at = rows.findIndex((row) => row === document.activeElement)
      const pastEnd = e.shiftKey ? at === 0 : at === rows.length - 1
      // No row: Tab from the list itself is past both ends.
      if (rows.length === 0 || (at !== -1 && pastEnd)) {
        e.preventDefault()
        e.stopPropagation()
        closeFromKey()
      }
      return
    }
    // Do NOT preventDefault: the row button's own click (Enter / Space) must still happen.
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  }

  return createPortal(
    <TagMenu
      align="end"
      role="group"
      ariaLabel={label}
      testId={testId}
      id={id}
      anchored={{ ref: listRef, style: placement }}
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {tags.length === 0 ? (
        <TagMenuNote testId={`${testId}-empty`}>
          No tags here yet. Create them in the ☰ menu: Tags › Manage tags.
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
    </TagMenu>,
    document.body
  )
}
