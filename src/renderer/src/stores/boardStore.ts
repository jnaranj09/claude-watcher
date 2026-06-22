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
import type { Column, WatchEventsPayload, QuitGuardPayload } from '../../../shared/ipc/contract'

/**
 * Story 4.3 (FR-15) — the STOP-CONFIRM modal payload (RENDERER VIEW-STATE; not session truth).
 * Non-null when the operator triggered the Stop-confirm for a focused session. Null when no
 * confirm is shown. The renderer renders `<StopConfirm/>` from this payload.
 * Set via `showStopConfirm(payload)`; cleared via `clearStopConfirm()`.
 * [state.md: modal open/closed = renderer view-state; session truth = main]
 */
export interface StopConfirmPayload {
  /** The opaque terminalId to stop (via window.terminal.stop(terminalId) — CH.terminalStop). */
  terminalId: string
  /** The session name to display verbatim in the confirm dialog (UX-DR22). */
  sessionName: string
}
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

/** Story 3.4 — return a shallow copy of `record` without `key` (immutable delete). Pure; no
 *  mutation of the input. Used to clear an ack/binding entry on a c9watch column-leave/removal. */
function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  const next = { ...record }
  delete next[key]
  return next
}

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
   *  NOT a window raise. [state.md: selection = renderer view-state]
   *
   *  Story 3.2 (FR-11 / UX-DR24 / F6) — the focused-session selection RECONCILES with this SAME
   *  `selectedId` (jump-to-card + focused-session are ONE selection; do NOT invent a parallel
   *  one). Focusing a card sets `selectedId` + `viewMode='focused'`. */
  selectedId: string | null
  /** Story 3.2 (FR-11 / UX-DR24 / F6) — Board ↔ Focused-session VIEW-STATE (NOT routing, NOT a
   *  second window — single-window). `'board'` shows the three-column board; `'focused'` shows
   *  the focused session's EmbeddedTerminal + Esc-to-Board. Default `'board'`. */
  viewMode: 'board' | 'focused'
  /** Story 3.2 (FR-11 / UX-DR19) — the OPAQUE terminalId the Focused-session renders (the
   *  optimistic App-launched terminal). Set the MOMENT a launch returns its terminalId — BEFORE
   *  the Tgid correlation join binds a c9watch session `id` (the terminal is typeable immediately,
   *  never blocked on the join). Distinct from `selectedId` (the session id, set when a card is
   *  activated / when the join reconciles in a later story). null when no terminal is focused. */
  focusedTerminalId: string | null
  /** Story 3.4 (FR-16) — THE ONE shared per-session attention/acknowledge state (AC-4). Maps a
   *  session `id` → epoch-millis it was acknowledged (opened/switched-to while in needs-you). This
   *  is the SINGLE source for "which needs-you sessions are still UNacknowledged" — it drives BOTH
   *  the rail's needs-you emphasis (`selectRailEmphasis`) AND the Story-2.2 board-card highlight.
   *  Do NOT invent a second/parallel ack flag. [architecture.md:546-549 — "attention acknowledged"
   *  is renderer view-state, Zustand, NEVER round-tripped to main; UX-DR28.]
   *
   *  RECONCILE WITH c9watch TRUTH (AC-4): the entry is CLEARED when the session leaves the
   *  needs-you column (`session.updated` column!=='needs-you') or is removed (`session.removed`).
   *  Ack is only meaningful while the session is in needs-you, so clearing on exit means a RE-ENTRY
   *  into needs-you re-emphasizes (new attention = a new event). The OS tray badge is INDEPENDENT
   *  (main-owned, c9watch-truth — `badge.ts`), recomputed every delta; it is NOT driven by this ack
   *  state and is NEVER round-tripped to c9watch — so the two layers never contradict ("badge can't
   *  outlive the handled session": both fall together on the same c9watch column-leave/removal). */
  acknowledgedById: Record<string, number>
  /** Story 3.4 (FR-16 / Task 4.1) — the sessionId → terminalId reverse map (renderer VIEW-STATE).
   *  Populated from the `CH.launchCorrelated` push (`window.launch.onCorrelated`) the moment a
   *  launch's Tgid join lands in main. The attention rail uses it to switch the visible terminal BY
   *  session id (a pure renderer show/hide of the kept-alive terminals — NO per-switch IPC). The
   *  entry is cleared on `session.removed` (the session — and so its binding — is gone). A session
   *  with NO entry yet (pre-correlation) is alert-only-non-switchable; it becomes switchable the
   *  moment the binding lands (degrade gracefully, never crash). */
  terminalIdBySessionId: Record<string, string>
  /**
   * Story 4.2 (FR-14) — the QUIT-GUARD modal payload (RENDERER VIEW-STATE; not session truth).
   * Non-null when main detected ≥1 live app-launched session and pushed the guard payload via
   * `CH.quitGuardShow`. Null when no guard is shown. The renderer renders `<QuitGuard/>` from
   * this payload — it does NOT re-derive the count (session truth stays MAIN-owned — state.md).
   * Set via `showQuitGuard(payload)`; cleared via `clearQuitGuard()`.
   * [state.md: modal open/closed = renderer view-state; session truth = main]
   */
  quitGuard: QuitGuardPayload | null
  /**
   * Story 4.3 (FR-15) — the STOP-CONFIRM modal payload (RENDERER VIEW-STATE; not session truth).
   * Non-null when the operator triggered the Stop-confirm for a focused session. Null when no
   * confirm is shown. The renderer renders `<StopConfirm/>` from this payload.
   * Set via `showStopConfirm(payload)`; cleared via `clearStopConfirm()`.
   * Single-modal rule (UX-DR14): cannot co-exist with quitGuard.
   * [state.md: modal open/closed = renderer view-state; session truth = main]
   */
  stopConfirm: StopConfirmPayload | null
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
  /** Story 3.2 (FR-11 / UX-DR19 / F6) — drop into the Focused-session for a freshly LAUNCHED
   *  terminal. Sets `viewMode='focused'` + `focusedTerminalId=terminalId` OPTIMISTICALLY (main
   *  holds the PTY; the terminal is typeable immediately, not blocked on the Tgid join). The
   *  c9watch session `id` is not known yet — `selectedId` reconciles later (a future story
   *  receives the join). Single-window in-app view-state only — NO routing, NO window raise.
   *  (Named `openLaunchedTerminal` not `focus*` — this is an in-app VIEW transition, NOT an OS
   *  window focus/raise; the Story-2.2 view-state invariant treats `focus`/`raise` action names
   *  as window operations, which this is NOT.) */
  openLaunchedTerminal: (terminalId: string) => void
  /** Story 3.2 (FR-11 / F6) — activate a card by its session `id` (the Board `onActivateCard`
   *  seam): SELECT it (the ONE selection, reconciled with the Story-2.2 `selectedId`) and drop
   *  into its Focused-session IF a terminal is known for it. A no-op if the card is not present.
   *
   *  SCOPE (3.2): the `sessionId → terminalId` reverse map (so a card click can open the
   *  app-launched session's terminal) is NOT built here — that pairing arrives when Story 3.3/3.4
   *  wire the launched-set FILTER + the focused-session rail. So in 3.2 `activateCard` ONLY
   *  selects (highlights the card); it switches to the Focused view ONLY when a `focusedTerminalId`
   *  is already set (it does NOT claim `viewMode='focused'` with no terminal to show — that would
   *  be a ghost state the UI silently ignores). The launch path (`openLaunchedTerminal`) is the
   *  one that actually enters the Focused view in 3.2. In-app view-state only — NO window raise. */
  activateCard: (id: string) => void
  /** Story 3.2 (FR-11 / UX-DR21 / F6) — return to the Board (Esc-to-Board). Sets
   *  `viewMode='board'`. Leaves `selectedId` intact so the card stays highlighted on the board
   *  (the selection persists; only the view changes). In-app view-state only. */
  showBoard: () => void
  /** Story 3.4 (FR-16 / AC-4) — ACKNOWLEDGE a session (the operator opened/switched-to it). Stamps
   *  `acknowledgedById[id] = now()` so `selectRailEmphasis(id)` returns 'calm' even while c9watch
   *  still reports it in needs-you (UX-DR28: opening clears that session's IN-APP emphasis; the OS
   *  badge is independent c9watch-truth). Idempotent re-stamp is harmless. Called from the rail-row
   *  click + the open/switch paths (openLaunchedTerminal / activateCard / switchFocusedTerminal). */
  acknowledge: (id: string) => void
  /** Story 3.4 (FR-16 / Task 4.1) — record a launch correlation binding from the `CH.launchCorrelated`
   *  push: `terminalIdBySessionId[sessionId] = terminalId`. View-state only (the rail switches the
   *  visible terminal by session id). Idempotent. */
  addCorrelation: (sessionId: string, terminalId: string) => void
  /** Story 3.4 (FR-16 / AC-3 / Task 4.3) — switch the VISIBLE terminal to `terminalId` (a rail click
   *  on a session whose binding is known). PURE renderer view-state: sets `focusedTerminalId` +
   *  `viewMode='focused'`; the kept-alive terminals (visibility:hidden) are NOT recreated and NO
   *  input is sent (alert-only, FR-9-consistent). NOT named `switchFocused*` — like
   *  `openLaunchedTerminal`, this is an in-app VIEW transition, NOT an OS window focus/raise (the
   *  Story-2.2 view-state invariant treats `focus`/`raise` names as window operations, which this is
   *  NOT). Does NOT acknowledge by itself — the caller pairs it with `acknowledge(sessionId)` (the
   *  rail row knows the sessionId; this action takes only the terminalId so it stays a pure switch). */
  switchTerminal: (terminalId: string) => void
  /**
   * Story 4.2 (FR-14) — open the Quit-guard modal with the payload main computed + pushed.
   * Sets `quitGuard = payload`. Pure, small action. No side effects.
   * Single-modal rule (UX-DR14): if Settings is open (local state in Settings component),
   * it will be hidden by the guard overlay (z-index: 60 > Settings z-50). The guard takes
   * precedence — a quit decision dominates a settings panel.
   */
  showQuitGuard: (payload: QuitGuardPayload) => void
  /**
   * Story 4.2 (FR-14) — close the Quit-guard modal (operator cancelled).
   * Sets `quitGuard = null`. No teardown — see FROZEN #1.
   */
  clearQuitGuard: () => void
  /**
   * Story 4.3 (FR-15) — open the Stop-confirm modal for a specific session.
   * Sets `stopConfirm = payload`. Pure, small, no side effects. No IPC here —
   * the explicit `window.terminal.stop` call happens at the component call site
   * BEFORE view-state changes (FROZEN F1; state.md: no IPC inside store actions).
   * Single-modal rule (UX-DR14): do NOT show when quitGuard is open.
   */
  showStopConfirm: (payload: StopConfirmPayload) => void
  /**
   * Story 4.3 (FR-15) — close the Stop-confirm modal (operator cancelled OR stop completed).
   * Sets `stopConfirm = null`. No teardown here — the explicit stop happens at the call site
   * BEFORE this (FROZEN F1).
   */
  clearStopConfirm: () => void
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
    // Story 3.2 (FR-11) — the board view + no focused terminal until the first launch/activate.
    viewMode: 'board',
    focusedTerminalId: null,
    // Story 3.4 (FR-16) — nothing acknowledged + no correlation bindings until the first
    // acknowledge / the first CH.launchCorrelated push.
    acknowledgedById: {},
    terminalIdBySessionId: {},
    // Story 4.2 (FR-14) — no quit guard shown until main pushes the guard payload.
    quitGuard: null,
    // Story 4.3 (FR-15) — no stop confirm shown until the operator triggers it.
    stopConfirm: null,

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
        // Story 3.4 (FR-16 / AC-4) — reconcile the ack state with c9watch truth: when a session
        // LEAVES the needs-you column, clear its acknowledged entry (ack is only meaningful while
        // it is waiting; a RE-ENTRY into needs-you must re-emphasize as a new event). The badge is
        // independent main-owned truth, so the two layers fall together coherently — "badge can't
        // outlive the handled session." A still-needs-you update leaves the ack entry intact.
        const ackCleared =
          event.column !== 'needs-you' && state.acknowledgedById[event.id] !== undefined
        set({
          sessionsById,
          epoch: payload.epoch,
          coldLoaded: true, // first delta of epoch ≥ 1 flips the cold-load skeleton off
          ...(ackCleared ? { acknowledgedById: omitKey(state.acknowledgedById, event.id) } : {}),
          // Story 1.5 — re-evaluate the pending hero AFTER the count change (Task 1.3).
          ...reevaluateHero(state, sessionsById)
        })
        return
      }

      if (event.type === 'session.removed') {
        // AC-2 — the card VANISHES (no Done column). Drop by id.
        const nextById = { ...state.sessionsById }
        delete nextById[event.id]
        // Story 3.4 (FR-16 / AC-4 / Task 4.1) — a removed session's ack entry + its terminal binding
        // are stale: clear both so the emphasis falls coherently with the badge (which also recomputes
        // DOWN on this same c9watch removal), and the rail no longer holds a binding for a gone session.
        const ackCleared = state.acknowledgedById[event.id] !== undefined
        const bindingCleared = state.terminalIdBySessionId[event.id] !== undefined
        set({
          sessionsById: nextById,
          epoch: payload.epoch,
          coldLoaded: true,
          // Story 2.2 (FR-9) — if the REMOVED session was the selected card, clear the
          // selection (the highlighted card no longer exists). Otherwise leave it untouched.
          ...(state.selectedId === event.id ? { selectedId: null } : {}),
          ...(ackCleared ? { acknowledgedById: omitKey(state.acknowledgedById, event.id) } : {}),
          ...(bindingCleared
            ? { terminalIdBySessionId: omitKey(state.terminalIdBySessionId, event.id) }
            : {}),
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
      // Story 5.3 — COLD-LOAD-COMPLETE: receiving ANY `watch:status` push means main's
      // feed is live and has completed its initial `list` seed → cold-load is done.
      // This MUST be at the TOP, before the early-return paths below, because a
      // fresh-store startup `setReconnecting(false)` hits the recovery branch whose
      // `set(...)` does NOT run (both `reconnecting:false` and `reconnectingSince:null`),
      // so without this guarded flip the skeleton would hang forever on an empty board.
      // The `coldLoaded` flip is orthogonal to the reconnect-banner debounce.
      if (!state.coldLoaded) set({ coldLoaded: true })
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
    },

    openLaunchedTerminal: (terminalId) => {
      // Optimistic drop-into-Focused-session the moment the launch returns its terminalId (UX-DR19).
      // The terminal renders + is typeable immediately; the session `id` (selectedId) reconciles
      // later. Single-window in-app VIEW-STATE only — no routing, no window raise.
      set({ viewMode: 'focused', focusedTerminalId: terminalId })
    },

    activateCard: (id) => {
      // Activate a present card (the Board onActivateCard seam): SELECT it (ONE selection,
      // reconciled with the Story-2.2 selectedId). A no-op for an absent card. Enter the Focused
      // view ONLY when a terminal is already focused (the sessionId→terminalId reverse map is a
      // Story-3.3/3.4 concern) — never claim viewMode='focused' with no terminal to show (a ghost
      // state the UI silently ignores). The launch path is the one that enters Focused in 3.2.
      const state = get()
      if (state.sessionsById[id] === undefined) return
      // Story 3.4 (AC-4 / UX-DR28) — opening a session ACKNOWLEDGES it (clears its in-app emphasis).
      // The known sessionId stamps the ONE ack state (rail + card read the same selectRailEmphasis).
      set({
        selectedId: id,
        acknowledgedById: { ...state.acknowledgedById, [id]: now() },
        ...(state.focusedTerminalId !== null ? { viewMode: 'focused' as const } : {})
      })
    },

    showBoard: () => {
      // Esc-to-Board (UX-DR21). Return to the board view; leave selectedId intact (the card stays
      // highlighted on the board). View-state only.
      if (get().viewMode !== 'board') set({ viewMode: 'board' })
    },

    acknowledge: (id) => {
      // Story 3.4 (AC-4 / UX-DR28) — stamp the acknowledged time (injected now() for determinism).
      // Clears that session's IN-APP emphasis (rail + card) via selectRailEmphasis; the OS badge is
      // independent c9watch-truth and is untouched here. Re-stamp is harmless (idempotent in effect).
      const state = get()
      set({ acknowledgedById: { ...state.acknowledgedById, [id]: now() } })
    },

    addCorrelation: (sessionId, terminalId) => {
      // Story 3.4 (Task 4.1) — record the launch correlation binding (from CH.launchCorrelated). The
      // rail switches the visible terminal by session id off this map. Idempotent; no-op if unchanged.
      const state = get()
      if (state.terminalIdBySessionId[sessionId] === terminalId) return
      set({ terminalIdBySessionId: { ...state.terminalIdBySessionId, [sessionId]: terminalId } })
    },

    switchTerminal: (terminalId) => {
      // Story 3.4 (AC-3 / Task 4.3) — switch the visible terminal (a rail click). PURE view-state:
      // the kept-alive terminals are shown/hidden via visibility (terminal.md), never recreated, and
      // NO input is sent. Enter the Focused view if not already there. Does NOT acknowledge (the
      // caller pairs it with acknowledge(sessionId) — this action knows only the terminalId).
      const state = get()
      if (state.focusedTerminalId === terminalId && state.viewMode === 'focused') return
      set({ viewMode: 'focused', focusedTerminalId: terminalId })
    },

    showQuitGuard: (payload) => {
      // Story 4.2 (FR-14) — open the Quit-guard modal (main detected ≥1 live session).
      // Pure, small, no side effects. Session truth stays MAIN-owned; this is the renderer
      // view-state that makes the modal visible. [state.md: modal open/closed = view-state]
      set({ quitGuard: payload })
    },

    clearQuitGuard: () => {
      // Story 4.2 (FR-14) — close the Quit-guard modal (operator cancelled). The before-quit
      // e.preventDefault() already aborted the quit; this clears the renderer overlay.
      // No teardown — every PTY stays live (FROZEN #1).
      const state = get()
      if (state.quitGuard !== null) set({ quitGuard: null })
    },

    showStopConfirm: (payload) => {
      // Story 4.3 (FR-15) — open the Stop-confirm modal. Pure, small, no side effects.
      // The explicit window.terminal.stop MUST happen at the component call site BEFORE
      // clearing view-state (FROZEN F1; the modal's Stop button handles this ordering).
      // [state.md: modal open/closed = view-state; no IPC inside store actions]
      set({ stopConfirm: payload })
    },

    clearStopConfirm: () => {
      // Story 4.3 (FR-15) — close the Stop-confirm modal (cancelled or stop completed).
      // No PTY teardown here — the explicit window.terminal.stop runs BEFORE this at the
      // call site (FROZEN F1).
      const state = get()
      if (state.stopConfirm !== null) set({ stopConfirm: null })
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

/** Story 3.2 (FR-11) — the current view mode (primitive). App.tsx switches Board ↔ Focused. */
export const selectViewMode = (state: BoardState): 'board' | 'focused' => state.viewMode

/** Story 3.2 (FR-11) — the focused terminal's opaque id (primitive). The Focused-session view
 *  renders this terminal's EmbeddedTerminal; null when no terminal is focused. */
export const selectFocusedTerminalId = (state: BoardState): string | null => state.focusedTerminalId

// ---------------------------------------------------------------------------
// Story 3.4 (FR-16) — the ONE shared attention/acknowledge selectors. Rail emphasis AND the
// Story-2.2 board-card emphasis BOTH read `selectRailEmphasis` (one state, no parallel flag).
//
// NOTE the DISTINCTION from `selectedId` (Story 2.2): `selectedId` is "which card is SELECTED"
// (locate-and-highlight / which terminal is being viewed); `selectRailEmphasis` is "does this
// session NEED YOU, UNacknowledged." They are orthogonal concerns over the SAME store. The rail's
// ACTIVE row maps to the focused terminal's session (the one being viewed), not to selectedId.
// ---------------------------------------------------------------------------

/** True iff the session has been acknowledged (opened/switched-to while in needs-you). A primitive
 *  parameterized selector — safe without useShallow. */
export const selectIsAcknowledged = (state: BoardState, id: string): boolean =>
  state.acknowledgedById[id] !== undefined

/** The rail/card emphasis for a session: `'needs-you'` iff it is in the needs-you column AND NOT
 *  acknowledged; otherwise `'calm'`. The ONE derivation BOTH the rail row and the board card read
 *  (no second ack flag). A primitive string — safe without useShallow (per-row subscription). */
export function selectRailEmphasis(state: BoardState, id: string): 'needs-you' | 'calm' {
  const session = state.sessionsById[id]
  if (session === undefined || session.column !== 'needs-you') return 'calm'
  return state.acknowledgedById[id] !== undefined ? 'calm' : 'needs-you'
}

/** The terminalId bound to a session id (from the CH.launchCorrelated push), or undefined if the
 *  binding has not landed yet (pre-correlation → alert-only-non-switchable). Primitive. */
export const selectTerminalIdForSession = (state: BoardState, id: string): string | undefined =>
  state.terminalIdBySessionId[id]

/**
 * Story 4.2 (FR-14) — the Quit-guard modal payload (RENDERER VIEW-STATE; null = no guard shown).
 * A primitive-ish selector (returns an object or null); callers that need object fields use
 * this directly — it's already narrow (the whole modal payload or null).
 */
export const selectQuitGuard = (state: BoardState): QuitGuardPayload | null => state.quitGuard

/**
 * Story 4.3 (FR-15) — the Stop-confirm modal payload (RENDERER VIEW-STATE; null = no confirm shown).
 * Non-null when the operator triggered the Stop-confirm for a focused session.
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectStopConfirm = (state: BoardState): StopConfirmPayload | null => state.stopConfirm

/** Story 3.4 (FR-16 / Task 4.3) — the set of app-launched terminal ids to keep ALIVE in the
 *  focused view (so a rail switch is a pure show/hide, never a recreate — terminal.md). It is the
 *  correlated bindings (`terminalIdBySessionId` values) UNION the current `focusedTerminalId` (the
 *  optimistic just-launched terminal whose binding may not have landed yet). Returns a STABLE,
 *  SORTED, de-duplicated string[] so an equal set under `useShallow` does not re-render / remount
 *  the terminals. Derived; not stored. */
export function selectKeptAliveTerminalIds(state: BoardState): string[] {
  const ids = new Set<string>(Object.values(state.terminalIdBySessionId))
  if (state.focusedTerminalId !== null) ids.add(state.focusedTerminalId)
  return [...ids].sort()
}

/** Story 3.4 (FR-16 / AC-1) — the SORTED session-id list the attention rail renders. SAME source
 *  as the board (`sessionsById` = the post-3.3 launched-set-filtered feed main ships). STABLE sort:
 *  needs-you sessions FIRST (they want you), then by `enteredColumnAt` ascending (oldest-waiting
 *  first), calm rows below in the same entered-time order. Returns ONLY the ids (a string[]) so the
 *  rail subscribes to a small, stable projection (per-row emphasis is a separate narrow selector,
 *  so an emphasis flip does not re-sort/re-render the whole rail — Task 3.6). Derived; not stored. */
export function selectRailOrder(state: BoardState): string[] {
  return Object.values(state.sessionsById)
    .slice()
    .sort((a, b) => {
      const aNeeds = a.column === 'needs-you' ? 0 : 1
      const bNeeds = b.column === 'needs-you' ? 0 : 1
      if (aNeeds !== bNeeds) return aNeeds - bNeeds
      if (a.enteredColumnAt !== b.enteredColumnAt) return a.enteredColumnAt - b.enteredColumnAt
      // Final tiebreak on id so the order is fully deterministic (no render churn on equal times).
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((s) => s.id)
}

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
