// Popover.Submenu — a menu row that opens a list BESIDE it (moved from AppMenu, 2026-10-16, when
// the filter bar's type menu became the second caller). Hover opens, click OPENS (never toggles),
// ArrowRight opens and focuses the first row, ArrowLeft goes back. Which side it opens on is the
// caller's: AppMenu sits at the window's right edge (`left`), the filter menu opens `right`
// unless it would leave the window.
import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react'
import { leavingProps, useLeaving } from '../Presence/leaving'
import { PopoverItem, PopoverItemEnd, PopoverItemIcon, PopoverSurface } from './PopoverParts'
import styles from './Popover.module.css'

export interface PopoverSubmenuProps {
  label: string
  icon: ReactNode
  /** Where the list opens: AppMenu sits at the window's right edge (`left`); the filter menu
   *  opens `right` unless it would leave the window. */
  side: 'left' | 'right'
  open: boolean
  /** Grows (> 0) each time a KEY opened this submenu: its first row then takes focus. */
  focusRequest: number
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onOpenFromKey: () => void
  onBack: () => void
  testId: string
  listTestId: string
  children: ReactNode
}

export function PopoverSubmenu({
  label,
  icon,
  side,
  open,
  focusRequest,
  triggerRef,
  onOpen,
  onOpenFromKey,
  onBack,
  testId,
  listTestId,
  children
}: PopoverSubmenuProps): JSX.Element {
  const leaving = useLeaving()
  const listRef = useRef<HTMLDivElement | null>(null)
  // Focus follows the KEY that opened it, once the render that draws the list is done. A hover
  // open never changes `focusRequest`, so it never pulls focus in. The first row of ANY menu role:
  // the filter's value rows are `menuitemcheckbox` / `menuitemradio`.
  useEffect(() => {
    if (focusRequest > 0) {
      listRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    }
  }, [focusRequest])
  return (
    <div className={styles.subAnchor}>
      <PopoverItem
        role="menuitem"
        buttonRef={triggerRef}
        testId={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        // OPEN, never toggle: a mouse points at the row (opening it) before it clicks.
        onClick={onOpen}
        onMouseEnter={onOpen}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight') return
          e.preventDefault()
          onOpenFromKey()
        }}
      >
        <PopoverItemIcon>{icon}</PopoverItemIcon>
        {label}
        {/* Forward, like every submenu marker, whichever side the list opens on. */}
        <PopoverItemEnd>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </PopoverItemEnd>
      </PopoverItem>
      {open && (
        <div
          className={styles.submenuWrap}
          data-side={side}
          data-testid={`${listTestId}-wrap`}
          ref={listRef}
          {...leavingProps(leaving)}
        >
          <PopoverSurface
            role="menu"
            aria-label={label}
            data-side={side}
            testId={listTestId}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft') return
              e.preventDefault()
              onBack()
            }}
          >
            {children}
          </PopoverSurface>
        </div>
      )}
    </div>
  )
}
