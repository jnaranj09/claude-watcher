// Story 1.3 — SessionCard (AC-4, AC-8). Story 3.3 — the `watch-only` variant RETIRED.
//
// One card anatomy, TWO live presentations driven by a `variant` prop:
//   - hero       — large, full-contrast (`bg-card-hero`), a 3px left accent bar in
//                  the hero column's accent (gold = needs-you / blue = working).
//   - calm       — compact, recessed "far" card: ~0.82 opacity + a one-rung-dimmer title.
//                  (It used to say `text-dim` body. That variant-level `color` only ever reached
//                  `.sessionName` — every other child sets its own — so it dimmed the TITLE rather
//                  than the body, inverting the hierarchy. See SessionCard.module.css `.calm`.)
//
// VISUAL HIERARCHY: the operator's custom NAME is the title (sans, weight 600, `--text-primary`;
// `--text-secondary` on calm) and the projectPath is reference detail beneath it (mono,
// `--text-muted`). Name above path, in both variants.
//
// Story 3.3 (FR-12 dropped) — the `watch-only` variant (the muted `Konsole` tag, built in
// Story 1.3 but NEVER wired by any caller) is RETIRED: the Board shows ONLY app-launched
// sessions, so there is no external/Konsole card to present. UX-DR6 loses its watch-only
// presentation; UX-DR20 (click-to-focus-failed) is DROPPED.
//
// PRESENTATIONAL ONLY: props are already-typed in-process data (NO c9watch parsing,
// NO IPC, NO store). The card is keyboard-focusable with a lavender AA focus ring
// and calls `onActivate` on click/Enter — the handler is wired by Story 1.4; this
// component only takes the callback. Status is dot + text label (never color-only).
import { useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import type { Workspace } from '../../../../shared/ipc/contract'
import styles from './SessionCard.module.css'

export type SessionCardVariant = 'hero' | 'calm'

/** Drives the hero accent bar. The two hero columns are needs-you (gold) and
 *  working (blue); idle never takes the hero, so it is not an accent option. */
export type CardAccent = 'needs-you' | 'working'

export interface SessionCardProps {
  variant: SessionCardVariant
  /** Story 6.5 — the stable session id (the launch-minted uuid), exposed verbatim as
   *  `data-session-id` on the card root so the Playwright e2e can read the identity off the
   *  board card and drive hook POSTs / column assertions against it. PRESENTATIONAL ONLY
   *  (an attribute, no behavior); optional so presentational callers/tests are untouched. */
  sessionId?: string
  /** Card title (sessionName) — SANS. */
  sessionName: string
  /** c9watch-verbatim path — MONO. */
  projectPath: string
  /** The status dot's live state (column-state, NOT a raw c9watch status). */
  status: DotStatus
  /** The hero accent bar color (gold for needs-you, blue for working). */
  accent: CardAccent
  /** What the session is blocked on, when present — MONO. */
  pendingToolName?: string
  /** Process id — MONO in the footer. */
  pid: number
  /** Task count, footer (omitted when undefined). */
  tasks?: number
  /** Cost string, footer (omitted when undefined). */
  cost?: string
  /** Activation callback (click / Enter). Wired by Story 1.4. */
  onActivate?: () => void
  /**
   * Session-naming A2 — the operator asked to RENAME this session (pencil clicked / activated).
   * Optional: when omitted the pencil is not rendered at all, so the Story-1.3 presentational
   * callers and their tests are untouched.
   *
   * The card itself is `role="button"` with an `onClick`, so the pencil's handlers MUST stop
   * propagation — otherwise renaming would ALSO activate the card and drop the operator into the
   * focused-session view behind the dialog.
   */
  onRename?: () => void
  /**
   * Workspaces (Task 12) — the move-to-workspace targets. Omitted (along with
   * `onMoveToWorkspace`) ⇒ the card renders no move affordance at all — the same
   * optional-seam pattern as `onRename`.
   */
  workspaces?: Workspace[]
  /** Workspaces — the session's OWN workspace. Never offered as a move target. */
  currentWorkspaceId?: string
  /**
   * Workspaces — the operator picked a target workspace from the move affordance. Optional:
   * omitted ⇒ no move control is rendered. Same stopPropagation requirement as `onRename` — the
   * control is a DOM child of the card's own `role="button"`.
   */
  onMoveToWorkspace?: (workspaceId: string) => void
  /** Story 2.2 (FR-9) — true when this card is the SELECTED card (the operator activated a
   *  notification for this session and the window is up). Renders a locate-and-highlight
   *  affordance via the shipped lavender focus-ring / raised-surface tokens — NOT a new color,
   *  NOT a window raise. Default false. */
  selected?: boolean
  /** Story 3.4 (FR-16 / AC-4) — true when this session NEEDS YOU and is UNacknowledged. Driven by
   *  the SHARED `selectRailEmphasis` (the SAME state the attention rail reads — ONE ack state, no
   *  parallel flag). Applies the SHIPPED Epic-1 `needsYouEmphasisClass` (the pulse + reduced-motion
   *  fallback + gold token) — CONSUMED, not re-authored. Orthogonal to `selected` (which card is
   *  being viewed) — this is "which card still needs you." Default false. */
  emphasized?: boolean
}

const VARIANT_CLASS: Record<SessionCardVariant, string> = {
  hero: styles.hero ?? '',
  calm: styles.calm ?? ''
}

const ACCENT_CLASS: Record<CardAccent, string> = {
  'needs-you': styles.accentNeedsYou ?? '',
  working: styles.accentWorking ?? ''
}

export function SessionCard(props: SessionCardProps): JSX.Element {
  const {
    variant,
    sessionId,
    sessionName,
    projectPath,
    status,
    accent,
    pendingToolName,
    pid,
    tasks,
    cost,
    onActivate,
    onRename,
    workspaces,
    currentWorkspaceId,
    onMoveToWorkspace,
    selected = false,
    emphasized = false
  } = props

  // Workspaces (Task 12) — local, presentational toggle for the move-target list. Ephemeral UI
  // state only (not session truth, not persisted) — the same category of local state the header
  // WorkspaceSwitcher popover already uses.
  const [moveOpen, setMoveOpen] = useState(false)
  const moveButtonRef = useRef<HTMLButtonElement | null>(null)
  // Review finding 2 — an empty target list is a control that opens nothing, which is a defect,
  // not a valid state. Computed once here so the render guard below and the menu's map share the
  // SAME filtered list (never re-derived, never drifting).
  const otherWorkspaces = (workspaces ?? []).filter((w) => w.id !== currentWorkspaceId)

  // The accent bar only renders on the hero variant (calm is recessed).
  const accentClass = variant === 'hero' ? ACCENT_CLASS[accent] : ''
  // Story 2.2 (FR-9) — `selected` still drives `data-selected` below (the store's
  // locate-and-highlight and its tests read it), but it no longer carries any STYLING: on the
  // board nothing is "selected" in a way the operator chose, so painting one card implied a mode
  // that does not exist. The active-session fill lives in the RAIL, where it means something.
  // See the `.selected` note in SessionCard.module.css. Never a window raise.
  // Story 3.4 (FR-16 / AC-4) — the needs-you-unacknowledged emphasis: the SHIPPED Epic-1 pulse
  // class (gold token + pulse + reduced-motion fallback, all in emphasis.module.css). CONSUMED,
  // not re-authored. Driven by the SHARED ack state (selectRailEmphasis) — the rail reads the same.
  const emphasisClass = emphasized ? needsYouEmphasisClass : ''

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate?.()
    }
  }

  // A2 — LOAD-BEARING stopPropagation. The card root is `role="button"` with its own onClick AND
  // its own Enter/Space keydown handler, and this pencil is a DOM child of it. Without stopping
  // propagation the rename click would bubble to the card and ALSO activate it — the operator
  // would land in the focused-session view with the rename dialog on top of it.
  //
  // BOTH handlers are needed, not just the click one: a keyboard operator pressing Enter/Space on
  // the focused pencil fires a keydown that bubbles to the card's `handleKeyDown` (which calls
  // `onActivate`) BEFORE the browser synthesizes the button's click. Stopping only the click would
  // leave the keyboard path activating the card.
  const handleRenameClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    onRename?.()
  }

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault: that would suppress the button's own native click, which is what
      // actually invokes onRename. Only stop the bubble to the card.
      e.stopPropagation()
    }
  }

  // Workspaces (Task 12) — the SAME LOAD-BEARING guard pair as the rename pencil above, copied
  // verbatim (click + keydown), for the SAME reason: this toggle is a DOM child of the card's own
  // `role="button"` onClick/onKeyDown, so a bare handler here would ALSO activate the card, and a
  // keyboard Enter/Space would bubble a keydown to the card's handleKeyDown BEFORE the browser
  // synthesizes the button's own click — stopping only the click leaves that path activating the
  // card underneath.
  const handleMoveToggleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    setMoveOpen((v) => !v)
  }

  const handleMoveToggleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  // Each move-target row is ALSO a DOM child of the card's role="button" — the same guard applies
  // (picking a workspace must not also activate/open the card underneath the closing menu).
  const handleMoveItemClick = (e: MouseEvent<HTMLButtonElement>, workspaceId: string): void => {
    e.stopPropagation()
    setMoveOpen(false)
    onMoveToWorkspace?.(workspaceId)
  }

  // Review finding 1 — the SAME keyboard race as the toggle (handleMoveToggleKeyDown above), one
  // level down: a keyboard operator who tabs to a row and presses Enter/Space fires a keydown that
  // bubbles to the card's handleKeyDown BEFORE the browser synthesizes the row button's own click.
  // Stopping only the row's onClick (handleMoveItemClick) leaves this path activating the card.
  const handleMoveItemKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Do NOT preventDefault — see handleRenameKeyDown above.
      e.stopPropagation()
    }
  }

  // Review finding 3 — Escape-to-close, matching WorkspaceSwitcher's popover exactly (same
  // mechanism, no arrow-key roving added here either). The handler lives on the menu element,
  // which exists ONLY while `moveOpen` — so it can never swallow Escape anywhere else in the app.
  const closeMoveMenuAndRefocus = (): void => {
    setMoveOpen(false)
    moveButtonRef.current?.focus()
  }

  const handleMoveMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeMoveMenuAndRefocus()
    }
  }

  return (
    <div
      className={`${styles.root} ${VARIANT_CLASS[variant]} ${accentClass} ${emphasisClass}`}
      data-variant={variant}
      data-accent={accent}
      data-status={status}
      {...(sessionId !== undefined ? { 'data-session-id': sessionId } : {})}
      {...(selected ? { 'data-selected': true } : {})}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      role="button"
      tabIndex={0}
      onClick={() => onActivate?.()}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.header}>
        <span className={styles.sessionName} data-testid="session-name">
          {sessionName}
        </span>
        {/* A2 — rename affordance. Revealed on card hover/focus-within (CSS) but ALWAYS in the
            accessibility tree and ALWAYS tab-reachable: a hover-only control is unreachable by
            keyboard, and this card is already a keyboard-activatable role="button".
            Rendered only when a handler is wired, so purely presentational callers/tests are
            untouched. */}
        {onRename !== undefined && (
          <button
            type="button"
            className={styles.renameButton}
            data-testid="card-rename"
            aria-label={`Rename ${sessionName}`}
            title={`Rename ${sessionName}`}
            onClick={handleRenameClick}
            onKeyDown={handleRenameKeyDown}
          >
            {/* Inline SVG pencil: no icon dependency, and `currentColor` inherits the card's
                text ramp so hero/calm variants tint it correctly. aria-hidden — the button's
                aria-label is the accessible name. */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5z" />
            </svg>
          </button>
        )}
        {/* Workspaces (Task 12) — move-to-workspace affordance. Same reveal-on-hover/focus-within
            + always-tab-reachable treatment as the pencil, and the same optional-seam rule:
            rendered only when `onMoveToWorkspace` is wired AND at least one OTHER workspace
            exists to move to (review finding 2 — a control that opens onto nothing is a defect,
            not a valid state; the single-workspace install is the common case this guards). */}
        {onMoveToWorkspace !== undefined && otherWorkspaces.length > 0 && (
          <div className={styles.moveWrap}>
            <button
              ref={moveButtonRef}
              type="button"
              className={styles.renameButton}
              data-testid="card-move"
              aria-haspopup="menu"
              aria-expanded={moveOpen}
              aria-label={`Move ${sessionName} to another workspace`}
              title={`Move ${sessionName} to another workspace`}
              onClick={handleMoveToggleClick}
              onKeyDown={handleMoveToggleKeyDown}
            >
              {/* Inline SVG folder-arrow glyph: no icon dependency, `currentColor` inherits the
                  card's text ramp the same way the pencil's does. aria-hidden — the button's
                  aria-label is the accessible name. */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2 4.5h4l1.5 2H14v6.5H2z" />
                <path d="M8 8.5v3M6.5 10h3" />
              </svg>
            </button>
            {moveOpen && (
              <div className={styles.moveMenu} role="menu" onKeyDown={handleMoveMenuKeyDown}>
                {otherWorkspaces.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitem"
                    className={styles.moveMenuItem}
                    data-testid={`card-move-${w.id}`}
                    onClick={(e) => handleMoveItemClick(e, w.id)}
                    onKeyDown={handleMoveItemKeyDown}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <StatusDot status={status} labelHidden />
      </div>

      <span className={styles.projectPath} data-testid="project-path">
        {projectPath}
      </span>

      {pendingToolName !== undefined && (
        <span className={styles.pendingToolName} data-testid="pending-tool">
          {pendingToolName}
        </span>
      )}

      <div className={styles.footer} data-testid="footer">
        <span className={styles.pid} data-testid="pid">
          {pid}
        </span>
        {tasks !== undefined && (
          <>
            <span className={styles.sep} aria-hidden>
              ·
            </span>
            <span data-testid="tasks">{tasks} tasks</span>
          </>
        )}
        {cost !== undefined && (
          <>
            <span className={styles.sep} aria-hidden>
              ·
            </span>
            <span data-testid="cost">{cost}</span>
          </>
        )}
      </div>
    </div>
  )
}
