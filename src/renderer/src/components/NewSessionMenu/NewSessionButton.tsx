// Session templates — the `+ New session` button and the popover's open state. Open/close is
// LOCAL (transient, like the Settings gear); the outside-click listener lives here so a click on
// the button itself toggles instead of close-then-reopen. Two placements share this component:
// the header (`variant="header"`, menu right-aligned) and the empty board's centered primary
// (`variant="primary"`, larger padding, menu centered under the button).
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { Template } from '../../../../shared/ipc/contract'
import { selectTemplates, useTemplates } from '../../stores/templatesStore'
import { NewSessionMenu } from './NewSessionMenu'
import styles from './NewSessionMenu.module.css'

export type NewSessionButtonVariant = 'header' | 'primary'

export interface NewSessionButtonProps {
  onPickFolder: () => void
  onPickTemplate: (template: Template) => void
  onManage: () => void
  /** Placement: `header` (default) or the empty board's centered `primary`. */
  variant?: NewSessionButtonVariant
  /** The button's `data-testid`; defaults to the header's `header-new-session`. */
  testId?: string
}

export function NewSessionButton({
  onPickFolder,
  onPickTemplate,
  onManage,
  variant = 'header',
  testId = 'header-new-session'
}: NewSessionButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const templates = useTemplates(selectTemplates)

  const close = useCallback((): void => setOpen(false), [])
  const closeAndRefocus = useCallback((): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Modifier classes stack on the base (no `composes` — the repo's CSS modules don't use it).
  const primary = variant === 'primary'
  return (
    <div
      ref={anchorRef}
      className={primary ? `${styles.anchor} ${styles.anchorPrimary}` : styles.anchor}
    >
      <button
        ref={buttonRef}
        type="button"
        className={primary ? `${styles.button} ${styles.buttonPrimary}` : styles.button}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        + New session
      </button>
      {open && (
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
      )}
    </div>
  )
}
