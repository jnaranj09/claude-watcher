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
// FR-9-consistent). A rail row whose session's terminalId is not yet known (the
// `CH.launchCorrelated` push has not arrived) is alert-only-non-switchable; it becomes switchable
// once that binding lands (pushed after a mint or a `/clear` rebind).
//
// Board ↔ Focused-session is renderer VIEW-STATE (viewMode in the store), NOT routing and NOT a
// second window (single-window, UX-DR24). Esc returns to the Board (UX-DR21); the "← Board" button
// is the visible equivalent (the Esc keybinding lives in App.tsx). [Source: story 3.4 Task 4;
// UX-DR9/21/24; terminal.md; src/renderer/src/terminal/EmbeddedTerminal.tsx (reused, `active` prop)]
import { useCallback, useEffect, useLayoutEffect, useState, type JSX } from 'react'
import type { Template } from '../../../shared/ipc/contract'
import { useShallow } from 'zustand/react/shallow'
import { EmbeddedTerminal } from '../terminal/EmbeddedTerminal'
// UX-10 — the dead pane's Resume: opens the conversation as a new terminal and drops the dead one.
import { resumeDeadTerminal } from '../stores/pastSessionsStore'
import { AttentionRail } from '../components/attention/AttentionRail'
import { NameSyncMark } from '../components/SessionCard/SessionCard'
import { StatusDot, type DotStatus } from '../components/StatusDot/StatusDot'
import { Button } from '../components/Button/Button'
import type { Column } from '../../../shared/ipc/contract'
import { archiveTerminal, sessionIdForTerminal } from '../lib/sessionExit'
import { useAsyncAction } from '../hooks/useAsyncAction'
import { toggleShellPane } from '../lib/shellPane'
import {
  boardStore,
  useBoard,
  selectFocusedTerminalId,
  selectKeptAliveTerminalIds,
  selectViewMode,
  selectShellPane,
  type BoardState,
  type BoardSession,
  type ShellPane
} from '../stores/boardStore'
// Story 3.5 (SM-2) — the paired acknowledge helper (board view-state + telemetry signal).
// The two consequences are paired in ONE place (FROZEN-5); boardStore stays pure view-state.
import { acknowledgeSession } from '../utils/acknowledgeSession'
import { isInsideTerminal } from '../lib/terminalFocus'
import styles from './FocusedSession.module.css'
import { SHELL_TERMS } from '../copy/terms'

/**
 * Story 4.3 (FR-15) — resolve a human-readable name for the focused terminal.
 * The focused terminal may or may not have a correlated session (no binding yet = no card yet).
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
  // No binding yet or no card yet: degrade gracefully to the bare terminalId (never crash).
  return terminalId
}

/** Name-sync (D-11) — the focused terminal's own BoardSession, so the bar can draw its name +
 *  the ⟳ mark. Reverse-looks-up the session bound to the focused terminal; null before the
 *  binding arrives (no card yet) or with no terminal focused — the title falls back to an empty
 *  string, never a crash. */
/** The title's dot IS the session's column, as on the rail and the board (compiler-checked). */
const DOT_STATUS_FOR_COLUMN: Record<Column, DotStatus> = {
  working: 'working',
  'needs-you': 'needs-you',
  idle: 'idle'
}

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

/** Back to the board — a line arrow on the ☰ menu icons' 16 grid, 1.5 stroke, 14px. */
function ArrowLeftIcon(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 8H3.5M7.5 4 3.5 8l4 4" />
    </svg>
  )
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
  // R10 — the view is on screen: the terminal in view takes DOM focus on every switch into it.
  const viewShown = useBoard(selectViewMode) === 'focused'
  // R1 (decision b) — is DOM focus inside a terminal? There every key is claude's (Esc is its
  // interrupt), so the bar may promise "Esc to return" ONLY while focus is outside it. Local
  // view-state, read from the DOM on focusin/focusout — never stored. A LAYOUT effect: the
  // terminals' own (passive) effects focus xterm on mount, and a child's effects run before this
  // parent's, so a passive listener would attach too late to see that first focus.
  const [focusInTerminal, setFocusInTerminal] = useState(() =>
    isInsideTerminal(document.activeElement)
  )
  useLayoutEffect(() => {
    const onFocusIn = (e: FocusEvent): void => setFocusInTerminal(isInsideTerminal(e.target))
    const onFocusOut = (e: FocusEvent): void =>
      setFocusInTerminal(isInsideTerminal(e.relatedTarget))
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

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
  // the SAME helper the card calls. No-op guard: focusedTerminalId should never be
  // null in the focused view, but guard anyway (degrade gracefully, never crash).
  // Action feedback (spec 2026-09-29 §2.3): busy until main answers — one press, one archive.
  const archive = useAsyncAction(async (): Promise<void> => {
    if (focusedTerminalId === null) return
    await archiveTerminal(focusedTerminalId)
  })

  // Card shell pane — every card's pane state (same reference until a pane changes).
  const shellPanes = useBoard((s) => s.shellPanes)
  const focusedPane: ShellPane | null = useBoard((s) =>
    focusedTerminalId === null ? null : selectShellPane(s, focusedTerminalId)
  )
  const shellVisible = focusedPane?.visible === true
  // The first press asks main for the companion (one invoke); later presses toggle. Busy until
  // main answers, so a double click opens ONE shell (spec 2026-09-29 §1.4).
  const shell = useAsyncAction(async (): Promise<void> => {
    if (focusedTerminalId === null) return
    await toggleShellPane(focusedTerminalId)
  })
  // Card shell pane — a pane whose parent frame is no longer rendered is gone (its unmount-stop
  // already stopped the shell in main). claude merely EXITING keeps the frame, so it keeps the pane.
  useEffect(() => {
    boardStore.getState().pruneShellPanes(keptAlive)
  }, [keptAlive])

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
    <div className={styles.focused} data-testid="focused-session" data-glass="column">
      <AttentionRail
        onActivateSession={onActivateSession}
        {...(onRenameSession ? { onRenameSession } : {})}
        {...(onSetSessionTags ? { onSetSessionTags } : {})}
        {...(onManageTags ? { onManageTags } : {})}
      />
      <div className={styles.main}>
        <div className={styles.bar} data-focused-bar>
          <Button
            variant="secondary"
            size="sm"
            testId="focused-back"
            onClick={onBack}
            aria-label="Back to board (Esc)"
          >
            <ArrowLeftIcon />
            Board
          </Button>
          {/* The session's name is the bar's TITLE, read as a breadcrumb: `← Board / ● name`. At the
              right edge it read as a stray label beside Archive/Delete. Its dot is the session's
              status (never colour-only: StatusDot carries an sr-only label); the ⟳ mark trails it
              while a rename is pending (D-11). The title stretches, so the hint and the two exits
              stay right-aligned. */}
          <span className={styles.crumbSep} aria-hidden>
            /
          </span>
          <span className={styles.title} data-testid="focused-title" data-focused-title="">
            {focusedSession && (
              <StatusDot status={DOT_STATUS_FOR_COLUMN[focusedSession.column]} labelHidden />
            )}
            <span className={styles.titleName} title={focusedSession?.sessionName}>
              {focusedSession?.sessionName ?? ''}
            </span>
            {focusedSession?.nameSyncPending === true && <NameSyncMark />}
          </span>
          {/* R1 — only a key that works where focus is. Inside the terminal Esc is claude's. */}
          {!focusInTerminal && (
            <span className={styles.hint} data-testid="focused-hint" data-focused-hint="">
              Esc to return
            </span>
          )}
          {/* Card shell pane — a plain $SHELL in this card's folder, under claude. LIT while the
              pane is open (the Filter button's toggle look). Main resolves the folder. */}
          <Button
            variant="secondary"
            size="sm"
            testId="focused-shell"
            lit={shellVisible}
            busy={shell.busy}
            onClick={() => void shell.run()}
            title={shellVisible ? SHELL_TERMS.hide : SHELL_TERMS.open}
            aria-pressed={shellVisible}
          >
            <span aria-hidden>{'>_'}</span> {SHELL_TERMS.label}
          </Button>
          {/* Past sessions (D-3) — Archive: no confirm, reversible through Past sessions…. The
              button is the ONLY path: Ctrl+W archives nothing (R27 — it is claude's delete-word,
              and a slipped focus turned it into an archive). */}
          <Button
            variant="secondary"
            size="sm"
            testId="focused-archive"
            busy={archive.busy}
            onClick={() => void archive.run()}
            aria-label="Archive this session"
            title="Archive — keeps it in Past sessions"
          >
            Archive
          </Button>
          {/* Past sessions (D-5) — Delete: opens the confirm (UX-DR14: the one exit that is NOT
              reversible needs a confirm; danger styling is on the confirm's Delete button, and
              this trigger is `danger` too — red at rest — so it reads as the risky one). */}
          <Button
            variant="danger"
            size="sm"
            testId="focused-delete"
            onClick={handleDelete}
            aria-label="Delete this session"
          >
            Delete
          </Button>
        </div>
        <div className={styles.terminalWrap} data-focused-frames="">
          {keptAlive.map((terminalId) => {
            const isFocused = terminalId === focusedTerminalId
            const pane = shellPanes[terminalId]
            const paneVisible = pane?.visible === true
            return (
              <EmbeddedTerminal
                key={terminalId}
                terminalId={terminalId}
                active={isFocused}
                // R10 — exactly ONE of the two takes focus: the shell while its pane shows, claude
                // otherwise. Hiding the pane flips both, so focus returns to claude.
                takeFocus={viewShown && isFocused && !paneVisible}
                shell={
                  pane === undefined
                    ? undefined
                    : {
                        terminalId: pane.terminalId,
                        visible: pane.visible,
                        takeFocus: viewShown && isFocused && pane.visible
                      }
                }
                onNewSession={onNewSession}
                onResume={resumeDeadTerminal}
                {...(onPickTemplate ? { onPickTemplate } : {})}
                {...(onManageTemplates ? { onManageTemplates } : {})}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
