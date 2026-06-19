// Story 1.3 — SessionCard (AC-4, AC-8).
//
// One card anatomy, three presentations driven by a `variant` prop:
//   - hero       — large, full-contrast (`bg-card-hero`), a 3px left accent bar in
//                  the hero column's accent (gold = needs-you / blue = working).
//   - calm       — compact, ~0.82 opacity, `text-dim` body (the recessed "far" card).
//   - watch-only — same anatomy, NO terminal affordance, a muted `Konsole` tag.
//
// PRESENTATIONAL ONLY: props are already-typed in-process data (NO c9watch parsing,
// NO IPC, NO store). The card is keyboard-focusable with a lavender AA focus ring
// and calls `onActivate` on click/Enter — the handler is wired by Story 1.4; this
// component only takes the callback. Status is dot + text label (never color-only).
import type { JSX, KeyboardEvent } from 'react'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import styles from './SessionCard.module.css'

export type SessionCardVariant = 'hero' | 'calm' | 'watch-only'

/** Drives the hero accent bar. The two hero columns are needs-you (gold) and
 *  working (blue); idle never takes the hero, so it is not an accent option. */
export type CardAccent = 'needs-you' | 'working'

export interface SessionCardProps {
  variant: SessionCardVariant
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
}

const VARIANT_CLASS: Record<SessionCardVariant, string> = {
  hero: styles.hero ?? '',
  calm: styles.calm ?? '',
  'watch-only': styles.watchOnly ?? ''
}

const ACCENT_CLASS: Record<CardAccent, string> = {
  'needs-you': styles.accentNeedsYou ?? '',
  working: styles.accentWorking ?? ''
}

export function SessionCard(props: SessionCardProps): JSX.Element {
  const {
    variant,
    sessionName,
    projectPath,
    status,
    accent,
    pendingToolName,
    pid,
    tasks,
    cost,
    onActivate
  } = props

  // The accent bar only renders on the hero variant (calm/watch-only are recessed).
  const accentClass = variant === 'hero' ? ACCENT_CLASS[accent] : ''

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate?.()
    }
  }

  return (
    <div
      className={`${styles.root} ${VARIANT_CLASS[variant]} ${accentClass}`}
      data-variant={variant}
      data-accent={accent}
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

      {variant === 'watch-only' && (
        <span className={styles.konsoleTag} data-testid="konsole-tag">
          Konsole
        </span>
      )}
    </div>
  )
}
