// The header ☰ MENU (2026-09-14): the ONE header control besides `+ New session`. It replaced three
// icon buttons (⚙ settings, ⌨ shortcuts, the tag icon). Rows: `Settings…`, `Shortcuts…`, `Tags`, a
// SUBMENU holding the tag icon's own two rows unchanged (`Manage tags…` / `Manage rules…`), and
// `Past sessions…` — ALWAYS the last row, after `Tags` (D-6). The submenu opens to the LEFT: the
// menu sits at the window's right edge. Each row keeps the icon its old header button had (⚙, ⌨, the
// tag glyph), so it is still found by shape; `Past sessions…` carries a clock.
//
// Escape peels ONE layer: the submenu first, then the menu, and never the app's own Escape
// (Focused → Board) while either is open. It listens on the whole anchor, so it also works while
// focus is still on the ☰ button, where a mouse click leaves it.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import styles from './AppMenu.module.css'

export interface AppMenuProps {
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onManageTags: () => void
  /** Rules — the `Manage rules…` row. Omitted ⇒ no row (a control nobody handles is not rendered). */
  onManageRules?: () => void
  /** Past sessions (D-6) — ALWAYS the last row, after Tags. Omitted ⇒ no row. */
  onOpenPastSessions?: () => void
}

function MenuIcon(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M2.5 8h11M2.5 12h11"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Past sessions — a clock face, on the tag glyph's 14px grid and 1.5 stroke. */
function ClockIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  )
}

export function AppMenu({
  onOpenSettings,
  onOpenShortcuts,
  onManageTags,
  onManageRules,
  onOpenPastSessions
}: AppMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const tagsRef = useRef<HTMLButtonElement | null>(null)
  const firstTagRowRef = useRef<HTMLButtonElement | null>(null)
  // Bumped by ArrowRight: the submenu's first row takes focus once the render that draws it is done.
  const [submenuFocusTick, setSubmenuFocusTick] = useState(0)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      setOpen(false)
      setTagsOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (submenuFocusTick > 0) firstTagRowRef.current?.focus()
  }, [submenuFocusTick])

  function closeAll(): void {
    setOpen(false)
    setTagsOpen(false)
  }

  function choose(action: () => void): void {
    closeAll()
    action()
  }

  function closeSubmenu(): void {
    setTagsOpen(false)
    tagsRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    if (tagsOpen) {
      closeSubmenu()
      return
    }
    setOpen(false)
    buttonRef.current?.focus()
  }

  function handleTagsKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key !== 'ArrowRight') return
    e.preventDefault()
    setTagsOpen(true)
    setSubmenuFocusTick((n) => n + 1)
  }

  function handleSubmenuKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft') return
    e.preventDefault()
    closeSubmenu()
  }

  return (
    <div className={styles.anchor} ref={anchorRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        data-testid="app-menu"
        aria-label="Menu"
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) closeAll()
          else setOpen(true)
        }}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className={styles.menu} role="menu" aria-label="Menu" data-testid="app-menu-list">
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-testid="app-menu-settings"
            onClick={() => choose(onOpenSettings)}
            onMouseEnter={() => setTagsOpen(false)}
          >
            <span className={styles.icon} aria-hidden="true">
              ⚙
            </span>
            Settings…
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-testid="app-menu-shortcuts"
            onClick={() => choose(onOpenShortcuts)}
            onMouseEnter={() => setTagsOpen(false)}
          >
            <span className={styles.icon} aria-hidden="true">
              ⌨
            </span>
            Shortcuts…
          </button>
          <div className={styles.subAnchor}>
            <button
              type="button"
              role="menuitem"
              ref={tagsRef}
              className={`${styles.item} ${styles.subTrigger}`}
              data-testid="app-menu-tags"
              aria-haspopup="menu"
              aria-expanded={tagsOpen}
              // OPEN, never toggle: a mouse points at the row (opening it) before it clicks.
              onClick={() => setTagsOpen(true)}
              onMouseEnter={() => setTagsOpen(true)}
              onKeyDown={handleTagsKeyDown}
            >
              <span className={styles.icon} aria-hidden="true">
                <TagGlyphIcon size={14} />
              </span>
              Tags
            </button>
            {tagsOpen && (
              <div
                className={styles.submenu}
                role="menu"
                aria-label="Tags"
                data-testid="app-menu-tags-list"
                onKeyDown={handleSubmenuKeyDown}
              >
                <button
                  type="button"
                  role="menuitem"
                  ref={firstTagRowRef}
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
          {onOpenPastSessions !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              data-testid="app-menu-past-sessions"
              onClick={() => choose(onOpenPastSessions)}
              onMouseEnter={() => setTagsOpen(false)}
            >
              <span className={styles.icon} aria-hidden="true">
                <ClockIcon />
              </span>
              Past sessions…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
