// Story 1.4 — one board column (AC-1, AC-3, AC-4, AC-9).
//
// Renders the Story-1.3 `ColumnHeader` ALWAYS (even at count 0 — never collapses,
// UX-DR15), then either the sorted `SessionCard`s (from the narrow `useColumnSessions`
// selector — derived grouping + sort) or the terse empty-column hint. PRESENTATIONAL
// composition of shipped 1.3 components; it reads the store via the narrow selector
// only, never raw c9watch JSON.
//
// Card mapping (Task 4.2):
//   - `status` (DotStatus) = the session's `column` — `Column` and `DotStatus` are the
//     same three values (working/needs-you/idle); the card shows the COLUMN-STATE dot,
//     NOT the raw c9watch status string.
//   - `accent` (CardAccent = 'needs-you' | 'working') — idle has no CardAccent, so idle
//     cards map DELIBERATELY to 'working' (the calm/non-alert accent — never the gold
//     'needs-you' signal). On the STATIC board `variant='calm'`, so the accent BAR does
//     not render anyway (it is hero-only); the mapping is documented for 1.5.
//   - `variant` = 'calm' for a FLANK column; 'hero' when this column is the cascade-
//     selected center hero (Story 1.5, AC-3) — driven by the `isHero` prop the Board
//     passes down from the narrow `selectHeroColumn` selector. The accent (via the
//     existing `cardAccentFor`) is gold for the needs-you hero, blue for the working hero.
import type { JSX } from 'react'
import { ColumnHeader, type ColumnAccent } from '../ColumnHeader/ColumnHeader'
import { SessionCard, type CardAccent } from '../SessionCard/SessionCard'
import type { DotStatus } from '../StatusDot/StatusDot'
import type { Column as BoardColumn } from '../../../../shared/ipc/contract'
import {
  useBoard,
  useColumnSessions,
  selectColumnCount,
  type BoardSession
} from '../../stores/boardStore'
import styles from './Board.module.css'

/** The human column names + accents + empty-column hints (AC-4 copy). */
interface ColumnMeta {
  name: string
  accent: ColumnAccent
  /** Terse hint shown when the column is empty (count 0). */
  emptyHint: string
}

const COLUMN_META: Record<BoardColumn, ColumnMeta> = {
  working: { name: 'Working', accent: 'working', emptyHint: 'Nothing running.' },
  // needs-you EMPTY is the GOOD state — a calm hint, not an alarm.
  'needs-you': { name: 'Needs you', accent: 'needs-you', emptyHint: 'Nothing waiting. All quiet.' },
  // idle empty = 'Nothing waiting.' (NOT 'Nothing finished yet.' — there is no Done
  // column; finished sessions vanish). [FROZEN-1]
  idle: { name: 'Idle', accent: 'idle', emptyHint: 'Nothing waiting.' }
}

/** Map a column to the SessionCard `accent` (CardAccent has no 'idle' → idle maps to
 *  the calm 'working' accent, never the gold 'needs-you' alert). */
function cardAccentFor(column: BoardColumn): CardAccent {
  return column === 'needs-you' ? 'needs-you' : 'working'
}

/** The card's status dot IS the column-state — `Column` and `DotStatus` are the same
 *  three values. This EXHAUSTIVE map (keyed by every `Column`) makes the relationship
 *  compiler-checked instead of an unchecked `as DotStatus`: if `Column` ever gains a
 *  fourth value, this map fails to compile (no silent stale-cast drift). */
const DOT_STATUS_FOR_COLUMN: Record<BoardColumn, DotStatus> = {
  working: 'working',
  'needs-you': 'needs-you',
  idle: 'idle'
}

export interface ColumnProps {
  column: BoardColumn
  /** Story 1.5 — true when this column is the cascade-selected CENTER hero (AC-3). The
   *  Board derives it from the narrow `selectHeroColumn` selector and passes it down, so
   *  only the columns whose hero-ness changed re-render. Default false (flank). */
  isHero?: boolean
  /** Called when a card is activated (Epic-3 focused-session open — a no-op seam here). */
  onActivateCard?: (id: string) => void
}

export function Column({ column, isHero = false, onActivateCard }: ColumnProps): JSX.Element {
  const sessions = useColumnSessions(column)
  const count = useBoard((s) => selectColumnCount(s, column))
  const meta = COLUMN_META[column]

  // The hero column's cards are the large full-contrast `variant="hero"` (with the 3px
  // left accent bar); flank columns stay `variant="calm"` (unchanged from 1.4). The accent
  // bar is gold for the needs-you hero, blue for the working hero (via `cardAccentFor`).
  const variant = isHero ? 'hero' : 'calm'

  return (
    <section
      className={`${styles.column} ${isHero ? (styles.hero ?? '') : ''}`}
      data-column={column}
      aria-label={meta.name}
      {...(isHero ? { 'data-hero': true, 'data-hero-accent': cardAccentFor(column) } : {})}
    >
      <ColumnHeader name={meta.name} count={count} accent={meta.accent} prominent={isHero} />
      {count === 0 ? (
        <p className={styles.emptyHint} data-testid="empty-hint">
          {meta.emptyHint}
        </p>
      ) : (
        <div className={styles.cardStack}>
          {sessions.map((session: BoardSession) => (
            <SessionCard
              key={session.id}
              variant={variant}
              sessionName={session.sessionName}
              projectPath={session.projectPath}
              status={DOT_STATUS_FOR_COLUMN[column]}
              accent={cardAccentFor(column)}
              pid={session.pid}
              {...(session.pendingToolName !== undefined
                ? { pendingToolName: session.pendingToolName }
                : {})}
              {...(onActivateCard ? { onActivate: () => onActivateCard(session.id) } : {})}
            />
          ))}
        </div>
      )}
    </section>
  )
}
