// Story 3.4 (FR-16) — the persistent ATTENTION RAIL (AC-1, AC-2, AC-5).
//
// A persistent nav region inside the Focused-session view (architecture.md:126-128) that
// emphasizes waiting sessions while the operator is inside a terminal, so a SECOND agent needing
// them is never missed even when the board is off-screen. It lists the SAME app-launched sessions
// the board shows (the post-3.3 launched-set-filtered feed main ships — the rail's source
// auto-narrows because external raises are never emitted; do NOT add a second renderer-side
// filter), live-updating from the board store projection.
//
// CONSUMES the shipped Epic-1 emphasis primitives (SM-C1) — it does NOT re-author them:
//   - `needsYouEmphasisClass` (the @keyframes needsYouBounce + the prefers-reduced-motion fallback
//     live in emphasis.module.css — a whole-pixel translateY bounce on a 2.4s cycle with a long
//     rest, compositor-only. It must NOT scale: the class lands on an element containing text, and
//     a fractional scale rasterises every glyph off the pixel grid. Reduced-motion → no motion and
//     no residual transform; the static gold carries it — UX-DR27/29). The rail ADDS the 44→56px
//     enlarge + 14%-gold fill as its OWN row styling, but keeps the enlarge in the reduced-motion
//     path too (only the bounce drops — see AttentionRail.module.css).
//   - the `--needs-you` gold token (NEEDS_YOU_TOKEN) for the fill; the row's BORDER colour comes
//     from `data-status` instead, so the edge and the dot always agree.
//   - the shipped `StatusDot` (never color-only — paired with a text label, UX-DR29).
//   - a `LiveAnnouncer` (aria-live=polite) for a session NEWLY entering needs-you.
//
// LAYOUT — a PINNED active row, then one section per status:
//
//     <the session whose terminal is on screen>     ← always first, no divider above it
//     ──── Needs you ────
//     ──── Working ────
//     ──── Idle ────
//     ──── Starting ────
//
// The rail used to be ONE flat list sorted needs-you-first, which meant the session the operator
// was actively typing in slid down the rail the moment any OTHER session went needs-you. Pinning
// it removes that: "where am I" is answered at a fixed position, and "who wants me" is answered by
// the group right below. The pinned row carries NO divider — a header over one row would explain
// something the fill and the "(active)" in its accessible name already say — and it is filtered
// OUT of its own status group, so no session is ever listed twice.
//
// Empty sections render nothing. Three empty rules stacked over a rail holding one session would
// be more furniture than content.
//
// STATE (state.md): the rail + ack state are RENDERER VIEW-STATE in the board store. NARROW
// selectors — the rail subscribes to the pinned id (`selectRailActiveSessionId`, a primitive),
// each SECTION to its own ids (`selectRailSection`), and each ROW to its OWN
// `selectRailEmphasis(id)` (so one row's emphasis flip does not re-render the whole rail —
// Task 3.6). Session truth stays main-owned; the rail renders the projection main ships.
//
// CLICK (AC-3): a rail row whose session has a known terminalId SWITCHES the visible terminal
// (pure renderer show/hide of the kept-alive terminals — terminal.md; NO per-switch IPC, NO input
// sent — alert-only, FR-9-consistent) AND acknowledges that session (UX-DR28). A row whose binding
// has not landed yet is alert-only-non-switchable (it becomes switchable once the binding arrives —
// degrade gracefully, never crash). [Source: story 3.4 Task 3/4; UX-DR9/27/28/29; architecture.md]
import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import { LiveAnnouncer } from '../../styles/LiveAnnouncer'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import type { Column, Tag } from '../../../../shared/ipc/contract'
import {
  useBoard,
  boardStore,
  selectRailOrder,
  selectRailEmphasis,
  selectFocusedTerminalId,
  selectTerminalIdForSession,
  selectStartingTerminals,
  selectRailSection,
  selectRailActiveSessionId,
  type BoardState,
  type LaunchedTerminal
} from '../../stores/boardStore'
// Workspaces (Task 9a) — the rail is a component tree, so each subscriber reads the active
// workspace itself (`useWorkspaces`); the imperative announce effect below reads the singleton
// `workspacesStore.getState()` directly (it runs outside React render, in a store subscription).
import {
  useWorkspaces,
  workspacesStore,
  selectActiveWorkspaceId
} from '../../stores/workspacesStore'
import { effectiveTagFilter, tagsForIds, useTags, type TagsState } from '../../stores/tagsStore'
import { visibleTags } from '../../../../shared/tags/tagScope'
import { TagIndicator } from '../TagIndicator/TagIndicator'
import { TagGlyphIcon } from '../TagIndicator/TagGlyphIcon'
import { TagChipRow } from '../TagChip/TagChipRow'
import { TagChipWrap } from '../TagChip/TagChip'
import { TagPicker } from '../TagPicker/TagPicker'
import { shortName } from './railName'
import { statusLabel } from '../StatusDot/statusLabel'
import styles from './AttentionRail.module.css'

/** The status dot state IS the session's column (the three live columns are the three dot states).
 *  Keyed on `Column` (from the contract) so a fourth column would FAIL TO COMPILE here (no silent
 *  stale cast / no runtime undefined) — mirrors the same compiler-checked map in Column.tsx. */
const DOT_STATUS_FOR_COLUMN: Record<Column, DotStatus> = {
  working: 'working',
  'needs-you': 'needs-you',
  idle: 'idle'
}

/** The rail's section order, most-urgent first. NEEDS YOU leads because a session that wants the
 *  operator is the whole reason this rail exists; IDLE trails because nothing is happening there.
 *  The pinned active row sits ABOVE all of these and belongs to none of them.
 *
 *  Typed `readonly Column[]` so dropping a column here is a deliberate edit, not a typo — and so a
 *  fourth column added to the contract shows up as an unhandled value in review rather than
 *  silently vanishing from the rail. */
const RAIL_SECTION_COLUMNS: readonly Column[] = ['needs-you', 'working', 'idle']

/** The per-row projection — the SMALLEST slice a row needs. Subscribed via `useShallow` so a row
 *  re-renders only when ITS own fields change (state.md narrow selectors, Task 3.6). */
interface RailRowView {
  name: string
  status: DotStatus
  emphasized: boolean
  active: boolean
  present: boolean
  /** Tags — the card's tag ids joined with '\n'. A PRIMITIVE on purpose: `useShallow` over this
   *  view compares field by field, and an array here would be a fresh identity on every delta. */
  tagKey: string
  /** Tags — the card's workspace ('' when absent): what its tag picker may offer (T-11). */
  workspaceId: string
}

function selectRailRowView(state: BoardState, id: string): RailRowView {
  const session = state.sessionsById[id]
  if (session === undefined) {
    return {
      name: '',
      status: 'idle',
      emphasized: false,
      active: false,
      present: false,
      tagKey: '',
      workspaceId: ''
    }
  }
  const focused = selectFocusedTerminalId(state)
  const terminalId = selectTerminalIdForSession(state, id)
  return {
    name: shortName(session),
    status: DOT_STATUS_FOR_COLUMN[session.column],
    emphasized: selectRailEmphasis(state, id) === 'needs-you',
    active: focused !== null && terminalId === focused,
    present: true,
    tagKey: session.tagIds.join('\n'),
    workspaceId: session.workspaceId
  }
}

/** ", tags: deploy, prod" — or '' for no tags. The collapsed rail draws no tag icons, so the row's
 *  own label is where it still says which tags it carries (T-27). */
function tagSuffix(tags: readonly Tag[]): string {
  return tags.length === 0 ? '' : `, tags: ${tags.map((t) => t.name).join(', ')}`
}

/** A single rail row. Subscribes NARROWLY (useShallow over `selectRailRowView`) to its OWN slice
 *  (Task 3.6) so a sibling's change does not re-render it. Renders status dot + short name (never
 *  color-only); collapsed mode renders an icon-only row (dot + initial). A `<button>` so it is
 *  keyboard-activatable (Enter/Space = click) with the shipped lavender AA focus ring (UX-DR29).
 *
 *  Tags (T-27, T-28) — a tagged row also carries a compact `TagIndicator` in a peek toggle
 *  (a sibling of the row, like the rename pencil — a `<button>` cannot nest in the row `<button>`).
 *  Clicking it PEEKS the row: every chip on a line of its own, plus `Edit` (opens the picker). An
 *  untagged row gets the same toggle, hover-revealed, when tagging is wired and its workspace has
 *  tags — so a session can still be tagged from the rail. `showAllTags` (the header toggle) instead
 *  gives every tagged row a one-line chip row, without opening its peek. Peek + `showAllTags`' own
 *  per-row `editing` state are renderer view-state (T-28) — local `useState`, never persisted. */
function RailRow(props: {
  id: string
  collapsed: boolean
  showAllTags: boolean
  onActivate: (sessionId: string) => void
  onRename?: ((sessionId: string) => void) | undefined
  onSetTags?: ((sessionId: string, tagIds: string[]) => void) | undefined
}): JSX.Element | null {
  const { id, collapsed, showAllTags, onActivate, onRename, onSetTags } = props
  const view = useBoard(useShallow((s: BoardState) => selectRailRowView(s, id)))
  const tagIds = view.tagKey === '' ? [] : view.tagKey.split('\n')
  // Tags — this row's chips in TAG-LIST order, and what its picker may offer (T-11).
  const tags = useTags(useShallow((s: TagsState) => tagsForIds(s.tags, tagIds)))
  const pickable = useTags(
    useShallow((s: TagsState) =>
      view.workspaceId === '' ? [] : visibleTags(s.tags, view.workspaceId)
    )
  )
  // T-28 — per-row view-state, never persisted.
  const [peekOpen, setPeekOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const peekRef = useRef<HTMLDivElement | null>(null)
  const tagPickerId = useId()
  if (!view.present) return null
  const { name, status, emphasized, active } = view

  // The row's accessible name carries the STATUS TEXT (a <button aria-label> replaces its contents
  // for assistive tech, so the dot's sr-only text is never read from in here) — and the TAG names.
  // Without the status in this string, the status would reach a screen-reader user through dot
  // COLOR alone (the UX-DR29 floor: color is never the sole signal).
  const statusText = statusLabel(status)
  const described = `${name}, ${statusText}${tagSuffix(tags)}`
  const label = active ? `${described} (active)` : described

  const className = `${styles.row} ${emphasized ? `${styles.emphasized} ${needsYouEmphasisClass}` : ''} ${active ? styles.active : ''}`

  // T-27 — the chip line is the show-all view's second line: never in the default view (a row's
  // height must not follow its tags), never collapsed (no room), not while peeking (the panel
  // already shows every chip).
  const chipLine = !collapsed && showAllTags && !peekOpen && tags.length > 0
  const canTag = onSetTags !== undefined && pickable.length > 0
  const hasPeek = !collapsed && (tags.length > 0 || canTag)
  const showRename = !collapsed && onRename !== undefined
  const chips = chipLine ? (
    <span className={styles.rowTags}>
      <TagChipRow tags={tags} testId="rail-row-tags" />
    </span>
  ) : null

  function togglePeek(): void {
    setPeekOpen((open) => !open)
    setEditing(false)
  }

  // The ACTIVE row is NOT a control — a <div>, no click, out of the tab order: pressing it would do
  // nothing (you are already in it). `aria-current` carries the "(active)" the button path spells
  // out; collapsed renders the name sr-only so the row never announces a status with no session.
  //
  // NOTE the accessible name is built DIFFERENTLY here than on the button below, and the
  // difference is not cosmetic. A `<button aria-label=…>` REPLACES its contents for assistive
  // tech, which is why the button path folds the status into `label`. A generic `<div>` has no
  // such guarantee — `aria-label` on an element with no role is not reliably exposed — so this
  // path lets the real content be read instead: the StatusDot's screen-reader-only status text
  // plus the name. Collapsed hides the name visually, so it is rendered `sr-only` rather than
  // dropped, or the row would announce a status with no session attached to it.
  const row = active ? (
    <div
      className={className}
      data-testid="rail-row"
      data-session-id={id}
      data-status={status}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      {...(!collapsed && tags.length > 0 ? { 'data-has-tags': true } : {})}
      {...(chipLine ? { 'data-two-line': true } : {})}
      data-active
      aria-current="true"
      title={label}
    >
      <StatusDot status={status} labelHidden />
      {collapsed ? (
        <span className="sr-only">{name}</span>
      ) : (
        <span className={styles.name} data-testid="rail-row-name">
          {name}
        </span>
      )}
      {chips}
    </div>
  ) : (
    <button
      type="button"
      className={className}
      data-testid="rail-row"
      data-session-id={id}
      data-status={status}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      {...(!collapsed && tags.length > 0 ? { 'data-has-tags': true } : {})}
      {...(chipLine ? { 'data-two-line': true } : {})}
      aria-label={label}
      title={label}
      onClick={() => onActivate(id)}
    >
      {/* `labelHidden` unconditionally: the dot contributes the STATUS, never a second name. */}
      <StatusDot status={status} labelHidden />
      {/* Collapsed is the CIRCLE alone; `aria-label` + `title` carry the name. */}
      {!collapsed && (
        <span className={styles.name} data-testid="rail-row-name">
          {name}
        </span>
      )}
      {chips}
    </button>
  )

  // No tools to show: the old shapes exactly — the active row keeps its wrapper (the collapsed tab
  // geometry is written against it), the button row stands alone.
  if (!showRename && !hasPeek) {
    return active ? <div className={styles.rowWrap}>{row}</div> : row
  }

  return (
    <>
      {/* The pencil and the tag toggle are SIBLINGS of the row (a <button> cannot nest in the row
          <button>), in one tools cluster overlaid on its right edge. */}
      <div className={styles.rowWrap} {...(chipLine ? { 'data-two-line': true } : {})}>
        {row}
        <span className={styles.rowTools}>
          {showRename && <RenameButton name={name} onClick={() => onRename?.(id)} />}
          {hasPeek && <PeekButton name={name} tags={tags} open={peekOpen} onToggle={togglePeek} />}
        </span>
      </div>
      {/* T-27 — the PEEK: every chip on a line of its own under the row, plus Edit. It grows the
          row only because the operator asked (the same reason the active row may step up). */}
      {peekOpen && hasPeek && (
        <div className={styles.peekPanel} data-testid="rail-tags-panel" ref={peekRef}>
          {tags.length > 0 ? (
            <TagChipWrap tags={tags} testId="rail-tags-panel-chips" />
          ) : (
            <span className={styles.peekEmpty}>No tags</span>
          )}
          {canTag && (
            <button
              type="button"
              className={styles.peekEdit}
              data-testid="rail-tags-edit"
              aria-expanded={editing}
              aria-controls={tagPickerId}
              onClick={() => setEditing((v) => !v)}
            >
              Edit
            </button>
          )}
          {editing && canTag && (
            <TagPicker
              id={tagPickerId}
              tags={pickable}
              selectedIds={tags.map((t) => t.id)}
              onChange={(next) => onSetTags?.(id, next)}
              onClose={() => setEditing(false)}
              anchorRef={peekRef}
              testId="rail-tag-picker"
              label={`Tags for ${name}`}
            />
          )}
        </div>
      )}
    </>
  )
}

/** The row's tag toggle (T-27). Tagged: the compact TagIndicator, ALWAYS visible — it is
 *  information, not a hover action. Untagged: a muted empty tag outline revealed on hover / focus
 *  like the pencil, so a session with no tags can still be tagged from the rail. */
function PeekButton(props: {
  name: string
  tags: readonly Tag[]
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const { name, tags, open, onToggle } = props
  const label =
    tags.length === 0 ? `Add tags to ${name}` : `Tags: ${tags.map((t) => t.name).join(', ')}`
  return (
    <button
      type="button"
      className={`${styles.peekButton} ${tags.length === 0 ? styles.peekButtonEmpty : ''}`}
      data-testid="rail-tags-peek"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {tags.length > 0 ? (
        <TagIndicator tags={tags} />
      ) : (
        <TagGlyphIcon size={10} strokeWidth={1.92} />
      )}
    </button>
  )
}

/** The rename pencil. Extracted because BOTH row shapes need it — the interactive `<button>` row
 *  and the non-interactive active `<div>` row — and on the active row it is the ONLY control left,
 *  so a copy that drifted would quietly leave that row with no way to rename at all. */
function RenameButton(props: { name: string; onClick: () => void }): JSX.Element {
  const { name, onClick } = props
  return (
    <button
      type="button"
      className={styles.rowRenameButton}
      data-testid="rail-rename"
      aria-label={`Rename ${name}`}
      title={`Rename ${name}`}
      onClick={onClick}
    >
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
  )
}

/**
 * A section divider — the `──── Label ────` rule between rail groups.
 *
 * The rules are `::before`/`::after` pseudo-elements on a flex row, NOT dash characters: a literal
 * run of dashes cannot know how wide the rail is, so it would over-run a 240px rail and wrap on a
 * long label, while a flex rule fills exactly the space left beside the text at any width.
 *
 * `aria-hidden` — this is decoration. The GROUPING it draws is carried to assistive tech by the
 * `aria-label` on the sibling `<ul>` (see RailSection), so a screen reader announces "Needs you,
 * list, 2 items" instead of reading a stray word floating between two lists.
 *
 * Collapsed rail: the LABEL hides (there is no room for text at 70px) but the rule stays, so the
 * groups remain visibly separated as one column of circles. Same trick the shipped
 * `.startingLabel` already used — this just makes it the shared, uniform treatment.
 */
function RailDivider(props: { label: string }): JSX.Element {
  return (
    <div className={styles.divider} data-testid="rail-divider" data-label={props.label} aria-hidden>
      <span className={styles.dividerLabel}>{props.label}</span>
    </div>
  )
}

/**
 * One status group: a divider plus the rows in that column.
 *
 * Renders NOTHING when the group is empty — an empty `──── IDLE ────` rule is a promise of content
 * that is not there, and three of them stacked would fill a rail that has one session in it.
 *
 * Subscribes to its OWN ids only (`selectRailSection` + `useShallow`, state.md narrow selectors),
 * so a session moving between groups re-renders the two groups involved, not the whole rail.
 */
function RailSection(props: {
  column: Column
  collapsed: boolean
  showAllTags: boolean
  onActivate: (sessionId: string) => void
  onRename?: ((sessionId: string) => void) | undefined
  onSetTags?: ((sessionId: string, tagIds: string[]) => void) | undefined
}): JSX.Element | null {
  const { column, collapsed, showAllTags, onActivate, onRename, onSetTags } = props
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  // Tags — sections follow the header filter. The PINNED row does not (it is the terminal you are
  // typing in), and neither does the needs-you announcement (alerts ignore the filter).
  const tagId = useTags((s) => effectiveTagFilter(s, activeWorkspaceId))
  const ids = useBoard(
    useShallow((s: BoardState) => selectRailSection(s, column, activeWorkspaceId, tagId))
  )
  if (ids.length === 0) return null
  const label = statusLabel(DOT_STATUS_FOR_COLUMN[column])
  return (
    <div className={styles.section} data-testid="rail-section" data-column={column}>
      <RailDivider label={label} />
      <ul className={styles.list} data-testid="rail-list" aria-label={label}>
        {ids.map((id) => (
          <li key={id} className={styles.listItem}>
            <RailRow
              id={id}
              collapsed={collapsed}
              showAllTags={showAllTags}
              onActivate={onActivate}
              onRename={onRename}
              onSetTags={onSetTags}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Story 5.6 (rail gap) — a single calm "starting" row for a launched-but-not-yet-correlated
 * terminal. CALM-NEUTRAL: cwd-basename label + muted "starting…" sublabel; NO status dot, NO
 * gold, NO pulse, NO accent bar. A <button> for keyboard activation (Enter/Space) with the
 * shipped lavender focus-ring. Click → `boardStore.getState().switchTerminal(terminalId)` —
 * pure view-state switch, NO acknowledge, NO IPC (these are not c9watch sessions).
 */
function StartingRailRow(props: { terminal: LaunchedTerminal; collapsed: boolean }): JSX.Element {
  const { terminal, collapsed } = props
  const { terminalId, label } = terminal
  // The pinned slot at the top of the rail holds the active SESSION, and a starting terminal has
  // no session card yet — so during the launch→correlate window the pin is empty and this row is
  // the only thing that can say "this is the terminal you are looking at". Without it, launching a
  // session leaves the whole rail with no active marker anywhere. A primitive boolean → safe
  // without useShallow, and it re-renders only THIS row when focus moves.
  const active = useBoard((s: BoardState) => selectFocusedTerminalId(s) === terminalId)

  function handleClick(): void {
    boardStore.getState().switchTerminal(terminalId)
  }

  // Always "<name> — starting", collapsed or not. The aria-label used to drop the " — starting"
  // suffix in collapsed mode — exactly the mode where no visible text explains the row at all.
  // Doubles as the `title`, so the collapsed ring is identifiable on hover too.
  const rowLabel = active ? `${label} — starting (active)` : `${label} — starting`

  return (
    <button
      type="button"
      className={`${styles.startingRow} ${active ? styles.active : ''}`}
      data-testid="starting-rail-row"
      data-terminal-id={terminalId}
      {...(active ? { 'data-active': true } : {})}
      aria-label={rowLabel}
      aria-current={active ? 'true' : undefined}
      title={rowLabel}
      onClick={handleClick}
    >
      {/* The OPEN QUESTION from deferred-work.md:150, resolved: RailRow's collapsed letter is gone
          (the dot is its icon), but this row has NO status dot BY DESIGN — calm-neutral, no colour,
          no pulse — so dropping its letter too would leave a literally empty button. It gets a
          neutral RING instead: same 8px geometry as StatusDot so the collapsed rail reads as one
          column of circles, but hollow and muted, which cannot be mistaken for a live status
          colour. (The alternative in the docs — keep the letter — would have left this the only
          row still showing a glyph, i.e. the inconsistency Goal B set out to remove.) */}
      {collapsed ? (
        <span className={styles.startingRowGlyph} data-testid="starting-rail-glyph" aria-hidden />
      ) : (
        <>
          <span className={styles.startingRowName}>{label}</span>
          <span className={styles.startingRowStatus}>starting…</span>
        </>
      )}
    </button>
  )
}

export interface AttentionRailProps {
  /** Activate a rail row's session: switch the visible terminal (if its binding is known) AND
   *  acknowledge it. Wired by the Focused-session view (Task 4.3). */
  onActivateSession: (sessionId: string) => void
  /** Session-naming A2 — the operator asked to rename a row's session (the pencil). Omitted ⇒ no
   *  pencil is rendered, so the rail stays usable in the presentational/test callers that do not
   *  wire rename. Expanded rail only (see RailRow). */
  onRenameSession?: (sessionId: string) => void
  /** Tags — the peek's Edit changed a session's tags. Omitted ⇒ the peek shows chips but offers no
   *  Edit, and untagged rows get no "add tags" toggle. */
  onSetSessionTags?: (sessionId: string, tagIds: string[]) => void
}

export function AttentionRail({
  onActivateSession,
  onRenameSession,
  onSetSessionTags
}: AttentionRailProps): JSX.Element {
  // T-28 — "Show all tags" is renderer view-state, local like `collapsed`, and starts off.
  const [showAllTags, setShowAllTags] = useState(false)
  // A toggle for tags that do not exist would do nothing — render it only once there are some.
  const hasTags = useTags((s) => s.tags.length > 0)
  // The PINNED session — the one whose terminal is on screen. A primitive `string | null`, so no
  // useShallow, and it re-renders the rail only when the operator actually switches terminals.
  // Each SECTION subscribes to its own ids separately (RailSection), which is why there is no
  // whole-list subscription here any more: a session flipping to needs-you now re-renders the two
  // sections involved instead of every row in the rail.
  const activeId = useBoard(selectRailActiveSessionId)
  // Workspaces (Task 9a) — the active workspace, threaded into selectStartingTerminals below.
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  // Story 5.6 (rail gap) — launched-but-not-yet-correlated terminals: the "Starting" group.
  // useShallow because selectStartingTerminals returns an array. Supersede is automatic:
  // once a terminal correlates AND has a card in sessionsById, selectStartingTerminals drops it.
  const startingTerminals = useBoard(
    useShallow((s: BoardState) => selectStartingTerminals(s, activeWorkspaceId))
  )
  // Collapse is RENDERER VIEW-STATE; local to the rail (do NOT round-trip to main). UX-DR9:
  // collapsible to 56px icons, NEVER hidden.
  const [collapsed, setCollapsed] = useState(false)

  // The aria-live announcement for a session NEWLY entering needs-you (AC-5). Computed from a
  // narrow selector so an UNRELATED row change does not re-announce: we track the set of currently
  // needs-you-UNacknowledged ids and announce the row(s) that just appeared in it.
  const prevNeedsRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  // Workspaces (Task 9a fix, review round 1) — which workspace `prevNeedsRef`'s baseline was
  // computed for. A workspace SWITCH must re-prime (skip one announce pass), exactly like the
  // mount-time priming below — otherwise every already-needs-you session already sitting in the
  // NEWLY active workspace gets diffed against the PREVIOUS workspace's baseline and is wrongly
  // announced as "new" on every switch (and again on every switch back).
  const primedWorkspaceIdRef = useRef<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Subscribe to the store imperatively for the announce diff (avoids re-render churn — we read the
  // emphasis per id off the current state). This runs after every store change.
  useEffect(() => {
    const computeAndAnnounce = (): void => {
      const state = boardStore.getState()
      // Workspaces (Task 9a) — this runs in a store-subscription callback, not React render, so
      // there is no hook to call: read the CURRENT active workspace off the singleton store
      // (mirrors reading `boardStore.getState()` on the line above).
      const workspaceId = selectActiveWorkspaceId(workspacesStore.getState())
      const nowNeeds = new Set<string>()
      for (const id of selectRailOrder(state, workspaceId)) {
        if (selectRailEmphasis(state, id) === 'needs-you') nowNeeds.add(id)
      }
      // Workspaces (Task 9a fix): if the workspace this call observes differs from the one the
      // CURRENT baseline was computed for, this is a switch — treat it exactly like the
      // mount-time priming (seed the baseline, announce NOTHING for this pass) rather than
      // diffing B's needs-you set against A's baseline. Adding `workspaceId` to the effect's deps
      // would NOT fix this: the effect would just re-run with `primedRef` still true and produce
      // the same spurious announcement sooner. Checking it INSIDE the same current-value read
      // this callback already does is what makes the re-prime immediate and correct.
      const workspaceChanged = primedWorkspaceIdRef.current !== workspaceId
      // The FIRST call (priming, on mount) seeds the baseline ONLY — a session already in needs-you
      // at mount is NOT announced as "new". Subsequent calls (same workspace) announce the rows
      // that just appeared.
      if (primedRef.current && !workspaceChanged) {
        const newlyNeeds: string[] = []
        for (const id of nowNeeds) {
          if (!prevNeedsRef.current.has(id)) {
            const session = state.sessionsById[id]
            if (session) newlyNeeds.push(shortName(session))
          }
        }
        if (newlyNeeds.length > 0) {
          setAnnouncement(
            newlyNeeds.length === 1
              ? `${newlyNeeds[0]} needs you`
              : `${newlyNeeds.length} sessions need you`
          )
        }
      }
      prevNeedsRef.current = nowNeeds
      primedRef.current = true
      primedWorkspaceIdRef.current = workspaceId
    }
    computeAndAnnounce()
    const unsub = boardStore.subscribe(computeAndAnnounce)
    return unsub
  }, [])

  return (
    <nav
      className={`${styles.rail} ${collapsed ? styles.collapsed : ''}`}
      data-testid="attention-rail"
      data-collapsed={collapsed}
      aria-label="Sessions"
    >
      <div className={styles.header}>
        {!collapsed && <span className={styles.title}>Sessions</span>}
        <span className={styles.headerTools}>
          {!collapsed && hasTags && (
            <button
              type="button"
              className={styles.collapseToggle}
              data-testid="rail-show-tags"
              aria-pressed={showAllTags}
              aria-label="Show all tags"
              title={showAllTags ? 'Hide tags' : 'Show all tags'}
              onClick={() => setShowAllTags((v) => !v)}
            >
              <TagGlyphIcon size={13} />
            </button>
          )}
          <button
            type="button"
            className={styles.collapseToggle}
            data-testid="rail-collapse"
            aria-label={collapsed ? 'Expand sessions rail' : 'Collapse sessions rail'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? '»' : '«'}
          </button>
        </span>
      </div>
      <LiveAnnouncer message={announcement} />
      {/* The PINNED row: the session currently on screen, ALWAYS first — above needs-you, above
          everything. It carries NO divider on purpose: a label over a single row would be
          explaining the obvious (it is the one you are looking at, and its own fill + "(active)"
          in the accessible name already say so), and a rule above it would push it down into the
          list it is deliberately standing outside of.

          It is also excluded from its own status section (selectRailSection filters it), so it
          appears exactly once — a nav list that shows one session twice reads as two sessions.

          It sits OUTSIDE `.scroll`, in its own slot. The active row is a TAB that paints over the
          rail's right-edge wall to break it, and nothing inside `.scroll` can overflow sideways to
          do that (`overflow-y: auto` forces `overflow-x` to `auto` too). A row called "pinned"
          also should not scroll away with the list, which it used to. */}
      {activeId !== null && (
        <div className={styles.pinnedSlot} data-testid="rail-pinned-slot">
          <ul className={styles.list} data-testid="rail-pinned-list" aria-label="Open">
            <li className={styles.listItem}>
              <RailRow
                id={activeId}
                collapsed={collapsed}
                showAllTags={showAllTags}
                onActivate={onActivateSession}
                onRename={onRenameSession}
                onSetTags={onSetSessionTags}
              />
            </li>
          </ul>
        </div>
      )}
      <div className={styles.scroll} data-testid="rail-scroll">
        {/* One group per status, urgent-first. Each renders nothing when empty, so a rail with a
            single working session shows one divider — not three. */}
        {RAIL_SECTION_COLUMNS.map((column) => (
          <RailSection
            key={column}
            column={column}
            collapsed={collapsed}
            showAllTags={showAllTags}
            onActivate={onActivateSession}
            onRename={onRenameSession}
            onSetTags={onSetSessionTags}
          />
        ))}
        {/* Story 5.6 (rail gap) — "Starting" group: calm, BELOW the session rows so it never
            competes with needs-you emphasis. Rendered only when ≥1 starting terminal exists.
            Supersede is automatic via selectStartingTerminals (drops once correlated + card
            present). It now uses the SHARED RailDivider instead of its own bespoke border+label,
            so all four groups are separated the same way. */}
        {startingTerminals.length > 0 && (
          <div className={styles.section} data-testid="starting-rail-section">
            <RailDivider label="Starting" />
            <ul className={styles.list} data-testid="starting-rail-list" aria-label="Starting">
              {startingTerminals.map((lt) => (
                <li key={lt.terminalId} className={styles.listItem}>
                  <StartingRailRow terminal={lt} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </nav>
  )
}
