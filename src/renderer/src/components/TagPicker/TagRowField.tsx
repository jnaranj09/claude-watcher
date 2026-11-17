// A form's Tags field: the chips of the shown tags (or the caller's `empty` node when there are
// none), the ghost tag-glyph button, and the TagPicker under it. Shared by the Memory form and the
// Past sessions form, so the open state, the refs and the focus return live once: Escape hands
// focus back to the button; an outside click leaves it where the operator clicked.
import { useId, useRef, useState, type JSX, type ReactNode } from 'react'
import type { Tag } from '../../../../shared/ipc/contract'
import { Button } from '../Button/Button'
import { Presence } from '../Presence/Presence'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { TagPicker } from './TagPicker'

export interface TagRowFieldProps {
  /** The chips to draw. */
  shownTags: readonly Tag[]
  /** What the picker offers, in tag-list order. */
  offeredTags: readonly Tag[]
  /** The picker's ticked ids (it applies the session's pending toggles on top). */
  selectedIds: readonly string[]
  /** The session whose in-flight toggles the picker shows; omit for a plain list. */
  sessionId?: string | undefined
  onChange: (tagIds: string[]) => void
  /** The trigger's accessible name and title, and the picker's label. */
  label: string
  /** Drawn instead of the chips when none are shown; omit to draw nothing. */
  empty?: ReactNode
  /** The row's own class (each dialog's `valueRow`). */
  className: string | undefined
  testIds: { field: string; chips: string; button: string; picker: string }
}

export function TagRowField({
  shownTags,
  offeredTags,
  selectedIds,
  sessionId,
  onChange,
  label,
  empty,
  className,
  testIds
}: TagRowFieldProps): JSX.Element {
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  function close(reason: 'escape' | 'outside'): void {
    setOpen(false)
    // Only Escape hands focus back; an outside click leaves focus where the operator clicked.
    if (reason === 'escape') buttonRef.current?.focus()
  }

  return (
    <div className={className} ref={anchorRef} data-testid={testIds.field}>
      {shownTags.length > 0 || empty === undefined ? (
        <TagChipRow tags={shownTags} testId={testIds.chips} />
      ) : (
        empty
      )}
      <Button
        variant="ghost"
        size="xs"
        icon
        buttonRef={buttonRef}
        testId={testIds.button}
        aria-expanded={open}
        aria-controls={pickerId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <TagGlyphIcon />
      </Button>
      <Presence value={open || null}>
        {() => (
          <TagPicker
            id={pickerId}
            tags={offeredTags}
            selectedIds={selectedIds}
            sessionId={sessionId}
            onChange={onChange}
            onClose={close}
            anchorRef={anchorRef}
            triggerRef={buttonRef}
            testId={testIds.picker}
            label={label}
          />
        )}
      </Presence>
    </div>
  )
}
