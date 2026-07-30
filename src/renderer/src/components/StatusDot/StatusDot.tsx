// Story 1.3 — StatusDot (AC-3, AC-8).
//
// The atomic status unit: an 8px `full` circle whose color encodes one of the
// THREE LIVE states — `working` (blue) / `needs-you` (gold) / `idle` (muted).
// There is NO `done` live state (FROZEN DECISION; the 3-state model from
// `src/main/c9watch/columns.ts` `Column`). The dot is ALWAYS paired with a text
// label so color is never the only signal (the accessibility floor, UX-DR29).
import type { JSX } from 'react'
import { statusLabel } from './statusLabel'
import styles from './StatusDot.module.css'

/**
 * The three live status states. Mirrors the main-side `Column` union
 * (`src/main/c9watch/columns.ts`) — the three live columns ARE the three dot
 * states. Deliberately NO `done` (an exited session vanishes; there is no Done
 * column/state).
 */
export type DotStatus = 'working' | 'needs-you' | 'idle'

const STATE_CLASS: Record<DotStatus, string> = {
  working: styles.working ?? '',
  'needs-you': styles.needsYou ?? '',
  idle: styles.idle ?? ''
}

export interface StatusDotProps {
  status: DotStatus
  /** Override the visible text label. Defaults to a per-state human label. */
  label?: string
  /** Render the label visually, or keep it screen-reader-only (still present —
   *  the dot is never color-only). Defaults to visible. */
  labelHidden?: boolean
}

export function StatusDot({ status, label, labelHidden = false }: StatusDotProps): JSX.Element {
  const text = label ?? statusLabel(status)
  return (
    <span className={styles.root} data-status={status}>
      <span
        className={`${styles.dot} ${STATE_CLASS[status]}`}
        data-testid="status-dot"
        aria-hidden
      />
      {labelHidden ? (
        // Screen-reader-only label: never visually shown, but the status is still
        // conveyed non-visually (color is never the SOLE signal).
        <span className="sr-only" data-testid="status-label">
          {text}
        </span>
      ) : (
        <span className={styles.label} data-testid="status-label">
          {text}
        </span>
      )}
    </span>
  )
}
