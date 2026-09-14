// Story 1.4 — the live three-column board (AC-1..AC-6, AC-9).
//
// Mounts the watch subscription (`window.watch.onEvents`) and feeds each validated,
// epoch-framed delta into the board store's `applyWatchEvent`. Renders the THREE
// columns in a FIXED grid — working · needs-you · idle, with needs-you PINNED as the
// center hero (`HERO_COLUMN`; the Story-1.5 adaptive cascade + its swap debounce are
// retired) — plus the two board states:
//   - cold-load skeleton (AC-5) — ghost columns until the first delta OR the
//     engine-started `watch:status` push (Story 5.3 / 6.4);
//   - empty board (AC-4) — headline + line + the single `+ New session` primary.
// (The historical reconnect banner died with the c9watch CLI feed — Story 6.4.)
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
import { NewSessionButton } from '../NewSessionMenu/NewSessionButton'
import { FilterBar } from '../FilterBar/FilterBar'
import {
  boardStore,
  useBoard,
  selectColdLoaded,
  selectTotalCount,
  selectColumnCount,
  selectSelectedId,
  selectStartingTerminals,
  HERO_COLUMN
} from '../../stores/boardStore'
// Workspaces (Task 9a) — Board is a component, so it reads the active workspace itself (per
// task instructions) and passes it into the now-required workspace-scoped selectors below.
import { useWorkspaces, selectActiveWorkspaceId } from '../../stores/workspacesStore'
import { effectiveTagFilter, useTags } from '../../stores/tagsStore'
import { useShallow } from 'zustand/react/shallow'
import type { Column as BoardColumn, Template } from '../../../../shared/ipc/contract'
import { useAttentionSound } from '../../audio/useAttentionSound'
import styles from './Board.module.css'

/** The FIXED slot order: left flank · center hero · right flank. The hero is PINNED to
 *  Needs-you (`HERO_COLUMN`), so this no longer varies — Working is always the left flank and
 *  Idle is always the right flank (Idle is never the hero — AC-2 / FROZEN-1, now by
 *  construction). A module constant, not store state: nothing can reorder it.
 *
 *  This REPLACES the Story-1.5 adaptive `slotOrder(hero)` + its 400ms swap debounce; see
 *  `HERO_COLUMN` in boardStore.ts for why the swap was retired. */
const SLOT_ORDER: readonly [BoardColumn, BoardColumn, BoardColumn] = [
  'working',
  HERO_COLUMN,
  'idle'
]

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
  /** New-session launch seam (Epic-3 / FR-11) — the popover's `Pick a folder…`. Defaults to a no-op. */
  onNewSession?: () => void
  /** Session templates — the popover's template rows. Defaults to a no-op. */
  onPickTemplate?: (template: Template) => void
  /** Session templates — the popover's `Manage templates…`. Defaults to a no-op. */
  onManageTemplates?: () => void
  /** Session-naming A2 — card rename seam (the pencil). Omitted ⇒ no pencil is rendered. */
  onRenameCard?: (id: string) => void
  /** Task 12 — card move-to-workspace seam. Omitted ⇒ no move affordance is rendered. */
  onMoveCardToWorkspace?: (id: string, workspaceId: string) => void
  /** Tags — card Tags… seam. Omitted ⇒ no Tags… button. */
  onSetCardTags?: (id: string, tagIds: string[]) => void
  /** Tags — opens the Tags dialog; a card's Tags… button uses it while no tag exists yet. */
  onManageTags?: () => void
}

export function Board({
  onActivateCard,
  onNewSession,
  onPickTemplate,
  onManageTemplates,
  onRenameCard,
  onMoveCardToWorkspace,
  onSetCardTags,
  onManageTags
}: BoardProps): JSX.Element {
  // Workspaces (Task 9a) — the active workspace id, read ONCE here and threaded into every
  // workspace-scoped selector below (selectTotalCount / selectColumnCount / selectStartingTerminals).
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  // Tags — the filter bar's choice, resolved for this workspace (null = no filter, or a tag it
  // cannot see).
  const tagId = useTags((s) => effectiveTagFilter(s, activeWorkspaceId))
  const tagName = useTags((s) =>
    tagId === null ? null : (s.tags.find((t) => t.id === tagId)?.name ?? null)
  )
  const coldLoaded = useBoard(selectColdLoaded)
  const total = useBoard((s) => selectTotalCount(s, activeWorkspaceId, tagId))
  // "Is the workspace empty" must not follow the filter: a filtered-out board is not an empty one.
  const workspaceTotal = useBoard((s) => selectTotalCount(s, activeWorkspaceId, null))
  const needsYouCount = useBoard((s) => selectColumnCount(s, 'needs-you', activeWorkspaceId, tagId))
  const workingCount = useBoard((s) => selectColumnCount(s, 'working', activeWorkspaceId, tagId))
  const idleCount = useBoard((s) => selectColumnCount(s, 'idle', activeWorkspaceId, tagId))
  // Story 2.2 (FR-9) — the SELECTED card id (primitive narrow selector, no useShallow).
  const selectedId = useBoard(selectSelectedId)
  // Story 5.6 (AC-6 optional) — starting terminals count (for the empty-board copy softening).
  // useShallow required (array selector). We only need the count here; the StartingBanner
  // component subscribes independently to the full list.
  const startingCount = useBoard(
    useShallow((s) => selectStartingTerminals(s, activeWorkspaceId).length)
  )

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

  // COLD-LOAD-COMPLETE (Story 5.3, kept by the Story-6.4 native engine): main pushes
  // `CH.watchStatus { reconnecting: false }` at engine start (twice, belt-and-suspenders)
  // and `setReconnecting` flips `coldLoaded` — the ONLY skeleton-clear path when no delta
  // ever arrives (the normal empty cold start). (The Story-1.5 hero-swap tick interval that
  // used to share this effect is GONE with the swap — the hero is pinned; see HERO_COLUMN.)
  useEffect(() => {
    const off = window.watch.onStatus((status) =>
      boardStore.getState().setReconnecting(status.reconnecting)
    )
    return off
  }, [])

  // The aria-live announcement of live column counts (AC-9). Re-announced when any
  // count changes (the string is derived, never persisted).
  //
  // Review finding E — in board view the rail's own live region is inert/aria-hidden, so this is
  // the ONLY in-app live region; it must follow the tag filter (never an alert: notifier, badge,
  // sound and the rail announcement stay unfiltered by design). With no filter (or a filter that
  // hides nothing in this workspace) the string is BYTE-IDENTICAL to before this change.
  const hiddenByTagFilter = tagId !== null ? workspaceTotal - total : 0
  const announcement = `${needsYouCount} need you, ${workingCount} working, ${idleCount} idle${
    hiddenByTagFilter > 0 ? `, ${hiddenByTagFilter} hidden by the tag filter` : ''
  }`

  return (
    <div className={styles.board} data-testid="board">
      <div className={styles.statusLine}>
        {/* Story 5.6 (AC-3, AC-6) — the compact starting-terminals banner. Renders ABOVE and
            OUTSIDE the skeleton/empty/live ternary so it shows in every board state. Renders
            nothing when there are zero starting terminals (no DOM footprint). */}
        <StartingBanner />
      </div>

      <LiveAnnouncer message={coldLoaded ? announcement : ''} />

      {/* Tags — the filter bar: what the board is filtered by, above the columns. It draws itself
          only once the workspace has sessions, and stays when the filter hides them all (so the
          operator can remove it right there). */}
      <FilterBar
        total={total}
        workspaceTotal={workspaceTotal}
        {...(onManageTags ? { onManageTags } : {})}
      />

      {!coldLoaded ? (
        // AC-5 — cold-load skeleton (haven't heard from the session engine yet). NOT a
        // spinner, and DISTINCT from the empty board ("heard, and there are none").
        <div className={styles.grid} data-testid="skeleton-board">
          <SkeletonColumn name="Working" accent="working" />
          <SkeletonColumn name="Needs you" accent="needs-you" />
          <SkeletonColumn name="Idle" accent="idle" />
        </div>
      ) : workspaceTotal === 0 ? (
        // AC-4 — empty board (cold-loaded, zero sessions). Headline + line + the ONE
        // primary action. `+ New session` launches an in-app session (Epic-3 / FR-11).
        // Story 3.3 (FR-1 amended) — the Board shows ONLY app-launched sessions, so the empty
        // board is the NORMAL cold state and the ONLY affordance is `+ New session`. The old
        // "…or start one in Konsole and it'll appear here" invite is GONE: external/Konsole
        // sessions are intentionally never shown (the launched-set is the single gate, AC-4/F5).
        // Story 5.6 (AC-6 optional) — when starting terminals exist, soften the "No sessions
        // yet." copy (a launch is in flight) while keeping `+ New session` reachable.
        // Session templates — the primary is the SAME popover button as the header (folder /
        // templates / Manage), centered; the three seams are threaded from App.
        <div className={styles.emptyBoard} data-testid="empty-board">
          <p className={styles.emptyBoardHeadline}>
            {startingCount > 0 ? 'Starting…' : 'No sessions yet.'}
          </p>
          <p className={styles.emptyBoardLine}>
            {startingCount > 0
              ? 'Waiting for c9watch to register the session.'
              : 'Launch one with + New session to get started.'}
          </p>
          <NewSessionButton
            variant="primary"
            testId="new-session"
            onPickFolder={() => onNewSession?.()}
            onPickTemplate={(template) => onPickTemplate?.(template)}
            onManage={() => onManageTemplates?.()}
          />
        </div>
      ) : total === 0 ? (
        // Tags — the workspace HAS sessions and the tag filter hides them all. A different sentence
        // from "No sessions yet." (design.md: three nothings, three answers) — otherwise the
        // operator goes looking for sessions that are only filtered out.
        <div className={styles.emptyBoard} data-testid="empty-board-filtered">
          <p className={styles.emptyBoardHeadline}>
            {`No sessions tagged ${tagName ?? 'with this tag'}.`}
          </p>
          <p className={styles.emptyBoardLine}>Remove the tag filter to see every session.</p>
        </div>
      ) : (
        // The live three-column grid: slots are left flank (working) · center hero
        // (needs-you) · right flank (idle), FIXED. `data-hero-column` still reflects the hero
        // column VALUE (distinct from the per-column boolean `data-hero` flag) for
        // tests/styling.
        <div className={styles.grid} data-testid="column-grid" data-hero-column={HERO_COLUMN}>
          {SLOT_ORDER.map((column) => (
            <Column
              key={column}
              column={column}
              isHero={column === HERO_COLUMN}
              selectedId={selectedId}
              {...(onActivateCard ? { onActivateCard } : {})}
              {...(onRenameCard ? { onRenameCard } : {})}
              {...(onMoveCardToWorkspace ? { onMoveCardToWorkspace } : {})}
              {...(onSetCardTags ? { onSetCardTags } : {})}
              {...(onManageTags ? { onManageTags } : {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}
