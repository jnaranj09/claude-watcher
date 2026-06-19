// Story 1.4 — the FIRST Zustand store (AC-7, AC-8). The canonical Epic-1 store the
// `.claude/rules/state.md` standard describes.
//
// OWNERSHIP (state.md): session truth is the MAIN process (parsed at the Zod
// boundary, reduced, then shipped as VALIDATED epoch-framed deltas). This store holds
// only the renderer's PROJECTION of that truth — it reduces the already-validated
// `WatchEventsPayload` deltas (NEVER raw c9watch JSON; NEVER re-parses the parse-once
// boundary) into a `BoardSession` map keyed by the stable `id`. View grouping + sort
// are DERIVED in narrow selectors, never persisted (no denormalized copies to keep in
// sync). Terminals are NOT in the store (imperative refs; .claude/rules/terminal.md).
//
// Determinism: `now()` is injected into the store factory (state.md: "inject now() for
// epoch-millis determinism"). The store does NOT call now() for sort (sort uses the
// wire's `enteredColumnAt`); now() is reserved for the reconnect-banner DEBOUNCE the
// store owns (see the reconnect note below).
//
// RECONNECT BANNER (Story 1.4 code-review fix) — driven by main's REAL connection signal,
// NOT by line silence. The verified contract (`c9watch-0.8.1-contract.md`) says
// `c9watch watch --changes-only` emits 0 lines on a quiet machine — silence is the NORMAL
// steady state, so the old `now() - lastDeltaAt > threshold` inference falsely flagged an
// idle, healthy fleet as reconnecting. Main's feed already detects the watch child's exit
// and runs a serialized auto-reconnect (Story 1.1), and now pushes that state over
// `CH.watchStatus` → the Board calls `setReconnecting(...)`. `RECONNECT_THRESHOLD_MS` is now
// a DEBOUNCE on the real `reconnecting:true` signal (UX-DR17: "only if a gap exceeds a
// threshold") — `tickReconnect` flips the banner visible once the gap since the signal
// exceeds the threshold; `setReconnecting(false)` clears it immediately on recovery.
//
// [Source: story 1.4 Tasks 3/5 + code-review MED; .claude/rules/state.md; architecture.md
//  #Renderer Architecture (Zustand 5.0.14), #Communication/State Patterns (narrow
//  selectors, useShallow, epoch discard); src/main/c9watch/feed.ts (reconnect lifecycle)]
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Column, WatchEventsPayload } from '../../../shared/ipc/contract'
import { sortByEnteredColumn } from '../lib/sortByEnteredColumn'

/**
 * The renderer-facing session view-model (Task 3.3) — a PROJECTION of session truth,
 * built PURELY from the validated `session.updated` delta (which now carries all of
 * these fields). camelCase; no invented attributes beyond what the wire provides.
 */
export interface BoardSession {
  id: string
  sessionName: string
  projectPath: string
  /** Raw c9watch status string (verbatim; not enum-locked). */
  status: string
  /** What the session is blocked on, when c9watch reports one. */
  pendingToolName?: string
  pid: number
  /** Board column placement (computed in main by the Story-1.2 tracker). */
  column: Column
  /** Epoch-millis the session entered its current column (the UX-DR10 sort key). */
  enteredColumnAt: number
}

/** DEBOUNCE applied to main's real `reconnecting:true` signal before the banner shows
 *  (AC-6 / UX-DR17: "only if a gap exceeds a threshold"). A named const (no magic
 *  number); a short reconnect that recovers within this window never flaps the banner.
 *  This is NOT a line-silence timer (silence is the normal quiet steady state). */
export const RECONNECT_THRESHOLD_MS = 6_000

/** Story 1.5 — the HERO-SWAP debounce window (AC-5 / FROZEN-4). The hero only commits
 *  to a new occupant after the RAW cascade result has stayed put past this threshold,
 *  so a single Needs-you session blinking in/out on the 0↔1 boundary does NOT thrash the
 *  center hero. The THIRD distinct debounce in the app — DISTINCT from Story 1.2's
 *  attention-emission debounce (main) and the reconnect-banner debounce above (connection
 *  state). 400ms is a sensible default (not docs-specified): long enough to swallow a
 *  sub-second flap, short enough that a genuine promotion still reads as immediate (well
 *  under the ~1s attention-latency NFR). Override via `BoardStoreOptions.heroSwapDebounceMs`. */
export const HERO_SWAP_DEBOUNCE_MS = 400

/** The two HERO-ELIGIBLE columns. Idle is NEVER the hero (FROZEN-1 / AC-2) — it is always
 *  a flank — so the cascade chooses only between these two. */
export type HeroColumn = Extract<Column, 'needs-you' | 'working'>

/**
 * Story 1.5 — the PURE, undebounced cascade (AC-1, AC-2, AC-8). Returns the RAW hero by
 * the corrected cascade Needs-you → Working → Idle, restricted to the two hero-eligible
 * columns: Needs-you when anything needs you, else Working. Idle is NEVER returned (AC-2)
 * — even in the degenerate "only Idle has sessions" case Working takes the (empty/calm)
 * center, Idle stays a flank. Keyed on column MEMBERSHIP only (no prod-vs-develop weighting
 * — FR-2). A primitive in / primitive out — trivially testable, no store, no now().
 *
 * NOTE: the cascade reasons over the two hero-eligible columns, but Working is the
 * DETERMINISTIC fall-through whenever no one needs you — even when Working is itself empty
 * (the degenerate empty board is its own 1.4 state, AC-4 of 1.4). So only the needs-you
 * count is load-bearing; the working count never changes the outcome and is intentionally
 * NOT a parameter (it would be dead). Idle is absent from the return type, enforcing AC-2
 * at the type level.
 */
export function cascadeHero(needsYouCount: number): HeroColumn {
  return needsYouCount > 0 ? 'needs-you' : 'working'
}

export interface BoardState {
  /** Session projections keyed by the stable `id`. */
  sessionsById: Record<string, BoardSession>
  /** Highest epoch seen — older deltas are discarded (idempotent, AC-6). */
  epoch: number
  /** False until the first delta of epoch ≥ 1 arrives (cold-load skeleton, AC-5). */
  coldLoaded: boolean
  /** Whether the reconnect BANNER should show (AC-6). Derived from main's real
   *  `reconnecting` signal AFTER the debounce window — never set directly by the UI. */
  reconnecting: boolean
  /** Epoch-millis when main's `reconnecting:true` signal arrived (debounce anchor);
   *  null when the feed is connected. Stamped via the injected `now()`. */
  reconnectingSince: number | null
  /** Story 1.5 — the COMMITTED hero column (the center-slot occupant). Derived truth
   *  from the cascade, NOT user-selectable (AC-7 / FROZEN-6). Default `'working'` (the
   *  calm fall-through when nothing needs you). Only the debounce commit moves it; the
   *  store keeps NO denormalized copy of the hero column's card list (AC-8). */
  heroColumn: HeroColumn
  /** Story 1.5 — debounce anchor: epoch-millis (via injected now()) stamped when the RAW
   *  cascade result first DIFFERS from the committed `heroColumn`; null when committed and
   *  raw agree (no pending swap). Mirrors `reconnectingSince`. */
  heroPendingSince: number | null
  /** Story 1.5 — the pending swap TARGET (the raw cascade result awaiting the debounce);
   *  null when no swap is pending. */
  heroPendingTarget: HeroColumn | null
  /** Story 2.2 (FR-9) — the SELECTED card's session id (RENDERER VIEW-STATE, not session
   *  truth). Set from a `CH.attentionActivate` push when the operator activates a notification
   *  AND the card is present; null when nothing is selected. Cleared when the selected session
   *  is removed from the board. This is a locate-and-highlight affordance — NOT navigation,
   *  NOT a window raise. [state.md: selection = renderer view-state] */
  selectedId: string | null
  /** Reduce ONE validated, epoch-framed delta. Discards stale-epoch deltas. */
  applyWatchEvent: (payload: WatchEventsPayload) => void
  /** Apply main's pushed connection state (CH.watchStatus). `true` anchors the debounce
   *  window (banner still hidden until `tickReconnect` crosses the threshold); `false`
   *  recovers immediately (clears the banner + the anchor). */
  setReconnecting: (reconnecting: boolean) => void
  /** Flip the banner visible once the gap since the `reconnecting:true` signal exceeds
   *  the debounce threshold (UX-DR17). No-op while connected. Uses the injected now(). */
  tickReconnect: () => void
  /** Story 1.5 — COMMIT a pending hero swap once it has stayed past the debounce window
   *  (AC-5). Mirrors `tickReconnect`: no anchor → no-op; past `HERO_SWAP_DEBOUNCE_MS` since
   *  the anchor → commit `heroColumn = heroPendingTarget` and clear the anchor. The Board
   *  runs this on the existing tick interval. Uses the injected now(). */
  tickHero: () => void
  /** Story 2.2 (FR-9) — set the selected card (locate-and-highlight). Passing an `id` that is
   *  NOT present in `sessionsById` is a NO-OP (the card may have already left the board);
   *  passing `null` clears the selection. View-state only — no window raise, no navigation. */
  setSelected: (id: string | null) => void
}

export interface BoardStoreOptions {
  /** Epoch-millis clock — inject for determinism; defaults to Date.now. */
  now?: () => number
  /** Debounce threshold in ms before the reconnect banner shows. Defaults to the const. */
  reconnectThresholdMs?: number
  /** Story 1.5 — HERO-SWAP debounce window in ms. Defaults to `HERO_SWAP_DEBOUNCE_MS`. */
  heroSwapDebounceMs?: number
}

/** A Zustand vanilla store instance (the store API over `BoardState`). */
export type BoardStore = StoreApi<BoardState>

/**
 * Build a fresh board store. Exported as a FACTORY so tests inject `now()` and get an
 * isolated instance; the app uses the singleton `boardStore` / `useBoard` below.
 */
export function createBoardStore(options: BoardStoreOptions = {}): BoardStore {
  const now = options.now ?? Date.now
  const reconnectThresholdMs = options.reconnectThresholdMs ?? RECONNECT_THRESHOLD_MS
  const heroSwapDebounceMs = options.heroSwapDebounceMs ?? HERO_SWAP_DEBOUNCE_MS

  /** Story 1.5 — recompute the hero DEBOUNCE bookkeeping after a count change (Task 1.3).
   *  Pure over the (prev) state + the NEW sessions map; returns ONLY the pending fields to
   *  merge (never the committed `heroColumn` — that moves on `tickHero`). A flap that
   *  returns to the committed hero clears the anchor (never swaps); a new divergence stamps
   *  the anchor via the injected now(). No denormalized hero card list (AC-8). */
  function reevaluateHero(
    prev: BoardState,
    sessionsById: Record<string, BoardSession>
  ): Pick<BoardState, 'heroPendingSince' | 'heroPendingTarget'> {
    let needsYouCount = 0
    for (const id in sessionsById) {
      if (sessionsById[id]?.column === 'needs-you') needsYouCount++
    }
    const raw = cascadeHero(needsYouCount)
    if (raw === prev.heroColumn) {
      // The raw cascade agrees with the committed hero — clear any pending swap (a flap
      // that returned to the committed state must NEVER swap — AC-5).
      return { heroPendingSince: null, heroPendingTarget: null }
    }
    // Diverged from the committed hero. Stamp a fresh anchor only when there is no pending
    // swap yet, or the pending target changed; otherwise keep the original anchor so the
    // debounce window is measured from the FIRST divergence.
    if (prev.heroPendingSince === null || prev.heroPendingTarget !== raw) {
      return { heroPendingSince: now(), heroPendingTarget: raw }
    }
    return { heroPendingSince: prev.heroPendingSince, heroPendingTarget: prev.heroPendingTarget }
  }

  return createStore<BoardState>((set, get) => ({
    sessionsById: {},
    epoch: 0,
    coldLoaded: false,
    reconnecting: false,
    reconnectingSince: null,
    // Story 1.5 — the hero defaults to Working (the calm fall-through); a needs-you
    // promotion swaps it past the debounce window. No denormalized hero card list (AC-8).
    heroColumn: 'working',
    heroPendingSince: null,
    heroPendingTarget: null,
    // Story 2.2 (FR-9) — nothing selected until a notification is activated for a present card.
    selectedId: null,

    applyWatchEvent: (payload) => {
      const state = get()
      // AC-6 — idempotent, stale-drop: discard any delta older than the latest epoch
      // we have applied. The epoch-framed reconcile (main) owns no-dropped-transition;
      // the renderer applies idempotently. A delta of the SAME epoch is still applied
      // (live watch lines share the current epoch — they are not stale).
      if (payload.epoch < state.epoch) return

      const event = payload.event

      if (event.type === 'session.updated') {
        // Upsert the projection. Built PURELY from the validated delta — no re-parse.
        const next: BoardSession = {
          id: event.id,
          sessionName: event.sessionName,
          projectPath: event.projectPath,
          status: event.status,
          pid: event.pid,
          column: event.column,
          enteredColumnAt: event.enteredColumnAt,
          ...(event.pendingToolName !== undefined ? { pendingToolName: event.pendingToolName } : {})
        }
        const sessionsById = { ...state.sessionsById, [event.id]: next }
        set({
          sessionsById,
          epoch: payload.epoch,
          coldLoaded: true, // first delta of epoch ≥ 1 flips the cold-load skeleton off
          // Story 1.5 — re-evaluate the pending hero AFTER the count change (Task 1.3).
          ...reevaluateHero(state, sessionsById)
        })
        return
      }

      if (event.type === 'session.removed') {
        // AC-2 — the card VANISHES (no Done column). Drop by id.
        const nextById = { ...state.sessionsById }
        delete nextById[event.id]
        set({
          sessionsById: nextById,
          epoch: payload.epoch,
          coldLoaded: true,
          // Story 2.2 (FR-9) — if the REMOVED session was the selected card, clear the
          // selection (the highlighted card no longer exists). Otherwise leave it untouched.
          ...(state.selectedId === event.id ? { selectedId: null } : {}),
          // Story 1.5 — a removal can empty Needs-you → re-evaluate the pending hero.
          ...reevaluateHero(state, nextById)
        })
        return
      }

      // attention.raised — the board IGNORES it (Epic 2 / Epic 3 consume it). It still
      // advances the epoch (it is a real, validated delta on the stream). It does NOT
      // change column membership, so the hero pending-state is untouched.
      set({ epoch: payload.epoch, coldLoaded: true })
    },

    setReconnecting: (reconnecting) => {
      const state = get()
      if (reconnecting) {
        // Main's watch child died and a reconnect is in flight. Anchor the debounce
        // window (do NOT show the banner yet — `tickReconnect` reveals it once the gap
        // exceeds the threshold). Idempotent: keep the original anchor on a repeat true.
        if (state.reconnectingSince === null) set({ reconnectingSince: now() })
        return
      }
      // Recovery — the watch restarted + the `list` reconcile applied. Clear the banner
      // and the debounce anchor immediately.
      if (state.reconnecting || state.reconnectingSince !== null) {
        set({ reconnecting: false, reconnectingSince: null })
      }
    },

    tickReconnect: () => {
      const state = get()
      // Debounce on the REAL signal (UX-DR17): no anchor → connected → banner stays
      // hidden. Past the threshold since the `reconnecting:true` signal → reveal it.
      // Uses the injected now() for determinism.
      if (state.reconnectingSince === null) return
      const visible = now() - state.reconnectingSince > reconnectThresholdMs
      if (visible !== state.reconnecting) set({ reconnecting: visible })
    },

    tickHero: () => {
      const state = get()
      // Story 1.5 (AC-5) — no pending swap → nothing to commit. Once the divergence has
      // persisted past the debounce window, COMMIT the pending target as the hero and clear
      // the anchor. Uses the injected now() for determinism (no real timers in tests).
      if (state.heroPendingSince === null || state.heroPendingTarget === null) return
      if (now() - state.heroPendingSince > heroSwapDebounceMs) {
        set({
          heroColumn: state.heroPendingTarget,
          heroPendingSince: null,
          heroPendingTarget: null
        })
      }
    },

    setSelected: (id) => {
      // null clears the selection. A non-null id only sets the selection if that card is
      // PRESENT on the board (the card may have already left — then it is a no-op). View-state
      // only — no window raise, no navigation, no agent input (FR-9 / FROZEN F3).
      if (id === null) {
        if (get().selectedId !== null) set({ selectedId: null })
        return
      }
      const state = get()
      if (state.sessionsById[id] === undefined) return // absent card → no-op
      if (state.selectedId !== id) set({ selectedId: id })
    }
  }))
}

// ---------------------------------------------------------------------------
// Selectors (NARROW, derive-don't-persist — state.md). Pure functions over the
// state; column grouping + sort are COMPUTED here, never stored. Components
// subscribe to the smallest slice they need; an object/array selector REQUIRES
// `useShallow` (architecture rule) — see the bound hooks below.
// ---------------------------------------------------------------------------

/** All sessions in a column, SORTED by entered-column time (working desc;
 *  needs-you/idle asc — `sortByEnteredColumn`). Derived; never persisted. */
export function selectColumn(state: BoardState, column: Column): BoardSession[] {
  const inColumn = Object.values(state.sessionsById).filter((s) => s.column === column)
  return sortByEnteredColumn(inColumn, (s) => s.enteredColumnAt, column)
}

/** Live count for a column (a primitive — safe without useShallow). */
export function selectColumnCount(state: BoardState, column: Column): number {
  let n = 0
  for (const id in state.sessionsById) {
    if (state.sessionsById[id]?.column === column) n++
  }
  return n
}

/** Total session count (a primitive — used for the empty-board state). */
export function selectTotalCount(state: BoardState): number {
  return Object.keys(state.sessionsById).length
}

/** Cold-load flag (primitive). */
export const selectColdLoaded = (state: BoardState): boolean => state.coldLoaded

/** Reconnect-banner flag (primitive). */
export const selectReconnecting = (state: BoardState): boolean => state.reconnecting

/** Story 1.5 — the COMMITTED hero column (AC-8). A NARROW, PRIMITIVE selector (returns a
 *  `HeroColumn` string — safe without `useShallow`). Derives nothing more than the already
 *  debounced commit; the hero column's card list is NEVER denormalized into the store. */
export const selectHeroColumn = (state: BoardState): HeroColumn => state.heroColumn

/** Story 2.2 (FR-9) — the SELECTED card's id (a primitive — safe without useShallow). The
 *  card with this id renders the selected affordance; null when nothing is selected. */
export const selectSelectedId = (state: BoardState): string | null => state.selectedId

// ---------------------------------------------------------------------------
// The app singleton store + bound hooks. Tests use `createBoardStore({ now })`
// directly for isolation/determinism.
// ---------------------------------------------------------------------------

/** The app's singleton board store (production clock). */
export const boardStore = createBoardStore()

/** Bind a narrow selector to the singleton store. For PRIMITIVE selectors. */
export function useBoard<T>(selector: (state: BoardState) => T): T {
  return useStore(boardStore, selector)
}

/** Subscribe to a column's SORTED card list (an array → requires useShallow so an
 *  unrelated change does not re-render the column). */
export function useColumnSessions(column: Column): BoardSession[] {
  return useStore(
    boardStore,
    useShallow((state: BoardState) => selectColumn(state, column))
  )
}
