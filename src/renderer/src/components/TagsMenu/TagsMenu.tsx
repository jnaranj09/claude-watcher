// Tags — the header TAGS MENU (2026-09-14): an icon-only button beside ⚙ and ⌨ that opens
// `Manage tags…` / `Manage rules…`. It filters nothing. The tag filter moved into the board's
// FilterBar, because a header button reading "All tags" did not read as a filter.
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import styles from './TagsMenu.module.css'

export interface TagsMenuProps {
  onManageTags: () => void
  /** Rules — the `Manage rules…` row. Omitted ⇒ no row (a control nobody handles is not rendered). */
  onManageRules?: () => void
}

export function TagsMenu({ onManageTags, onManageRules }: TagsMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Escape peels ONE layer: it closes this menu and must not also reach an Escape handler above it.
  const handleMenuKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  function choose(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        data-testid="tags-menu"
        aria-label="Tags and rules"
        title="Tags and rules"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <TagGlyphIcon size={16} />
      </button>
      {open && (
        <div className={styles.menu} role="menu" onKeyDown={handleMenuKeyDown}>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-testid="tags-menu-manage-tags"
            onClick={() => choose(onManageTags)}
          >
            Manage tags…
          </button>
          {onManageRules !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              data-testid="tags-menu-manage-rules"
              onClick={() => choose(onManageRules)}
            >
              Manage rules…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
