// Action feedback (spec 2026-09-29 §1.2) — the ONE place a toast is drawn. Mounted once in App.tsx,
// OUTSIDE the subtree that goes `inert` while a modal is open (the header and the two view layers),
// so ✕ works over a dialog. There is no focus trap (inert IS the trap), so a toast is Tab-reachable
// from inside a dialog — accepted; the later focus work inherits it knowingly.
//
// A toast's action is NOT rendered while a modal is open (design.md: a control the operator must not
// use is not rendered — the notification-click precedent, UX-DR14). ✕ and the timer are unaffected.
// Hover or focus inside a toast pauses its timer. Only an error draws a kind glyph (`!`); the action
// is the toast's one primary Button, with its icon (spec 2026-10-14). Themes target `[data-toast]`
// and `[data-toast-kind]`, never a test id.
import { useRef, type JSX } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { Button } from '../Button/Button'
import { LucideIcon, type LucideIconName } from '../Icon/LucideIcon'
import { WorkspaceLabel } from '../WorkspaceLabel/WorkspaceLabel'
import {
  selectToasts,
  toastStore,
  type Toast,
  type ToastActionIcon,
  type ToastState
} from '../../stores/toastStore'
import { useBoard } from '../../stores/boardStore'
import { modalOpenIn } from '../../lib/modals'
import styles from './Toaster.module.css'

// Only an error draws a kind glyph (spec 2026-10-14): success and info read from their words, as in
// the pen. The action carries its own icon instead.
const ERROR_GLYPH = '!'

const ACTION_ICON: Readonly<Record<ToastActionIcon, LucideIconName>> = {
  resume: 'rotate-ccw',
  open: 'arrow-up-right'
}

export interface ToasterProps {
  /** Tests pass their own store (an injected clock); the app uses the singleton. */
  store?: StoreApi<ToastState>
}

export function Toaster({ store = toastStore }: ToasterProps): JSX.Element {
  const toasts = useStore(store, selectToasts)
  const modalOpen = useBoard(modalOpenIn)
  return (
    <section className={styles.region} aria-label="Notifications" data-testid="toaster">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} store={store} modalOpen={modalOpen} />
      ))}
    </section>
  )
}

function ToastCard({
  toast,
  store,
  modalOpen
}: {
  toast: Toast
  store: StoreApi<ToastState>
  modalOpen: boolean
}): JSX.Element {
  const { pause, resume, dismiss, runAction } = store.getState()
  // Hover and focus are tracked apart: the timer resumes only when NEITHER holds (enter, focus,
  // blur used to resume while the pointer was still over the toast).
  const hovered = useRef(false)
  const focused = useRef(false)
  const settle = (): void => {
    if (hovered.current || focused.current) pause(toast.id)
    else resume(toast.id)
  }
  return (
    <div
      className={styles.toast}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-toast=""
      data-toast-kind={toast.kind}
      {...(toast.leaving ? { 'data-leaving': '' } : {})}
      data-testid="toast"
      onMouseEnter={() => {
        hovered.current = true
        settle()
      }}
      onMouseLeave={() => {
        hovered.current = false
        settle()
      }}
      onFocus={() => {
        focused.current = true
        settle()
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        focused.current = false
        settle()
      }}
    >
      {toast.kind === 'error' && (
        <span className={styles.glyph} data-kind="error" aria-hidden="true">
          {ERROR_GLYPH}
        </span>
      )}
      <div className={styles.text}>
        <p className={styles.title}>
          <span className={styles.titleText} title={toast.title}>
            {toast.title}
          </span>
          {toast.workspace !== undefined && (
            <WorkspaceLabel name={toast.workspace.name} tone={toast.workspace.tone} />
          )}
        </p>
        {toast.detail !== undefined && (
          <p className={styles.detail} title={toast.detail}>
            {toast.detail}
          </p>
        )}
      </div>
      {toast.action !== undefined && !modalOpen && (
        <Button
          variant="primary"
          size="sm"
          testId="toast-action"
          onClick={() => runAction(toast.id)}
        >
          <LucideIcon name={ACTION_ICON[toast.action.icon]} />
          {toast.action.label}
        </Button>
      )}
      <Button
        variant="secondary"
        size="xs"
        icon="round"
        testId="toast-dismiss"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
      >
        ✕
      </Button>
    </div>
  )
}
