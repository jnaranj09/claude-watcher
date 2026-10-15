// Story 4.3 (FR-15) → Past sessions (D-5) — the DELETE-confirm modal (renderer view-state).
//
// This component WAS the Stop-confirm (Story 4.3): the operator's ⏹ Stop session button / Ctrl+W
// raised it before killing the pty. Task 10 (D-3/D-5) splits the single exit into two: Archive
// (D-3) needs no confirmation at all (it is reversible through `Past sessions`) and fires
// straight from `sessionExit.archiveTerminal` — the card, the focused bar and Ctrl+W all call it
// directly, never through this modal. DELETE is the one exit that is NOT reversible (no record is
// kept), so it is the only one still gated behind a confirm — this component, unrenamed (the
// test ids and the component name stay `StopConfirm`/`stop-confirm-*` — only its copy and its
// confirm action changed).
//
// Design: UX-DR14 / DESIGN.md Dialogs (mirrors QuitGuard.tsx):
//   - Centered overlay over a `--scrim`, `bg-surface-raised`, `--rounded-lg`, `shadow-dialog`.
//   - `Cancel` is DEFAULT-FOCUSED on mount (reflexive Enter cancels; Esc = Cancel — guarded
//     in App.tsx keydown; see App.tsx integration note).
//   - `Delete` is the danger button (`--danger` red `#db4b4b`).
//   - `role="dialog"` + `aria-modal="true"` (mirrors Settings.tsx / QuitGuard.tsx).
//   - NEVER logs session values — sessionName/terminalId data stays off logs.
//
// Microcopy (D-5 — terse, operator-to-operator; no session name interpolated, unlike the old
// Stop-confirm's "Stop {sessionName}?" — the copy is now generic to every delete):
//   Title: "Delete session?"
//   Body:  "The session is stopped and nothing is kept in Past sessions. Claude's own files are
//           not touched."
//   Buttons: Cancel / Delete
//
// THE FROZEN ORDERING (F1 / HEADLINE CORRECTNESS CONSTRAINT) — UNCHANGED by D-5, only its target
// changed from `window.terminal.stop` to the DELETE ipc:
//   Delete → sessionExit.deleteTerminal(terminalId, sessionId, sessionName), which itself
//            (1) SENDS window.launch.deleteSession FIRST (explicit stop + drop-record, the
//                CH.sessionDelete path), THEN
//            (2) returns to the board at once, and
//            (3) once main answers, forgets the launched-terminal registry entry and clears the
//                confirm — or, on a refusal, clears the confirm, keeps the terminal and toasts
//                `Could not delete "<name>".` (action feedback, spec 2026-09-29 §2.3). The
//                Delete button is busy meanwhile: one press, one delete.
//   NEVER clear focusedTerminalId first and let the FocusedSession unmount do the stop —
//   that is the B-1 PTY-killing path (App.tsx M-2 mount-latch WARNING).
//   The main-side stop is idempotent, so a later unmount-stop is a safe no-op.
//   This ordering GUARANTEES the kill regardless of what unmounts subsequently.
//
// State: `stopConfirm: StopConfirmPayload | null` in boardStore (RENDERER VIEW-STATE).
//        The modal renders the payload verbatim — it does NOT re-derive session truth.
//        [.claude/rules/state.md]
//
// Wire:
//   - The card's red Delete control / the focused bar's Delete button →
//     `boardStore.getState().showStopConfirm(payload)`.
//   - Esc-while-confirm-open → clearStopConfirm (cancel; guard is the topmost layer, App.tsx).
//   - Render `<StopConfirm/>` when `selectStopConfirm !== null`.
//
// See QuitGuard.tsx (mirror), .claude/rules/state.md and ../../lib/sessionExit.ts.

import { useEffect, useRef, type JSX } from 'react'
import type { StopConfirmPayload } from '../../stores/boardStore'
import { boardStore } from '../../stores/boardStore'
import { deleteTerminal } from '../../lib/sessionExit'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import { Button } from '../Button/Button'
import styles from './StopConfirm.module.css'
import { leavingProps, useLeaving } from '../Presence/leaving'

interface StopConfirmProps {
  /** The payload (terminalId + sessionId + sessionName) for the session being deleted. */
  payload: StopConfirmPayload
}

/**
 * The Delete-confirm modal (D-5). Rendered when boardStore.stopConfirm is non-null.
 * Cancel → `boardStore.getState().clearStopConfirm()` (session keeps running).
 * Delete → `sessionExit.deleteTerminal(terminalId, sessionId, sessionName)`, which sends the
 * stop + drop-record FIRST, then returns to the board and, once main answers, clears the confirm
 * (the F1 ordering — see the header comment).
 */
export function StopConfirm({ payload }: StopConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  // Overlay motion (spec 2026-10-04 §6): leaving = playing its exit inside <Presence>.
  const leaving = useLeaving()
  const { terminalId, sessionId } = payload

  // Cancel is DEFAULT-FOCUSED on mount (UX-DR14: reflexive Enter cancels, not deletes).
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  function handleCancel(): void {
    // Cancel: clear renderer view-state. The session keeps running — nothing is deleted.
    boardStore.getState().clearStopConfirm()
  }

  // D-5 — the ONE call site. sessionExit.deleteTerminal owns the F1 ordering (the main-side delete
  // SENT first, then the view) and the failure toast. Busy while main answers: one press, one
  // delete (spec 2026-09-29 §2.3).
  const del = useAsyncAction(() => deleteTerminal(terminalId, sessionId, payload.sessionName))

  return (
    <div
      className={styles.overlay}
      data-motion="dialog"
      {...leavingProps(leaving)}
      data-testid="stop-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete session?"
    >
      <div className={styles.panel} data-testid="stop-confirm-panel">
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title} data-testid="stop-confirm-title">
            Delete session?
          </span>
        </div>

        {/* Body (D-5 microcopy) */}
        <p className={styles.body} data-testid="stop-confirm-body">
          The session is stopped and nothing is kept in Past sessions. Claude&apos;s own files are
          not touched.
        </p>

        {/* Button row: Cancel (default-focused) + Delete (danger) */}
        <div className={styles.actions}>
          {/* Focus-on-mount lives in the useEffect above, not autoFocus, so it is deterministic. */}
          <Button
            variant="secondary"
            buttonRef={cancelRef}
            testId="stop-confirm-cancel"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          {/* `armed`: this IS the confirming press, so it is drawn filled, not red-outlined. */}
          <Button
            variant="danger"
            armed
            busy={del.busy}
            testId="stop-confirm-stop"
            onClick={() => void del.run()}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
