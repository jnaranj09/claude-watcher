// Story 1.3 — SessionCard (AC-4, AC-8). Story 3.3 — the `watch-only` variant RETIRED.
//
// One card anatomy, TWO live presentations driven by a `variant` prop:
//   - hero       — large, full-contrast (`bg-card-hero`), a 3px left accent bar in
//                  the hero column's accent (gold = needs-you / blue = working).
//   - calm       — compact, ~0.82 opacity, `text-dim` body (the recessed "far" card).
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
import type { JSX, KeyboardEvent } from 'react'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import { needsYouEmphasisClass } from '../../styles/emphasis'
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
    selected = false,
    emphasized = false
  } = props

  // The accent bar only renders on the hero variant (calm is recessed).
  const accentClass = variant === 'hero' ? ACCENT_CLASS[accent] : ''
  // Story 2.2 (FR-9) — the selected (locate-and-highlight) affordance reuses the shipped
  // lavender focus-ring + raised-surface tokens (no new highlight color). Never a window raise.
  const selectedClass = selected ? (styles.selected ?? '') : ''
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

  return (
    <div
      className={`${styles.root} ${VARIANT_CLASS[variant]} ${accentClass} ${selectedClass} ${emphasisClass}`}
      data-variant={variant}
      data-accent={accent}
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
