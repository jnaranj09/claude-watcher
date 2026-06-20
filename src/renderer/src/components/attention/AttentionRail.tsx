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
  type BoardState
} from '../../stores/boardStore'
import { shortName } from './railName'
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
}): JSX.Element | null {
  const { id, collapsed, onActivate } = props
  const view = useBoard(useShallow((s: BoardState) => selectRailRowView(s, id)))
  if (!view.present) return null
  const { name, status, emphasized, active } = view
  const label = active ? `${name} (active)` : name

  return (
    <button
      type="button"
      className={`${styles.row} ${emphasized ? `${styles.emphasized} ${needsYouEmphasisClass}` : ''} ${active ? styles.active : ''}`}
      data-testid="rail-row"
      data-session-id={id}
      {...(emphasized ? { 'data-emphasized': true } : {})}
      {...(active ? { 'data-active': true } : {})}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      onClick={() => onActivate(id)}
    >
      <StatusDot status={status} labelHidden={collapsed} label={name} />
      {collapsed ? (
        <span className={styles.initial} aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
      ) : (
        <span className={styles.name} data-testid="rail-row-name">
          {name}
        </span>
      )}
    </button>
  )
}

export interface AttentionRailProps {
  /** Activate a rail row's session: switch the visible terminal (if its binding is known) AND
   *  acknowledge it. Wired by the Focused-session view (Task 4.3). */
  onActivateSession: (sessionId: string) => void
}

export function AttentionRail({ onActivateSession }: AttentionRailProps): JSX.Element {
  // The SORTED session-id list — the small, stable projection (state.md narrow selector, via
  // useShallow so a sort that returns an equal list does not re-render). An emphasis flip does NOT
  // change this list (per-row emphasis is a separate subscription).
  const order = useBoard(useShallow(selectRailOrder))
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
            <RailRow id={id} collapsed={collapsed} onActivate={onActivateSession} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
