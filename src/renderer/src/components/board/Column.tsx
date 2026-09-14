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
//   - `variant` = 'calm' for a FLANK column; 'hero' when this column is the center hero
//     (Story 1.5, AC-3 — now the PINNED needs-you) — driven by the `isHero` prop the Board
//     passes down from the pinned `HERO_COLUMN` constant. The accent (via the
//     existing `cardAccentFor`) is gold for the needs-you hero, blue for the working hero.
import type { JSX } from 'react'
import { ColumnHeader, type ColumnAccent } from '../ColumnHeader/ColumnHeader'
import { SessionCard, type CardAccent } from '../SessionCard/SessionCard'
import type { DotStatus } from '../StatusDot/StatusDot'
import type { Column as BoardColumn, Workspace } from '../../../../shared/ipc/contract'
import {
  useBoard,
  useColumnSessions,
  selectColumnCount,
  selectRailEmphasis,
  type BoardSession
} from '../../stores/boardStore'
// Workspaces (Task 9a) — `useColumnSessions` already scopes itself internally; Column still
// needs the active workspace directly for its OWN `selectColumnCount` call below.
// Task 12 — also the move-to-workspace target list (`selectWorkspaces`, `useShallow` per the
// array-selector rule).
import {
  useWorkspaces,
  selectActiveWorkspaceId,
  selectWorkspaces
} from '../../stores/workspacesStore'
import { effectiveTagFilter, tagsForIds, useTags, type TagsState } from '../../stores/tagsStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { useShallow } from 'zustand/react/shallow'
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

/** Story 3.4 (FR-16 / AC-4 / Task 2.4) — one board card that subscribes NARROWLY to its OWN
 *  `selectRailEmphasis(id)` (the SHARED ack state — the same the attention rail reads). A per-row
 *  component so one card's emphasis flip does not re-render the whole column (state.md narrow
 *  selectors). Drives the SessionCard's `emphasized` prop, which consumes the shipped Epic-1 pulse. */
function EmphasizedSessionCard(props: {
  session: BoardSession
  variant: 'hero' | 'calm'
  status: DotStatus
  accent: CardAccent
  selected: boolean
  onActivateCard?: ((id: string) => void) | undefined
  /** A2 — rename seam, threaded straight through to the card's pencil. */
  onRenameCard?: ((id: string) => void) | undefined
  /** Task 12 — the move-to-workspace target list (the OTHER workspaces are filtered inside
   *  SessionCard itself, against `currentWorkspaceId`). */
  workspaces: Workspace[]
  /** Task 12 — move seam, threaded straight through to the card's move affordance. */
  onMoveCardToWorkspace?: ((id: string, workspaceId: string) => void) | undefined
  /** Tags — the Tags… seam, threaded to the card's Tags… menu. */
  onSetCardTags?: ((id: string, tagIds: string[]) => void) | undefined
  /** Tags — opens the Tags dialog; the card's Tags… button uses it while no tag exists yet. */
  onManageTags?: (() => void) | undefined
}): JSX.Element {
  const {
    session,
    variant,
    status,
    accent,
    selected,
    onActivateCard,
    onRenameCard,
    workspaces,
    onMoveCardToWorkspace,
    onSetCardTags,
    onManageTags
  } = props
  const emphasized = useBoard((s) => selectRailEmphasis(s, session.id)) === 'needs-you'
  // Tags — this card's chips (tag-list order) and what its Tags… menu may offer (T-11). Arrays →
  // useShallow, so an unrelated catalog change does not re-render the card.
  const tags = useTags(useShallow((s: TagsState) => tagsForIds(s.tags, session.tagIds)))
  const availableTags = useTags(
    useShallow((s: TagsState) => visibleTags(s.tags, session.workspaceId))
  )
  return (
    <SessionCard
      variant={variant}
      // Story 6.5 — expose the stable id as `data-session-id` for the Playwright e2e.
      sessionId={session.id}
      sessionName={session.sessionName}
      projectPath={session.projectPath}
      status={status}
      accent={accent}
      pid={session.pid}
      selected={selected}
      emphasized={emphasized}
      tags={tags}
      {...(session.pendingToolName !== undefined
        ? { pendingToolName: session.pendingToolName }
        : {})}
      {...(onActivateCard ? { onActivate: () => onActivateCard(session.id) } : {})}
      {...(onRenameCard ? { onRename: () => onRenameCard(session.id) } : {})}
      {...(onMoveCardToWorkspace
        ? {
            workspaces,
            currentWorkspaceId: session.workspaceId,
            onMoveToWorkspace: (workspaceId: string) =>
              onMoveCardToWorkspace(session.id, workspaceId)
          }
        : {})}
      {...(onSetCardTags
        ? {
            availableTags,
            onSetTags: (tagIds: string[]) => onSetCardTags(session.id, tagIds),
            ...(onManageTags ? { onManageTags } : {})
          }
        : {})}
    />
  )
}

export interface ColumnProps {
  column: BoardColumn
  /** Story 1.5 — true when this column is the CENTER hero (AC-3; pinned to needs-you). The
   *  Board compares this column against the pinned `HERO_COLUMN` and passes it down, so
   *  only the columns whose hero-ness changed re-render. Default false (flank). */
  isHero?: boolean
  /** Called when a card is activated (Epic-3 focused-session open — a no-op seam here). */
  onActivateCard?: (id: string) => void
  /** Session-naming A2 — called when a card's rename pencil is activated. Omitted ⇒ no pencil. */
  onRenameCard?: (id: string) => void
  /** Task 12 — called when a card's move-to-workspace affordance picks a target. Omitted ⇒ no
   *  move control. */
  onMoveCardToWorkspace?: (id: string, workspaceId: string) => void
  /** Tags — called when a card's Tags… menu changes its tags. Omitted ⇒ no Tags… button. */
  onSetCardTags?: (id: string, tagIds: string[]) => void
  /** Tags — opens the Tags dialog; a card's Tags… button uses it while no tag exists yet. */
  onManageTags?: () => void
  /** Story 2.2 (FR-9) — the SELECTED card's id (renderer view-state). The card with this id
   *  renders the locate-and-highlight affordance; null/absent when nothing is selected. */
  selectedId?: string | null
}

export function Column({
  column,
  isHero = false,
  onActivateCard,
  onRenameCard,
  onMoveCardToWorkspace,
  onSetCardTags,
  onManageTags,
  selectedId = null
}: ColumnProps): JSX.Element {
  const sessions = useColumnSessions(column)
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const workspaces = useWorkspaces(useShallow(selectWorkspaces))
  const tagId = useTags((s) => effectiveTagFilter(s, activeWorkspaceId))
  const tagName = useTags((s) =>
    tagId === null ? null : (s.tags.find((t) => t.id === tagId)?.name ?? null)
  )
  const count = useBoard((s) => selectColumnCount(s, column, activeWorkspaceId, tagId))
  // Controller ruling (spec §4.3, design.md three-empty-states) — a column can be empty for two
  // DIFFERENT reasons under a tag filter: genuinely nothing here, or something here that just
  // doesn't carry the tag. The UNFILTERED count tells them apart; only the second one gets its
  // own sentence (never the calm "Nothing waiting. All quiet." — that is a claim about needs-you
  // that would be FALSE here).
  const unfilteredCount = useBoard((s) => selectColumnCount(s, column, activeWorkspaceId, null))
  const hiddenByFilter = count === 0 && tagId !== null && unfilteredCount > 0
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
        hiddenByFilter ? (
          <p className={styles.emptyHint} data-testid="empty-hint-filtered">
            {`No sessions tagged ${tagName ?? 'with this tag'} here.`}
          </p>
        ) : (
          <p className={styles.emptyHint} data-testid="empty-hint">
            {meta.emptyHint}
          </p>
        )
      ) : (
        <div className={styles.cardStack}>
          {sessions.map((session: BoardSession) => (
            <EmphasizedSessionCard
              key={session.id}
              session={session}
              variant={variant}
              status={DOT_STATUS_FOR_COLUMN[column]}
              accent={cardAccentFor(column)}
              selected={session.id === selectedId}
              onActivateCard={onActivateCard}
              onRenameCard={onRenameCard}
              workspaces={workspaces}
              onMoveCardToWorkspace={onMoveCardToWorkspace}
              onSetCardTags={onSetCardTags}
              onManageTags={onManageTags}
            />
          ))}
        </div>
      )}
    </section>
  )
}
