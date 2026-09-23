// Session templates — the `+ New session` button and the popover's open state. Open/close is
// LOCAL (transient, like the Settings gear); the outside-click listener lives here so a click on
// the button itself toggles instead of close-then-reopen. THREE placements share this component:
// the header (`variant="header"`, menu right-aligned), the empty board's centered primary
// (`variant="primary"`, larger padding, menu centered under the button) and the dead-terminal
// pane (`variant="dead"`, menu PORTALED — see the portal comment on the render below).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../Button/Button'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import { makeSelectVisibleTemplates, useTemplates } from '../../stores/templatesStore'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { NewSessionMenu } from './NewSessionMenu'
import styles from './NewSessionMenu.module.css'

export type NewSessionButtonVariant = 'header' | 'primary' | 'dead'

export interface NewSessionButtonProps {
  onPickFolder: () => void
  onPickTemplate: (template: Template) => void
  onManage: () => void
  /** Placement: `header` (default), the empty board's centered `primary`, or the dead
   *  terminal pane's portaled `dead`. Placement ONLY — the menu and its three seams are
   *  identical in all three. */
  variant?: NewSessionButtonVariant
  /** The button's `data-testid`; defaults to the header's `header-new-session`. */
  testId?: string
}

/** Gap between the button and the portaled popover, and the margin kept off the viewport edge. */
const MENU_GAP = 4
const VIEWPORT_MARGIN = 16

export function NewSessionButton({
  onPickFolder,
  onPickTemplate,
  onManage,
  variant = 'header',
  testId = 'header-new-session'
}: NewSessionButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<CSSProperties | null>(null)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const portalRef = useRef<HTMLDivElement | null>(null)
  // Workspaces — the popover shows only what is usable NOW: global templates plus the active
  // workspace's own (Task 11). useShallow: makeSelectVisibleTemplates returns a new array.
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const templates = useTemplates(useShallow(makeSelectVisibleTemplates(activeWorkspaceId)))

  // Modifier classes stack on the base (no `composes` — the repo's CSS modules don't use it).
  const primary = variant === 'primary'
  const portaled = variant === 'dead'

  const close = useCallback((): void => setOpen(false), [])
  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      // Containment must consider BOTH roots: the `dead` variant's menu is portaled OUT of the
      // anchor, so an anchor-only check would read the first click inside the menu as "outside"
      // and close it. `portalRef` is null for the inline variants, so their behavior is unchanged.
      if (anchorRef.current?.contains(target) === true) return
      if (portalRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Portaled placement: measure the button in the VIEWPORT before paint (useLayoutEffect, so the
  // popover never paints at the wrong spot), and re-measure on resize. No flip logic is needed —
  // the dead-pane button is vertically centred in a near-full-height frame, so the room below is
  // always about half the viewport; we CLAMP the height and let `.list` scroll.
  useLayoutEffect(() => {
    if (!open || !portaled) return
    const measure = (): void => {
      const button = buttonRef.current
      if (button === null) return
      const rect = button.getBoundingClientRect()
      setCoords({
        top: rect.bottom + MENU_GAP,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
        maxHeight: Math.max(0, window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN)
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, portaled])

  const menu = (
    <NewSessionMenu
      templates={templates}
      onPickFolder={() => {
        close()
        onPickFolder()
      }}
      onPickTemplate={(t) => {
        close()
        onPickTemplate(t)
      }}
      onManage={() => {
        close()
        onManage()
      }}
      onClose={closeAndRefocus}
    />
  )

  return (
    <div
      ref={anchorRef}
      className={primary ? `${styles.anchor} ${styles.anchorPrimary}` : styles.anchor}
    >
      {/* `primary`: the ONE main action of the header, the empty board and the dead pane alike. */}
      <Button
        variant="primary"
        buttonRef={buttonRef}
        testId={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        + New session
      </Button>
      {/* The `dead` variant portals its menu to document.body: its host terminal frame is
          `overflow: clip`, so an in-anchor popover would be cut at the frame edge with no
          scrollbar to recover it (the TerminalContextMenu precedent). The inline variants are
          unchanged — their frames do not clip. */}
      {open &&
        (portaled
          ? createPortal(
              <div ref={portalRef} className={styles.portalAnchor} style={coords ?? undefined}>
                {menu}
              </div>,
              document.body
            )
          : menu)}
    </div>
  )
}
