// Story 1.3 — ColumnHeader (AC-5).
//
// Renders the column `name` + a live MUTED count (`Needs you · 2`) + a top accent
// tick in the column's accent (gold / blue / idle-muted). It renders even when the
// column is EMPTY (`count === 0`) — it never collapses (UX-DR8). `prominent`
// (hero) is the larger `heading` presentation with a divider; the default flank
// presentation is smaller and `text-secondary`.
//
// `count` is a PROP (a number) — the header does NOT compute it from live data
// here (that wiring is Story 1.4). PRESENTATIONAL ONLY.
import type { JSX } from 'react'
import styles from './ColumnHeader.module.css'

/** The three live column accents. Mirrors the main-side `Column` union
 *  (`src/main/c9watch/columns.ts`): working / needs-you / idle. NO `done` — the
 *  idle column's accent is the muted `idle` token (per DESIGN.md `done-accent`
 *  pointing at `{colors.idle}`). */
export type ColumnAccent = 'working' | 'needs-you' | 'idle'

const ACCENT_CLASS: Record<ColumnAccent, string> = {
  working: styles.accentWorking ?? '',
  'needs-you': styles.accentNeedsYou ?? '',
  idle: styles.accentIdle ?? ''
}

export interface ColumnHeaderProps {
  name: string
  /** Live session count for the column (a number; supplied by the consumer). */
  count: number
  accent: ColumnAccent
  /** Hero (prominent) presentation — larger heading + divider. Default false. */
  prominent?: boolean
}

export function ColumnHeader({
  name,
  count,
  accent,
  prominent = false
}: ColumnHeaderProps): JSX.Element {
  const presentationClass = prominent ? styles.prominent : styles.flank
  return (
    <div
      className={`${styles.root} ${presentationClass ?? ''} ${ACCENT_CLASS[accent]}`}
      data-accent={accent}
      data-prominent={prominent}
      data-column-header
    >
      <div className={styles.line}>
        {/* Liquid Glass shows this status dot (its rim carries the colour); hidden by the app. */}
        <span className={styles.mark} data-column-mark aria-hidden="true" />
        <span className={styles.name} data-testid="column-name" data-column-label="">
          {name}
        </span>
        <span
          className={styles.count}
          data-testid="column-count"
          data-count={accent === 'needs-you' ? 'needs-you' : 'total'}
        >
          <span data-count-sep aria-hidden="true">
            ·
          </span>{' '}
          {count}
        </span>
      </div>
    </div>
  )
}
