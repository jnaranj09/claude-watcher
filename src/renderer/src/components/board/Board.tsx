// Story 1.4 — the live three-column board (AC-1..AC-6, AC-9).
//
// Mounts the watch subscription (`window.watch.onEvents`) and feeds each validated,
// epoch-framed delta into the board store's `applyWatchEvent`. Renders the THREE
// columns in a STATIC grid (fixed reading order working · needs-you · idle — the
// adaptive center-hero cascade is Story 1.5), plus the three board states:
//   - cold-load skeleton (AC-5) — ghost columns until the first delta (epoch ≥ 1);
//   - empty board (AC-4) — headline + line + the single `+ New session` primary;
//   - reconnect banner (AC-6) — a thin non-modal banner past the gap threshold.
//
// Accessibility (AC-9): a single `LiveAnnouncer` (aria-live=polite) announces the live
// column counts; status is never color-only (the 1.3 StatusDot/SessionCard enforce
// dot + label). The store is the single projection of main's session truth — this
// component never invents or mutates session truth (state.md one-way flow).
import { useEffect, type JSX } from 'react'
import { Column } from './Column'
import { ColumnHeader } from '../ColumnHeader/ColumnHeader'
import { LiveAnnouncer } from '../../styles/LiveAnnouncer'
// Story 5.6 (AC-3, AC-6) — the compact starting-terminals banner (status-line region).
import { StartingBanner } from './StartingBanner'
import {
  boardStore,
  useBoard,
  selectColdLoaded,
  selectReconnecting,
  selectTotalCount,
  selectColumnCount,
  selectHeroColumn,
  selectSelectedId,
  selectStartingTerminals,
  type HeroColumn
} from '../../stores/boardStore'
import { useShallow } from 'zustand/react/shallow'
import type { Column as BoardColumn } from '../../../../shared/ipc/contract'
import { useAttentionSound } from '../../audio/useAttentionSound'
import styles from './Board.module.css'

/** How often the reconnect-debounce timer re-evaluates whether the banner should show,
 *  AND how often the hero-swap debounce commits (Story 1.5 `tickHero`). A named interval
 *  (no magic number); well under BOTH debounce thresholds so each commit lands promptly
 *  once its anchor has persisted past the window. */
const RECONNECT_TICK_MS = 1_000

/** Story 1.5 — the adaptive SLOT order: left flank · center hero · right flank. Idle is
 *  ALWAYS the right flank and NEVER the hero (AC-2 / FROZEN-1); the center is the committed
 *  hero; the left flank is the OTHER hero-eligible column (Working when Needs-you is hero;
 *  Needs-you when Working is hero). Derived from the narrow `selectHeroColumn` — no
 *  denormalized slot list is stored (AC-8). */
function slotOrder(hero: HeroColumn): readonly [BoardColumn, BoardColumn, BoardColumn] {
  const leftFlank: BoardColumn = hero === 'needs-you' ? 'working' : 'needs-you'
  return [leftFlank, hero, 'idle']
}

/** Cold-load skeleton: a column header + 2–3 ghost cards. No spinner (UX-DR16). */
function SkeletonColumn({
  name,
  accent
}: {
  name: string
  accent: 'working' | 'needs-you' | 'idle'
}): JSX.Element {
  return (
    <section className={styles.column} data-testid="skeleton-column">
      <ColumnHeader name={name} count={0} accent={accent} />
      <div className={styles.cardStack}>
        <div className={styles.skeletonCard} data-testid="skeleton-card" />
        <div className={styles.skeletonCard} data-testid="skeleton-card" />
        <div className={styles.skeletonCard} data-testid="skeleton-card" />
      </div>
    </section>
  )
}

export interface BoardProps {
  /** Card activation seam (Epic-3 focused-session open). Defaults to a no-op. */
  onActivateCard?: (id: string) => void
  /** New-session launch seam (Epic-3 / FR-11). Defaults to a no-op. */
  onNewSession?: () => void
}

export function Board({ onActivateCard, onNewSession }: BoardProps): JSX.Element {
  const coldLoaded = useBoard(selectColdLoaded)
  const reconnecting = useBoard(selectReconnecting)
  const total = useBoard(selectTotalCount)
  const needsYouCount = useBoard((s) => selectColumnCount(s, 'needs-you'))
  const workingCount = useBoard((s) => selectColumnCount(s, 'working'))
  const idleCount = useBoard((s) => selectColumnCount(s, 'idle'))
  // Story 1.5 — the COMMITTED (debounced) hero, a primitive narrow selector (no useShallow).
  // The Board re-renders only when the hero column actually commits to a new value.
  const hero = useBoard(selectHeroColumn)
  // Story 2.2 (FR-9) — the SELECTED card id (primitive narrow selector, no useShallow).
  const selectedId = useBoard(selectSelectedId)
  // Story 5.6 (AC-6 optional) — starting terminals count (for the empty-board copy softening).
  // useShallow required (array selector). We only need the count here; the StartingBanner
  // component subscribes independently to the full list.
  const startingCount = useBoard(useShallow((s) => selectStartingTerminals(s).length))

  // Mount the watch subscription ONCE; feed validated deltas into the store. The
  // store applies idempotently (stale-epoch discard) so a reconnect never drops a
  // transition. Returns the unsubscribe on unmount.
  useEffect(() => {
    const off = window.watch.onEvents((payload) => boardStore.getState().applyWatchEvent(payload))
    return off
  }, [])

  // Story 2.4 — the attention SOUND side effect: a SEPARATE subscription to the SAME
  // CH.watchEvents stream that plays ONE sound per `attention.raised` when sound is enabled
  // (mute = the sole governor; no debounce here). The board store still ignores attention.raised
  // for session truth — this is purely an alert side effect (NO self-raise; frozen union intact).
  useAttentionSound()

  // Story 2.2 (FR-9) — subscribe to the in-app jump-to-card signal (the operator activated a
  // notification). Set the board selection to the originating card; the store no-ops if that
  // card is not present. INFORMATIONAL ONLY: this locates-and-highlights the card — it does NOT
  // raise/focus the window and sends no input to the agent. Returns the unsubscribe on unmount.
  // Story 3.3 — NO renderer-side launched-vs-external filter here: main GATES the attention
  // emission at the source (index.ts onDelta), so an external session never creates a
  // notification → never produces a jump-to-card signal. This subscription already only ever
  // sees LAUNCHED activations. Do NOT add a redundant filter (it would be a second, drift-prone
  // membership source — the renderer has no launched-set; main owns it).
  useEffect(() => {
    const off = window.attention.onActivate(({ id }) => boardStore.getState().setSelected(id))
    return off
  }, [])

  // Reconnect banner (AC-6 / UX-DR17): driven by main's REAL connection signal over
  // CH.watchStatus — NOT by line silence (a quiet `watch --changes-only` emits 0 lines,
  // so silence is the normal steady state, not a gap). main's feed detects the watch
  // child's exit + runs a serialized reconnect and pushes `reconnecting` on/off here.
  // `setReconnecting(true)` anchors the debounce; the interval flips the banner visible
  // once the gap exceeds RECONNECT_THRESHOLD_MS; `setReconnecting(false)` clears it.
  // The hero-swap debounce (Story 1.5, AC-5) commits on the SAME tick cadence: tickHero
  // commits a pending hero swap once it has persisted past HERO_SWAP_DEBOUNCE_MS. The
  // cadence is << the debounce window so the commit lands promptly.
  useEffect(() => {
    const off = window.watch.onStatus((status) =>
      boardStore.getState().setReconnecting(status.reconnecting)
    )
    const id = setInterval(() => {
      boardStore.getState().tickReconnect()
      boardStore.getState().tickHero()
    }, RECONNECT_TICK_MS)
    return () => {
      off()
      clearInterval(id)
    }
  }, [])

  // The aria-live announcement of live column counts (AC-9). Re-announced when any
  // count changes (the string is derived, never persisted).
  const announcement = `${needsYouCount} need you, ${workingCount} working, ${idleCount} idle`

  return (
    <div className={styles.board} data-testid="board">
      <div className={styles.statusLine}>
        {reconnecting && (
          <div className={styles.reconnectBanner} role="status" data-testid="reconnect-banner">
            Reconnecting to c9watch…
          </div>
        )}
        {/* Story 5.6 (AC-3, AC-6) — the compact starting-terminals banner. Renders ABOVE and
            OUTSIDE the skeleton/empty/live ternary so it shows in every board state. Renders
            nothing when there are zero starting terminals (no DOM footprint). */}
        <StartingBanner />
      </div>

      <LiveAnnouncer message={coldLoaded ? announcement : ''} />

      {!coldLoaded ? (
        // AC-5 — cold-load skeleton (haven't heard from c9watch yet). NOT a spinner,
        // and DISTINCT from the empty board (which means "heard, and there are none").
        <div className={styles.grid} data-testid="skeleton-board">
          <SkeletonColumn name="Working" accent="working" />
          <SkeletonColumn name="Needs you" accent="needs-you" />
          <SkeletonColumn name="Idle" accent="idle" />
        </div>
      ) : total === 0 ? (
        // AC-4 — empty board (cold-loaded, zero sessions). Headline + line + the ONE
        // primary action. `+ New session` launches an in-app session (Epic-3 / FR-11).
        // Story 3.3 (FR-1 amended) — the Board shows ONLY app-launched sessions, so the empty
        // board is the NORMAL cold state and the ONLY affordance is `+ New session`. The old
        // "…or start one in Konsole and it'll appear here" invite is GONE: external/Konsole
        // sessions are intentionally never shown (the launched-set is the single gate, AC-4/F5).
        // Story 5.6 (AC-6 optional) — when starting terminals exist, soften the "No sessions
        // yet." copy (a launch is in flight) while keeping `+ New session` reachable.
        <div className={styles.emptyBoard} data-testid="empty-board">
          <p className={styles.emptyBoardHeadline}>
            {startingCount > 0 ? 'Starting…' : 'No sessions yet.'}
          </p>
          <p className={styles.emptyBoardLine}>
            {startingCount > 0
              ? 'Waiting for c9watch to register the session.'
              : 'Launch one with + New session to get started.'}
          </p>
          <button
            type="button"
            className={styles.newSessionButton}
            data-testid="new-session"
            onClick={() => onNewSession?.()}
          >
            + New session
          </button>
        </div>
      ) : (
        // The live ADAPTIVE three-column grid (Story 1.5): slots are left flank · center
        // hero · right flank (idle). The hero occupant lands in the CENTER track; Idle is
        // always the right flank, never the hero (AC-2). `data-hero-column` reflects the
        // committed hero column VALUE (distinct from the per-column boolean `data-hero`
        // flag) for tests/styling, without storing a denormalized slot list (AC-8).
        <div className={styles.grid} data-testid="column-grid" data-hero-column={hero}>
          {slotOrder(hero).map((column) => (
            <Column
              key={column}
              column={column}
              isHero={column === hero}
              selectedId={selectedId}
              {...(onActivateCard ? { onActivateCard } : {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}
