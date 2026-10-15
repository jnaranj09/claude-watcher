// The header ☰ MENU (2026-09-14): the ONE header control besides `+ New session`. Rows:
// `Settings`, `Shortcuts`, `Tags ›` (Manage tags / Manage rules) and `Sessions ›` (spec
// 2026-10-03 A: Active sessions / Past sessions / Templates / Import session) — ALWAYS the last
// row, in the slot `Past sessions` held, with its clock. Every row has an icon and no `…`
// (design.md, "Menu rows"). Both submenus are ONE `Submenu`: they open to the LEFT
// (the menu sits at the window's right edge), hover opens, click OPENS (never toggles), ArrowRight
// opens on the first row, ArrowLeft goes back, and only one is open at a time.
//
// Escape peels ONE layer: the open submenu first, then the menu, and never the app's own Escape
// (Focused → Board) while either is open. It listens on the whole anchor, so it also works while
// focus is still on the ☰ button, where a mouse click leaves it.
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import type { SessionsPage } from '../../stores/boardStore'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import {
  ArchiveIcon,
  ClockIcon,
  ImportIcon,
  KeyboardIcon,
  RulesIcon,
  SlidersIcon,
  TemplateIcon,
  TerminalIcon
} from '../Icon/MenuIcons'
import { Button } from '../Button/Button'
import { Popover } from '../Popover/Popover'
import { Presence } from '../Presence/Presence'
import styles from './AppMenu.module.css'
import { leavingProps } from '../Presence/leaving'

export interface AppMenuProps {
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onManageTags: () => void
  /** Rules — the `Manage rules` row. Omitted ⇒ no row (a control nobody handles is not rendered). */
  onManageRules?: () => void
  /** Sessions (spec 2026-10-03 A) — ALWAYS the last row, a submenu; each row opens the Sessions
   *  dialog on its page. Omitted ⇒ no row (a control nobody handles is not rendered). */
  onOpenSessions?: (page: SessionsPage) => void
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

type SubmenuId = 'tags' | 'sessions'

/** The Sessions submenu's rows, in the dialog's page order. */
const SESSIONS_ROWS: readonly { page: SessionsPage; label: string; icon: JSX.Element }[] = [
  { page: 'active', label: 'Active sessions', icon: <TerminalIcon /> },
  { page: 'past', label: 'Past sessions', icon: <ArchiveIcon /> },
  { page: 'templates', label: 'Templates', icon: <TemplateIcon /> },
  { page: 'import', label: 'Import session', icon: <ImportIcon /> }
]

interface SubmenuProps {
  id: SubmenuId
  label: string
  icon: ReactNode
  open: boolean
  /** Grows (> 0) each time ArrowRight opened THIS submenu: its first row then takes focus. */
  focusRequest: number
  triggerRef: RefObject<HTMLButtonElement | null>
  onOpen: () => void
  onOpenFromKey: () => void
  onBack: () => void
  children: ReactNode
}

/** A menu row that opens a submenu to its LEFT — Tags and Sessions share this one. */
function Submenu({
  id,
  label,
  icon,
  open,
  focusRequest,
  triggerRef,
  onOpen,
  onOpenFromKey,
  onBack,
  children
}: SubmenuProps): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)
  // Focus follows the KEY that opened it, once the render that draws the list is done. A hover
  // open never changes `focusRequest`, so it never pulls focus in.
  useEffect(() => {
    if (focusRequest > 0) listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [focusRequest])
  return (
    <div className={styles.subAnchor}>
      <Popover.Item
        role="menuitem"
        buttonRef={triggerRef}
        testId={`app-menu-${id}`}
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
        <Popover.ItemIcon>{icon}</Popover.ItemIcon>
        {label}
        {/* Forward, like every submenu marker; the submenu still opens to the LEFT. */}
        <Popover.ItemEnd>
          <span className={styles.chevron} aria-hidden="true">
            ›
          </span>
        </Popover.ItemEnd>
      </Popover.Item>
      {open && (
        <div className={styles.submenuWrap} ref={listRef}>
          <Popover.Surface
            role="menu"
            aria-label={label}
            testId={`app-menu-${id}-list`}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft') return
              e.preventDefault()
              onBack()
            }}
          >
            {children}
          </Popover.Surface>
        </div>
      )}
    </div>
  )
}

export function AppMenu({
  onOpenSettings,
  onOpenShortcuts,
  onManageTags,
  onManageRules,
  onOpenSessions
}: AppMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  // ONE submenu at a time: pointing at a row closes the other.
  const [submenu, setSubmenu] = useState<SubmenuId | null>(null)
  const [focusFirst, setFocusFirst] = useState<{ id: SubmenuId; n: number } | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const tagsRef = useRef<HTMLButtonElement | null>(null)
  const sessionsRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (anchorRef.current?.contains(e.target as Node) === true) return
      // State setters only (stable): the effect needs no function from the render in its deps.
      // `submenu` is NOT cleared: it fades out with the menu and is reset on the next open
      // (overlay motion, spec 2026-10-04).
      setOpen(false)
      setFocusFirst(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // The open submenu stays while the menu fades out (overlay motion); opening resets it.
  function closeAll(): void {
    setOpen(false)
    setFocusFirst(null)
  }

  function openMenu(): void {
    setSubmenu(null)
    setOpen(true)
  }

  function choose(action: () => void): void {
    closeAll()
    action()
  }

  /** ArrowLeft / Escape inside a submenu: close it and put focus back on ITS row. */
  function closeSubmenu(): void {
    if (submenu === 'tags') tagsRef.current?.focus()
    if (submenu === 'sessions') sessionsRef.current?.focus()
    setSubmenu(null)
  }

  function openFromKey(id: SubmenuId): void {
    setSubmenu(id)
    setFocusFirst((f) => ({ id, n: (f?.n ?? 0) + 1 }))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    if (submenu !== null) {
      closeSubmenu()
      return
    }
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div className={styles.anchor} ref={anchorRef} onKeyDown={handleKeyDown}>
      <Button
        variant="secondary"
        icon
        data-app-menu
        buttonRef={buttonRef}
        testId="app-menu"
        aria-label="Menu"
        title="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) closeAll()
          else openMenu()
        }}
      >
        <MenuIcon />
      </Button>
      <Presence value={open || null}>
        {(_, leaving) => (
          <div className={styles.menuWrap} {...leavingProps(leaving)}>
            <Popover.Surface role="menu" aria-label="Menu" testId="app-menu-list">
              <Popover.Item
                role="menuitem"
                testId="app-menu-settings"
                onClick={() => choose(onOpenSettings)}
                onMouseEnter={() => setSubmenu(null)}
              >
                <Popover.ItemIcon>
                  <SlidersIcon />
                </Popover.ItemIcon>
                Settings
              </Popover.Item>
              <Popover.Item
                role="menuitem"
                testId="app-menu-shortcuts"
                onClick={() => choose(onOpenShortcuts)}
                onMouseEnter={() => setSubmenu(null)}
              >
                <Popover.ItemIcon>
                  <KeyboardIcon />
                </Popover.ItemIcon>
                Shortcuts
              </Popover.Item>
              <Submenu
                id="tags"
                label="Tags"
                icon={<TagGlyphIcon size={14} />}
                open={submenu === 'tags'}
                focusRequest={focusFirst?.id === 'tags' ? focusFirst.n : 0}
                triggerRef={tagsRef}
                onOpen={() => setSubmenu('tags')}
                onOpenFromKey={() => openFromKey('tags')}
                onBack={closeSubmenu}
              >
                <Popover.Item
                  role="menuitem"
                  testId="tags-menu-manage-tags"
                  onClick={() => choose(onManageTags)}
                >
                  <Popover.ItemIcon>
                    <TagGlyphIcon size={14} />
                  </Popover.ItemIcon>
                  Manage tags
                </Popover.Item>
                {onManageRules !== undefined && (
                  <Popover.Item
                    role="menuitem"
                    testId="tags-menu-manage-rules"
                    onClick={() => choose(onManageRules)}
                  >
                    <Popover.ItemIcon>
                      <RulesIcon />
                    </Popover.ItemIcon>
                    Manage rules
                  </Popover.Item>
                )}
              </Submenu>
              {onOpenSessions !== undefined && (
                <Submenu
                  id="sessions"
                  label="Sessions"
                  icon={<ClockIcon />}
                  open={submenu === 'sessions'}
                  focusRequest={focusFirst?.id === 'sessions' ? focusFirst.n : 0}
                  triggerRef={sessionsRef}
                  onOpen={() => setSubmenu('sessions')}
                  onOpenFromKey={() => openFromKey('sessions')}
                  onBack={closeSubmenu}
                >
                  {SESSIONS_ROWS.map((row) => (
                    <Popover.Item
                      key={row.page}
                      role="menuitem"
                      testId={`sessions-menu-${row.page}`}
                      onClick={() => choose(() => onOpenSessions(row.page))}
                    >
                      <Popover.ItemIcon>{row.icon}</Popover.ItemIcon>
                      {row.label}
                    </Popover.Item>
                  ))}
                </Submenu>
              )}
            </Popover.Surface>
          </div>
        )}
      </Presence>
    </div>
  )
}
