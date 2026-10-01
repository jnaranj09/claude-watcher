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
import { Button } from '../Button/Button'
import { Popover } from '../Popover/Popover'
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
      <Button
        variant="secondary"
        icon
        buttonRef={buttonRef}
        testId="app-menu"
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
      </Button>
      {open && (
        <div className={styles.menuWrap}>
          <Popover.Surface role="menu" aria-label="Menu" testId="app-menu-list">
            <Popover.Item
              role="menuitem"
              testId="app-menu-settings"
              onClick={() => choose(onOpenSettings)}
              onMouseEnter={() => setTagsOpen(false)}
            >
              <Popover.ItemIcon>⚙</Popover.ItemIcon>
              Settings…
            </Popover.Item>
            <Popover.Item
              role="menuitem"
              testId="app-menu-shortcuts"
              onClick={() => choose(onOpenShortcuts)}
              onMouseEnter={() => setTagsOpen(false)}
            >
              <Popover.ItemIcon>⌨</Popover.ItemIcon>
              Shortcuts…
            </Popover.Item>
            <div className={styles.subAnchor}>
              <Popover.Item
                role="menuitem"
                buttonRef={tagsRef}
                testId="app-menu-tags"
                aria-haspopup="menu"
                aria-expanded={tagsOpen}
                // OPEN, never toggle: a mouse points at the row (opening it) before it clicks.
                onClick={() => setTagsOpen(true)}
                onMouseEnter={() => setTagsOpen(true)}
                onKeyDown={handleTagsKeyDown}
              >
                <Popover.ItemIcon>
                  <TagGlyphIcon size={14} />
                </Popover.ItemIcon>
                Tags
                {/* Points LEFT: the way the submenu opens. */}
                <Popover.ItemEnd>
                  <span className={styles.chevron} aria-hidden="true">
                    ‹
                  </span>
                </Popover.ItemEnd>
              </Popover.Item>
              {tagsOpen && (
                <div className={styles.submenuWrap}>
                  <Popover.Surface
                    role="menu"
                    aria-label="Tags"
                    testId="app-menu-tags-list"
                    onKeyDown={handleSubmenuKeyDown}
                  >
                    <Popover.Item
                      role="menuitem"
                      buttonRef={firstTagRowRef}
                      testId="tags-menu-manage-tags"
                      onClick={() => choose(onManageTags)}
                    >
                      Manage tags…
                    </Popover.Item>
                    {onManageRules !== undefined && (
                      <Popover.Item
                        role="menuitem"
                        testId="tags-menu-manage-rules"
                        onClick={() => choose(onManageRules)}
                      >
                        Manage rules…
                      </Popover.Item>
                    )}
                  </Popover.Surface>
                </div>
              )}
            </div>
            {onOpenPastSessions !== undefined && (
              <Popover.Item
                role="menuitem"
                testId="app-menu-past-sessions"
                onClick={() => choose(onOpenPastSessions)}
                onMouseEnter={() => setTagsOpen(false)}
              >
                <Popover.ItemIcon>
                  <ClockIcon />
                </Popover.ItemIcon>
                Past sessions…
              </Popover.Item>
            )}
          </Popover.Surface>
        </div>
      )}
    </div>
  )
}
