// Story 4.2 (FR-14) — the Quit-guard modal (renderer view-state).
//
// Rendered when `boardStore.quitGuard` is non-null (main detected ≥1 live
// app-launched session and pushed the guard payload). The modal asks the operator
// to confirm or cancel the quit.
//
// Design: UX-DR14 / DESIGN.md Dialogs:
//   - Centered overlay over a `--scrim`, `bg-surface-raised`, `--rounded-lg`, `shadow-dialog`.
//   - `Cancel` is DEFAULT-FOCUSED on mount (reflexive Enter cancels; Esc = Cancel — guarded
//     in App.tsx keydown; see App.tsx integration note).
//   - `Quit anyway` is the danger button (`--danger` red `#db4b4b`).
//   - Gold emphasis (`--needs-you`) for the "N agents are still working." count.
//   - Session list: each row shows `sessionName` + status in `font-mono` (c9watch-verbatim).
//   - `role="dialog"` + `aria-modal="true"` (mirrors Settings.tsx).
//   - NEVER logs session values — sessionName/status data stays off logs.
//
// Microcopy (UX-DR22 — terse, operator-to-operator):
//   Title: "Quit c9watch?"
//   Body:  "Quitting exits every session this app launched — their agent processes will be killed."
//   Gold:  "{N} agents are still working." (workingCount)
//   Buttons: Cancel / Quit anyway
//
// State: `quitGuard: QuitGuardPayload | null` in boardStore (RENDERER VIEW-STATE — session
// truth stays MAIN-owned; the payload is what main computed and pushed). The modal renders
// the payload verbatim — it does NOT re-derive counts. [.claude/rules/state.md]
//
// Wire (App.tsx):
//   - `window.quit.onGuardShow(payload => boardStore.getState().showQuitGuard(payload))` ONCE.
//   - `Ctrl+Q` keydown → `window.quit.requestQuit()` (the one chokepoint).
//   - Esc-while-guard-open → cancel the guard (intercept before showBoard falls through).
//   - Render `<QuitGuard/>` when `selectQuitGuard !== null`.
//
// [Source: story 4.2 Task 4; UX-DR14/22; DESIGN.md Dialogs; mockups/quit-guard.html;
//  .claude/rules/state.md; src/renderer/src/components/Settings/Settings.tsx (modal precedent)]

import { useEffect, useRef, type JSX } from 'react'
import type { QuitGuardPayload } from '../../../../shared/ipc/contract'
import { boardStore } from '../../stores/boardStore'
import styles from './QuitGuard.module.css'

interface QuitGuardProps {
  /** The payload main computed + pushed (total, workingCount, sessions). */
  payload: QuitGuardPayload
}

/**
 * The Quit-guard confirmation modal. Renders when boardStore.quitGuard is non-null.
 * Cancel → `window.quit.cancel()` + `boardStore.getState().clearQuitGuard()`.
 * Quit anyway → `window.quit.confirm()` (main proceeds the quit; app exits).
 */
export function QuitGuard({ payload }: QuitGuardProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  // Cancel is DEFAULT-FOCUSED on mount (UX-DR14: reflexive Enter cancels, not quits).
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  function handleCancel(): void {
    // Cancel: clear renderer state + tell main (no teardown — FROZEN #1).
    boardStore.getState().clearQuitGuard()
    void window.quit.cancel()
  }

  function handleConfirm(): void {
    // Quit anyway: tell main to proceed (main runs teardown + app.quit()).
    // The app exits; no need to clear renderer state (the process will end).
    void window.quit.confirm()
  }

  const { total, workingCount, sessions } = payload

  return (
    <div
      className={styles.overlay}
      data-testid="quit-guard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quit c9watch?"
    >
      <div className={styles.panel} data-testid="quit-guard-panel">
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title} data-testid="quit-guard-title">
            Quit c9watch?
          </span>
        </div>

        {/* Body */}
        <p className={styles.body} data-testid="quit-guard-body">
          Quitting exits every session this app launched — their agent processes will be killed.
        </p>

        {/* Gold emphasis: working count */}
        {workingCount > 0 && (
          <div className={styles.workingAlert} data-testid="quit-guard-working-count">
            {workingCount} {workingCount === 1 ? 'agent is' : 'agents are'} still working.
          </div>
        )}

        {/* Session list */}
        {sessions.length > 0 && (
          <ul className={styles.sessionList} data-testid="quit-guard-session-list">
            {sessions.map((s) => (
              <li key={s.id} className={styles.sessionRow} data-testid="quit-guard-session-row">
                <span className={styles.sessionName}>{s.sessionName}</span>
                <span className={styles.sessionStatus}>{s.status}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Summary count (always shown) */}
        <p className={styles.summary} data-testid="quit-guard-total">
          {total} {total === 1 ? 'session' : 'sessions'} will be terminated.
        </p>

        {/* Button row: Cancel (default-focused) + Quit anyway (danger) */}
        <div className={styles.actions}>
          <button
            type="button"
            ref={cancelRef}
            className={styles.cancelButton}
            data-testid="quit-guard-cancel"
            onClick={handleCancel}
            // autoFocus is set in useEffect above for deterministic focus-on-mount.
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            data-testid="quit-guard-confirm"
            onClick={handleConfirm}
          >
            Quit anyway
          </button>
        </div>
      </div>
    </div>
  )
}
