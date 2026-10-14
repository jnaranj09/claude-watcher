// Session templates — the `+ New session` button and the popover's open state. Open/close is
// LOCAL (transient, like the Settings gear); the outside-click listener lives here so a click on
// the button itself toggles instead of close-then-reopen. THREE placements share this component:
// the header (`variant="header"`, menu right-aligned), the empty board's centered primary
// (`variant="primary"`, menu centered under the button) and the dead-terminal pane
// (`variant="dead"`, centered). The menu is PORTALED in all three — see the comment on the render.
import { useCallback, useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../Button/Button'
import { useShallow } from 'zustand/react/shallow'
import type { Template } from '../../../../shared/ipc/contract'
import {
  makeSelectVisibleTemplates,
  setTemplateFavorite,
  useTemplates
} from '../../stores/templatesStore'
import { toast } from '../../stores/toastStore'
import { favoriteErrorCopy } from '../../lib/favoriteCopy'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { selectActiveWorkspaceId, useWorkspaces } from '../../stores/workspacesStore'
import { NewSessionMenu } from './NewSessionMenu'
import { Presence } from '../Presence/Presence'
import styles from './NewSessionMenu.module.css'
import { leavingProps } from '../Presence/leaving'
import { useAnchoredPlacement } from '../Popover/useAnchoredPlacement'

export type NewSessionButtonVariant = 'header' | 'primary' | 'dead'

export interface NewSessionButtonProps {
  onPickFolder: () => void
  onPickTemplate: (template: Template) => void
  onManage: () => void
  /** Placement: `header` (default), the empty board's centered `primary`, or the dead
   *  terminal pane's `dead`. Placement ONLY — the menu and its three seams are
   *  identical in all three. */
  variant?: NewSessionButtonVariant
  /** The button's `data-testid`; defaults to the header's `header-new-session`. */
  testId?: string
  /** Action feedback (spec 2026-09-29 §2.3): the native folder picker is open — one at a time. */
  busy?: boolean | undefined
  /** Workspaces W-13: App's Ctrl+N opens THIS popover through the opener written here (header
   *  only). A busy button is disabled, so the opener does nothing while the picker is open. */
  openRef?: RefObject<(() => void) | null>
}

export function NewSessionButton({
  onPickFolder,
  onPickTemplate,
  onManage,
  variant = 'header',
  testId = 'header-new-session',
  busy = false,
  openRef
}: NewSessionButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const portalRef = useRef<HTMLDivElement | null>(null)
  // Workspaces — the popover shows only what is usable NOW: global templates plus the active
  // workspace's own (Task 11). useShallow: makeSelectVisibleTemplates returns a new array.
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const templates = useTemplates(useShallow(makeSelectVisibleTemplates(activeWorkspaceId)))

  const placement = useAnchoredPlacement(
    open,
    buttonRef,
    portalRef,
    variant === 'header' ? 'end' : 'center'
  )

  // Favorites — a refused pin is an error toast (the popover has no message slot); the pin
  // keeps main's state. The popover stays open: the pin is not a pick.
  const pinning = useAsyncAction(async (t: Template): Promise<void> => {
    try {
      await setTemplateFavorite(t.id, !t.favorite)
    } catch (err) {
      toast.error(favoriteErrorCopy(err))
    }
  })

  const close = useCallback((): void => setOpen(false), [])
  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (openRef === undefined) return
    openRef.current = busy ? () => {} : () => setOpen(true)
    return () => {
      openRef.current = null
    }
  }, [openRef, busy])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      // Containment must consider BOTH roots: the menu is portaled OUT of the anchor, so an
      // anchor-only check would read the first click inside the menu as "outside" and close it.
      if (anchorRef.current?.contains(target) === true) return
      if (portalRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

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
      onToggleFavorite={(t) => void pinning.run(t)}
      favoriteBusy={pinning.busy}
    />
  )

  return (
    <div ref={anchorRef} className={styles.anchor}>
      {/* `primary`: the ONE main action of the header, the empty board and the dead pane alike. */}
      <Button
        variant="primary"
        buttonRef={buttonRef}
        testId={testId}
        busy={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        + New session
      </Button>
      {/* Portaled to document.body in every placement: in place, the dead pane's frame
          (`overflow: clip`) cut it, and on the empty board it ran off the window bottom with no
          scrollbar to recover it (the TerminalContextMenu precedent). */}
      <Presence value={open || null}>
        {(_, leaving) =>
          createPortal(
            <div
              ref={portalRef}
              className={styles.portalAnchor}
              style={placement}
              {...leavingProps(leaving)}
            >
              {menu}
            </div>,
            document.body
          )
        }
      </Presence>
    </div>
  )
}
