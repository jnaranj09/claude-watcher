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
//   - `needsYouEmphasisClass` (the @keyframes needsYouPulse + the prefers-reduced-motion fallback
//     live in emphasis.module.css — opacity 1.0↔0.78 + scale 1.0↔1.015 ~1.5s, compositor-only;
//     reduced-motion → static gold + size, no pulse — UX-DR27/29). The rail ADDS the 44→56px
//     enlarge + 14%-gold fill + needs-you border as its OWN row styling, but keeps the enlarge in
//     the reduced-motion path too (only the pulse drops — see AttentionRail.module.css).
//   - the `--needs-you` gold token (NEEDS_YOU_TOKEN) for the fill/border.
//   - the shipped `StatusDot` (never color-only — paired with a text label, UX-DR29).
//   - a `LiveAnnouncer` (aria-live=polite) for a session NEWLY entering needs-you.
//
// STATE (state.md): the rail + ack state are RENDERER VIEW-STATE in the board store. NARROW
// selectors — the rail subscribes to the sorted id LIST (`selectRailOrder`); each ROW subscribes
// to its OWN `selectRailEmphasis(id)` (so one row's emphasis flip does not re-render the whole
// rail — Task 3.6). Session truth stays main-owned; the rail renders the projection main ships.
//
// CLICK (AC-3): a rail row whose session has a known terminalId SWITCHES the visible terminal
// (pure renderer show/hide of the kept-alive terminals — terminal.md; NO per-switch IPC, NO input
// sent — alert-only, FR-9-consistent) AND acknowledges that session (UX-DR28). A row whose binding
// has not landed yet is alert-only-non-switchable (it becomes switchable once the binding arrives —
// degrade gracefully, never crash). [Source: story 3.4 Task 3/4; UX-DR9/27/28/29; architecture.md]
import { useEffect, useRef, useState, type JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { StatusDot, type DotStatus } from '../StatusDot/StatusDot'
import { LiveAnnouncer } from '../../styles/LiveAnnouncer'
import { needsYouEmphasisClass } from '../../styles/emphasis'
import type { Column } from '../../../../shared/ipc/contract'
import {
  useBoard,
  boardStore,
  selectRailOrder,
  selectRailEmphasis,
  selectFocusedTerminalId,
  selectTerminalIdForSession,
  selectStartingTerminals,
  type BoardState,
  type LaunchedTerminal
} from '../../stores/boardStore'
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

/** The per-row projection — the SMALLEST slice a row needs. Subscribed via `useShallow` so a row
 *  re-renders only when ITS own fields change (state.md narrow selectors, Task 3.6). */
interface RailRowView {
  name: string
  status: DotStatus
  emphasized: boolean
  active: boolean
  present: boolean
}

function selectRailRowView(state: BoardState, id: string): RailRowView {
  const session = state.sessionsById[id]
  if (session === undefined) {
    return { name: '', status: 'idle', emphasized: false, active: false, present: false }
  }
  const focused = selectFocusedTerminalId(state)
  const terminalId = selectTerminalIdForSession(state, id)
  return {
    name: shortName(session),
    status: DOT_STATUS_FOR_COLUMN[session.column],
    emphasized: selectRailEmphasis(state, id) === 'needs-you',
    active: focused !== null && terminalId === focused,
    present: true
  }
}

/** A single rail row. Subscribes NARROWLY (useShallow over `selectRailRowView`) to its OWN slice
 *  (Task 3.6) so a sibling's change does not re-render it. Renders status dot + short name (never
 *  color-only); collapsed mode renders an icon-only row (dot + initial). A `<button>` so it is
 *  keyboard-activatable (Enter/Space = click) with the shipped lavender AA focus ring (UX-DR29). */
function RailRow(props: {
  id: string
  collapsed: boolean
  onActivate: (sessionId: string) => void
  onRename?: ((sessionId: string) => void) | undefined
}): JSX.Element | null {
  const { id, collapsed, onActivate, onRename } = props
  const view = useBoard(useShallow((s: BoardState) => selectRailRowView(s, id)))
  if (!view.present) return null
  const { name, status, emphasized, active } = view
  // The row's accessible name carries the STATUS TEXT, not just the session name. A <button> with
  // its own `aria-label` does not expose its inner text to assistive tech — the label REPLACES the
  // contents — so the dot's screen-reader-only status span below is never announced from in here.
  // Without the status in this string, the status would reach a screen-reader user through dot
  // COLOR alone (the UX-DR29 floor: color is never the sole signal).
  const statusText = statusLabel(status)
  const label = active ? `${name}, ${statusText} (active)` : `${name}, ${statusText}`

  const row = (
    <button
      type="button"
      className={`${styles.row} ${emphasized ? `${styles.emphasized} ${needsYouEmphasisClass}` : ''} ${active ? styles.active : ''}`}
      data-testid="rail-row"
      data-session-id={id}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      {...(active ? { 'data-active': true } : {})}
      aria-label={label}
      title={label}
      aria-current={active ? 'true' : undefined}
      onClick={() => onActivate(id)}
    >
      {/* `labelHidden` UNCONDITIONALLY, and NO `label` override. Both halves matter:
          - `labelHidden={collapsed}` used to make the dot's label VISIBLE whenever the rail was
            expanded, and `label={name}` made that visible label the SESSION NAME — so an expanded
            row printed the name twice (once here, once in `.name` below). That was the bug.
          - dropping the `label` override lets the dot fall back to its per-state status text, so
            what it contributes is the STATUS, not a second copy of the title.
          Mirrors SessionCard.tsx, which has always passed a bare `labelHidden`. */}
      <StatusDot status={status} labelHidden />
      {/* Collapsed is the CIRCLE ALONE. It used to also render the name's first letter beside the
          dot ("● D"), which is what UX-DR9's "56px icons" never asked for — the dot already IS the
          row's icon, and the letter made a 44px row carry two glyphs. The row stays identifiable
          without it: the `aria-label` carries name + status for assistive tech, and the `title`
          added above gives a sighted operator the same on hover (which is also what makes an
          ellipsized name readable in the EXPANDED rail — `.name` truncates). */}
      {!collapsed && (
        <span className={styles.name} data-testid="rail-row-name">
          {name}
        </span>
      )}
    </button>
  )

  // A2 — the rename pencil is a SIBLING of the row, never a child.
  //
  // This row is a real `<button>`, and a `<button>` inside a `<button>` is invalid HTML (unlike
  // SessionCard, whose root is a `<div role="button">`, so a nested button is legal there). So the
  // pencil goes beside the row inside the `<li>`, and the two share a flex wrapper.
  //
  // EXPANDED ONLY: a collapsed rail is 56px wide and its `<li>` shrink-wraps a 44/56px circle —
  // there is no room for a second control, and squeezing one in would push the circle back
  // off-centre (the exact thing the measured centring fix just corrected). Rename stays reachable
  // in collapsed mode from the board card's pencil.
  if (collapsed || onRename === undefined) return row

  return (
    <div className={styles.rowWrap}>
      {row}
      <button
        type="button"
        className={styles.rowRenameButton}
        data-testid="rail-rename"
        aria-label={`Rename ${name}`}
        title={`Rename ${name}`}
        onClick={() => onRename(id)}
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

  function handleClick(): void {
    boardStore.getState().switchTerminal(terminalId)
  }

  // Always "<name> — starting", collapsed or not. The aria-label used to drop the " — starting"
  // suffix in collapsed mode — exactly the mode where no visible text explains the row at all.
  // Doubles as the `title`, so the collapsed ring is identifiable on hover too.
  const rowLabel = `${label} — starting`

  return (
    <button
      type="button"
      className={styles.startingRow}
      data-testid="starting-rail-row"
      data-terminal-id={terminalId}
      aria-label={rowLabel}
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
}

export function AttentionRail({
  onActivateSession,
  onRenameSession
}: AttentionRailProps): JSX.Element {
  // The SORTED session-id list — the small, stable projection (state.md narrow selector, via
  // useShallow so a sort that returns an equal list does not re-render). An emphasis flip does NOT
  // change this list (per-row emphasis is a separate subscription).
  const order = useBoard(useShallow(selectRailOrder))
  // Story 5.6 (rail gap) — launched-but-not-yet-correlated terminals: the "Starting" group.
  // useShallow because selectStartingTerminals returns an array. Supersede is automatic:
  // once a terminal correlates AND has a card in sessionsById, selectStartingTerminals drops it.
  const startingTerminals = useBoard(useShallow(selectStartingTerminals))
  // Collapse is RENDERER VIEW-STATE; local to the rail (do NOT round-trip to main). UX-DR9:
  // collapsible to 56px icons, NEVER hidden.
  const [collapsed, setCollapsed] = useState(false)

  // The aria-live announcement for a session NEWLY entering needs-you (AC-5). Computed from a
  // narrow selector so an UNRELATED row change does not re-announce: we track the set of currently
  // needs-you-UNacknowledged ids and announce the row(s) that just appeared in it.
  const prevNeedsRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  const [announcement, setAnnouncement] = useState('')
  // Subscribe to the store imperatively for the announce diff (avoids re-render churn — we read the
  // emphasis per id off the current state). This runs after every store change.
  useEffect(() => {
    const computeAndAnnounce = (): void => {
      const state = boardStore.getState()
      const nowNeeds = new Set<string>()
      for (const id of selectRailOrder(state)) {
        if (selectRailEmphasis(state, id) === 'needs-you') nowNeeds.add(id)
      }
      // The FIRST call (priming, on mount) seeds the baseline ONLY — a session already in needs-you
      // at mount is NOT announced as "new". Subsequent calls announce the rows that just appeared.
      if (primedRef.current) {
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
      </div>
      <LiveAnnouncer message={announcement} />
      <ul className={styles.list} data-testid="rail-list">
        {order.map((id) => (
          <li key={id} className={styles.listItem}>
            <RailRow
              id={id}
              collapsed={collapsed}
              onActivate={onActivateSession}
              onRename={onRenameSession}
            />
          </li>
        ))}
      </ul>
      {/* Story 5.6 (rail gap) — "Starting" group: calm, BELOW the session rows so it never
          competes with needs-you emphasis. Rendered only when ≥1 starting terminal exists.
          Supersede is automatic via selectStartingTerminals (drops once correlated + card present). */}
      {startingTerminals.length > 0 && (
        <div className={styles.startingSection} data-testid="starting-rail-section">
          {!collapsed && (
            <span className={styles.startingLabel} aria-hidden="true">
              Starting
            </span>
          )}
          <ul className={styles.list} data-testid="starting-rail-list">
            {startingTerminals.map((lt) => (
              <li key={lt.terminalId} className={styles.listItem}>
                <StartingRailRow terminal={lt} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}
