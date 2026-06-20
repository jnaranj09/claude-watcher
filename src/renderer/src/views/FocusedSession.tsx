// Story 3.2 (FR-11) → Story 3.4 (FR-16) — the Focused-session view.
//
// Story 3.2 birthed this as the MINIMAL view (one terminal + Esc-to-Board). Story 3.4 adds the
// persistent ATTENTION RAIL alongside the terminal (architecture.md:126-128 — the focused view
// needs a persistent nav region reflecting live session+attention state), and KEEPS ALL
// app-launched terminals ALIVE so a rail switch is a PURE renderer show/hide (terminal.md:
// visibility:hidden, NEVER display:none; the xterm instances are NEVER recreated on switch).
//
// TOPOLOGY (Task 4.3): the view mounts EVERY known app-launched terminal (the kept-alive set =
// correlated bindings ∪ the current focusedTerminalId), but only the ACTIVE one is visible (the
// rest are `active={false}` → visibility:hidden, kept alive). Switching = flipping which is the
// `focusedTerminalId` (pure view-state) — NO per-switch IPC, NO input sent (alert-only,
// FR-9-consistent). A rail row whose session's terminalId is not yet known (pre-correlation) is
// alert-only-non-switchable; it becomes switchable once the CH.launchCorrelated binding lands.
//
// Board ↔ Focused-session is renderer VIEW-STATE (viewMode in the store), NOT routing and NOT a
// second window (single-window, UX-DR24). Esc returns to the Board (UX-DR21); the "← Board" button
// is the visible equivalent (the Esc keybinding lives in App.tsx). [Source: story 3.4 Task 4;
// UX-DR9/21/24; terminal.md; src/renderer/src/terminal/EmbeddedTerminal.tsx (reused, `active` prop)]
import { useCallback, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EmbeddedTerminal } from '../terminal/EmbeddedTerminal'
import { AttentionRail } from '../components/attention/AttentionRail'
import {
  boardStore,
  useBoard,
  selectFocusedTerminalId,
  selectKeptAliveTerminalIds
} from '../stores/boardStore'
// Story 3.5 (SM-2) — the paired acknowledge helper (board view-state + telemetry signal).
// The two consequences are paired in ONE place (FROZEN-5); boardStore stays pure view-state.
import { acknowledgeSession } from '../utils/acknowledgeSession'
import styles from './FocusedSession.module.css'

export interface FocusedSessionProps {
  /** Return to the Board (Esc-to-Board / the "← Board" affordance). */
  onBack: () => void
}

export function FocusedSession({ onBack }: FocusedSessionProps): JSX.Element {
  // The currently-visible terminal (the others are kept alive but hidden). A primitive selector.
  const focusedTerminalId = useBoard(selectFocusedTerminalId)
  // The set of terminals to keep ALIVE (correlated ∪ focused). useShallow so an equal set does not
  // remount the terminals (a remount would tear down + respawn the PTY — terminal.md forbids it).
  const keptAlive = useBoard(useShallow(selectKeptAliveTerminalIds))

  // A rail row click: switch the visible terminal to that session's terminal (if its binding is
  // known) AND acknowledge it. PURE view-state — no input is sent (alert-only). A session whose
  // binding has not landed yet is alert-only: we still acknowledge (the operator saw it), but the
  // terminal switch waits until the binding arrives (degrade gracefully, never crash).
  // Story 3.5 (SM-2): uses acknowledgeSession() to pair the view-state clear + telemetry signal
  // at ONE call site (FROZEN-5). boardStore.acknowledge stays pure view-state (unchanged).
  const onActivateSession = useCallback((sessionId: string): void => {
    const state = boardStore.getState()
    const terminalId = state.terminalIdBySessionId[sessionId]
    acknowledgeSession(sessionId)
    if (terminalId !== undefined) state.switchTerminal(terminalId)
  }, [])

  return (
    <div className={styles.focused} data-testid="focused-session">
      <AttentionRail onActivateSession={onActivateSession} />
      <div className={styles.main}>
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.backButton}
            data-testid="focused-back"
            onClick={onBack}
            aria-label="Back to board (Esc)"
          >
            ← Board
          </button>
          <span className={styles.hint}>Esc to return</span>
        </div>
        <div className={styles.terminalWrap}>
          {keptAlive.map((terminalId) => (
            <EmbeddedTerminal
              key={terminalId}
              terminalId={terminalId}
              active={terminalId === focusedTerminalId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
