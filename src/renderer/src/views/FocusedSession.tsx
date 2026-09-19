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
import type { Template } from '../../../shared/ipc/contract'
import { useShallow } from 'zustand/react/shallow'
import { EmbeddedTerminal } from '../terminal/EmbeddedTerminal'
import { AttentionRail } from '../components/attention/AttentionRail'
import { NameSyncMark } from '../components/SessionCard/SessionCard'
import { archiveTerminal, sessionIdForTerminal } from '../lib/sessionExit'
import {
  boardStore,
  useBoard,
  selectFocusedTerminalId,
  selectKeptAliveTerminalIds,
  type BoardState,
  type BoardSession
} from '../stores/boardStore'
// Story 3.5 (SM-2) — the paired acknowledge helper (board view-state + telemetry signal).
// The two consequences are paired in ONE place (FROZEN-5); boardStore stays pure view-state.
import { acknowledgeSession } from '../utils/acknowledgeSession'
import styles from './FocusedSession.module.css'

/**
 * Story 4.3 (FR-15) — resolve a human-readable name for the focused terminal.
 * The focused terminal may or may not have a correlated session (pre-correlation = no card yet).
 * Falls back gracefully to the bare terminalId rather than crashing (FROZEN F4: never crash).
 * Never logs a session name or path — only a code on failure.
 */
function resolveSessionName(terminalId: string): string {
  const state = boardStore.getState()
  // Reverse-lookup: find a sessionId whose terminalId matches the focused terminal.
  const sessionId = Object.entries(state.terminalIdBySessionId).find(
    ([, tid]) => tid === terminalId
  )?.[0]
  if (sessionId !== undefined) {
    const session = state.sessionsById[sessionId]
    if (session !== undefined) return session.sessionName
  }
  // Pre-correlation or no card yet: degrade gracefully to the bare terminalId (never crash).
  return terminalId
}

/** Name-sync (D-11) — the focused terminal's own BoardSession, so the bar can draw its name +
 *  the ⟳ mark. Reverse-looks-up the session bound to the focused terminal; null pre-correlation
 *  (no card yet) or with no terminal focused — the title falls back to an empty string, never a
 *  crash. */
const selectFocusedSession = (s: BoardState): BoardSession | null => {
  const sid = Object.entries(s.terminalIdBySessionId).find(
    ([, t]) => t === s.focusedTerminalId
  )?.[0]
  return sid === undefined ? null : (s.sessionsById[sid] ?? null)
}

export interface FocusedSessionProps {
  /** Return to the Board (Esc-to-Board / the "← Board" affordance). */
  onBack: () => void
  /** Story 6.1 — launch a NEW session (App's handleNewSession: picker → launch → focused view).
   *  Threaded to every EmbeddedTerminal so the dead pane's one "New session" button uses the
   *  SAME flow as the header button / Ctrl+N. */
  onNewSession: () => void
  /** Session-templates parity — the dead pane's popover seams (App's `handleTemplateSession`
   *  / `handleManageTemplates`, the SAME handlers the header button uses). Threaded to every
   *  EmbeddedTerminal alongside `onNewSession`; omitted ⇒ those rows are no-ops. */
  onPickTemplate?: (template: Template) => void
  onManageTemplates?: () => void
  /** Session-naming A2 — rename a rail row's session (opens the rename prompt). Threaded to the
   *  AttentionRail; omitted ⇒ the rail renders no pencil. */
  onRenameSession?: (sessionId: string) => void
  /** Tags — a rail peek's Edit changed a session's tags. Threaded to the AttentionRail; omitted ⇒
   *  the rail offers no tag editing. */
  onSetSessionTags?: (sessionId: string, tagIds: string[]) => void
  /** Tags — opens the Tags dialog; the rail's untagged rows use it while no tag exists yet. */
  onManageTags?: () => void
}

export function FocusedSession({
  onBack,
  onNewSession,
  onPickTemplate,
  onManageTemplates,
  onRenameSession,
  onSetSessionTags,
  onManageTags
}: FocusedSessionProps): JSX.Element {
  // The currently-visible terminal (the others are kept alive but hidden). A primitive selector.
  const focusedTerminalId = useBoard(selectFocusedTerminalId)
  // The set of terminals to keep ALIVE (correlated ∪ focused). useShallow so an equal set does not
  // remount the terminals (a remount would tear down + respawn the PTY — terminal.md forbids it).
  const keptAlive = useBoard(useShallow(selectKeptAliveTerminalIds))
  // Name-sync (D-11) — the focused terminal's session, for the bar's title + ⟳ mark.
  const focusedSession = useBoard(selectFocusedSession)

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

  // Past sessions (D-3) — Archive the currently-focused terminal's session. No confirmation
  // (reversible through Past sessions…) — fires straight through sessionExit.archiveTerminal,
  // the SAME helper the card and Ctrl+W call. No-op guard: focusedTerminalId should never be
  // null in the focused view, but guard anyway (degrade gracefully, never crash).
  const handleArchive = useCallback((): void => {
    if (focusedTerminalId === null) return
    archiveTerminal(focusedTerminalId)
  }, [focusedTerminalId])

  // Past sessions (D-5) — Delete needs a confirm (it is the one exit that is NOT reversible — no
  // record is kept). Raises the SAME confirm modal Story 4.3 built (UX-DR14: destructive action
  // needs confirm); the confirm's own Delete button does the actual delete.
  const handleDelete = useCallback((): void => {
    if (focusedTerminalId === null) return
    boardStore.getState().showStopConfirm({
      terminalId: focusedTerminalId,
      sessionId: sessionIdForTerminal(focusedTerminalId),
      sessionName: resolveSessionName(focusedTerminalId)
    })
  }, [focusedTerminalId])

  return (
    <div className={styles.focused} data-testid="focused-session">
      <AttentionRail
        onActivateSession={onActivateSession}
        {...(onRenameSession ? { onRenameSession } : {})}
        {...(onSetSessionTags ? { onSetSessionTags } : {})}
        {...(onManageTags ? { onManageTags } : {})}
      />
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
          {/* Name-sync (D-11) — the focused session's own name + ⟳ mark while a rename is
              pending. A separate element from the stop button on purpose: Task 10 replaces the
              stop button with Archive/Delete affordances, and this title must not depend on it. */}
          <span
            className={styles.title}
            data-testid="focused-title"
            title={focusedSession?.sessionName}
          >
            {focusedSession?.sessionName ?? ''}
            {focusedSession?.nameSyncPending === true && <NameSyncMark />}
          </span>
          {/* Past sessions (D-3) — Archive: no confirm, reversible through Past sessions…. Same
              chord as Ctrl+W (App.tsx), which archives directly without opening this bar. */}
          <button
            type="button"
            className={styles.archiveButton}
            data-testid="focused-archive"
            onClick={handleArchive}
            aria-label="Archive this session (Ctrl+W)"
            title="Archive — keeps it in Past sessions"
          >
            Archive
          </button>
          {/* Past sessions (D-5) — Delete: opens the confirm (UX-DR14: the one exit that is NOT
              reversible needs a confirm; danger styling is on the confirm's Delete button, and
              this trigger carries the danger treatment too so it reads as the risky one). */}
          <button
            type="button"
            className={`${styles.archiveButton} ${styles.deleteButtonFocused}`}
            data-testid="focused-delete"
            onClick={handleDelete}
            aria-label="Delete this session"
          >
            Delete
          </button>
        </div>
        <div className={styles.terminalWrap}>
          {keptAlive.map((terminalId) => (
            <EmbeddedTerminal
              key={terminalId}
              terminalId={terminalId}
              active={terminalId === focusedTerminalId}
              onNewSession={onNewSession}
              {...(onPickTemplate ? { onPickTemplate } : {})}
              {...(onManageTemplates ? { onManageTemplates } : {})}
            />
          ))}
        </div>
        {/* Reserved bottom strip: breathing room today, future toolbar mount point.
            Sibling of .terminalWrap (NOT a child) so it stays out of the terminal
            stacking context. Empty + aria-hidden until a later story populates it. */}
        <div className={styles.toolStrip} aria-hidden="true" />
      </div>
    </div>
  )
}
