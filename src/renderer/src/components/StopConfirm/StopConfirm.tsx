// Story 4.3 (FR-15) — the Stop-confirm modal (renderer view-state).
//
// Rendered when `boardStore.stopConfirm` is non-null (the operator triggered the per-session
// stop via the ⏹ Stop session header button or Ctrl+W while in the focused view).
//
// Design: UX-DR14 / DESIGN.md Dialogs (mirrors QuitGuard.tsx):
//   - Centered overlay over a `--scrim`, `bg-surface-raised`, `--rounded-lg`, `shadow-dialog`.
//   - `Cancel` is DEFAULT-FOCUSED on mount (reflexive Enter cancels; Esc = Cancel — guarded
//     in App.tsx keydown; see App.tsx integration note).
//   - `Stop` is the danger button (`--danger` red `#db4b4b`).
//   - `role="dialog"` + `aria-modal="true"` (mirrors Settings.tsx / QuitGuard.tsx).
//   - NEVER logs session values — sessionName/terminalId data stays off logs.
//
// Microcopy (UX-DR22 — terse, operator-to-operator):
//   Title: "Stop {sessionName}?"
//   Body:  "Its agent process will exit."
//   Buttons: Cancel / Stop
//
// THE FROZEN ORDERING (F1 / HEADLINE CORRECTNESS CONSTRAINT):
//   Stop → (1) window.terminal.stop(terminalId) FIRST (explicit PTY kill, CH.terminalStop path),
//          THEN (2) change view-state: clearStopConfirm() + showBoard().
//   NEVER clear focusedTerminalId first and let the FocusedSession unmount do the stop —
//   that is the B-1 PTY-killing path (App.tsx:240-244 M-2 mount-latch WARNING).
//   terminalManager.stop is idempotent, so the later unmount-stop is a safe no-op.
//   This ordering GUARANTEES the kill regardless of what unmounts subsequently.
//
// State: `stopConfirm: StopConfirmPayload | null` in boardStore (RENDERER VIEW-STATE).
//        The modal renders the payload verbatim — it does NOT re-derive session truth.
//        [.claude/rules/state.md]
//
// Wire (App.tsx):
//   - `Ctrl+W` keydown → compute payload + `boardStore.getState().showStopConfirm(payload)`.
//   - Esc-while-stop-confirm-open → clearStopConfirm (cancel; guard is the topmost layer).
//   - Render `<StopConfirm/>` when `selectStopConfirm !== null`.
//
// [Source: story 4.3 Task 3; UX-DR14/22; DESIGN.md Dialogs; QuitGuard.tsx (mirror);
//  .claude/rules/state.md; src/renderer/src/terminal/EmbeddedTerminal.tsx:185-189/:232-237
//  (the window.terminal.stop catch pattern — REUSE); orchestrator FROZEN #1]

import { useEffect, useRef, type JSX } from 'react'
import type { StopConfirmPayload } from '../../stores/boardStore'
import { boardStore } from '../../stores/boardStore'
import styles from './StopConfirm.module.css'

interface StopConfirmProps {
  /** The payload (terminalId + sessionName) for the session being stopped. */
  payload: StopConfirmPayload
}

/**
 * The Stop-confirm modal. Rendered when boardStore.stopConfirm is non-null.
 * Cancel → `boardStore.getState().clearStopConfirm()` (session keeps running).
 * Stop → (1) window.terminal.stop(terminalId) FIRST, THEN (2) clearStopConfirm() + showBoard().
 *
 * This ordering is FROZEN (F1 / orchestrator FROZEN #1): explicit PTY kill before view-state
 * change — stopping the focused session when it is the last terminal empties focusedTerminalId +
 * the kept-alive set → hasFocusableTerminal flips false → FocusedSession UNMOUNTS (App.tsx:240-244
 * M-2 mount-latch WARNING). The explicit stop guarantees the kill; the unmount-stop is a safe
 * idempotent no-op (terminalManager.stop is idempotent).
 */
export function StopConfirm({ payload }: StopConfirmProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const { terminalId, sessionName } = payload

  // Cancel is DEFAULT-FOCUSED on mount (UX-DR14: reflexive Enter cancels, not stops).
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  function handleCancel(): void {
    // Cancel: clear renderer view-state. The session keeps running — no stop.
    boardStore.getState().clearStopConfirm()
  }

  function handleStop(): void {
    // THE FROZEN ORDERING (F1): explicit PTY kill FIRST, THEN view-state change.
    // (1) Stop the PTY explicitly in main via the wired CH.terminalStop path.
    //     fire-and-forget with code-only catch (never the session value/path — zod-boundaries.md).
    void window.terminal.stop(terminalId).catch(() => {
      console.warn('[c9watch][stop] code=stop_failed')
    })
    // (2) THEN change the renderer view-state: clear the confirm + return to the board.
    //     The explicit stop above GUARANTEES the kill; any subsequent unmount-stop is a safe no-op.
    boardStore.getState().clearStopConfirm()
    boardStore.getState().showBoard()
  }

  return (
    <div
      className={styles.overlay}
      data-testid="stop-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Stop ${sessionName}?`}
    >
      <div className={styles.panel} data-testid="stop-confirm-panel">
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title} data-testid="stop-confirm-title">
            Stop {sessionName}?
          </span>
        </div>

        {/* Body (UX-DR22 microcopy) */}
        <p className={styles.body} data-testid="stop-confirm-body">
          Its agent process will exit.
        </p>

        {/* Button row: Cancel (default-focused) + Stop (danger) */}
        <div className={styles.actions}>
          <button
            type="button"
            ref={cancelRef}
            className={styles.cancelButton}
            data-testid="stop-confirm-cancel"
            onClick={handleCancel}
            // autoFocus is set in useEffect above for deterministic focus-on-mount.
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            data-testid="stop-confirm-stop"
            onClick={handleStop}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}
