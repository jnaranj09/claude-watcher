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
//   - Session list: each row shows `sessionName` + the BOARD's status label in `font-mono`
//     (`statusLabel(column)` — the same words the dot/rail use; never the raw status string).
//   - `role="dialog"` + `aria-modal="true"` (mirrors Settings.tsx).
//   - NEVER logs session values — sessionName/status data stays off logs.
//
// Microcopy (UX-DR22 — terse, operator-to-operator):
//   Title: "Quit Claude Watcher?"
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
import { statusLabel } from '../StatusDot/statusLabel'
import { Button } from '../Button/Button'
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
      aria-label="Quit Claude Watcher?"
    >
      <div className={styles.panel} data-testid="quit-guard-panel">
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title} data-testid="quit-guard-title">
            Quit Claude Watcher?
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
                {/* The BOARD's label (Working / Needs you / Idle), from the same
                    `statusLabel(column)` the dot and the rail use — NOT the raw
                    internal status. The raw string is main-internal vocabulary: a
                    launched-but-idle session sits at `Connecting` (claude 2.1.246
                    fires no SessionStart, so nothing moves it off until the first
                    prompt), which read as "Connecting" for a card the board was
                    already showing as Idle. */}
                <span className={styles.sessionStatus}>{statusLabel(s.column)}</span>
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
          {/* Focus-on-mount lives in the useEffect above, not autoFocus, so it is deterministic. */}
          <Button
            variant="secondary"
            buttonRef={cancelRef}
            testId="quit-guard-cancel"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          {/* `armed`: this IS the confirming press, so it is drawn filled, not red-outlined. */}
          <Button variant="danger" armed testId="quit-guard-confirm" onClick={handleConfirm}>
            Quit anyway
          </Button>
        </div>
      </div>
    </div>
  )
}
