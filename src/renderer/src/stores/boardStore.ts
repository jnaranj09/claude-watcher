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
// wire's `enteredColumnAt`); now() drives the hero-swap debounce anchor and the
// acknowledge/launch timestamps.
//
// COLD-LOAD-COMPLETE via `CH.watchStatus` (Story 5.3 contract, kept by the Story-6.4
// native engine): at engine start main pushes `{ reconnecting: false }` (twice —
// belt-and-suspenders; see index.ts registerWatchFeed). `setReconnecting` consumes it
// and flips `coldLoaded` so the skeleton clears even when NO delta ever arrives (the
// normal empty cold start). The historical reconnect BANNER died with the c9watch CLI
// feed (Story 6.4 retirement — there is no watch child to lose, so `reconnecting:true`
// is never sent); its debounce plumbing was stripped in the Epic-6 review cleanup.
//
// [Source: story 1.4 Tasks 3/5 + code-review MED; story 5.3; spec-native-session-engine.md
//  Story 6.4; .claude/rules/state.md; architecture.md #Renderer Architecture
//  (Zustand 5.0.14), #Communication/State Patterns (narrow selectors, useShallow,
//  epoch discard)]
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Column, WatchEventsPayload, QuitGuardPayload } from '../../../shared/ipc/contract'
// Workspaces (Task 9a) — `useColumnSessions` is a REACT HOOK (not a pure selector), so it is
// allowed to read the active workspace itself; this keeps the workspace/board coupling in this
// ONE commented place instead of threading an extra prop through every `Column.tsx` caller.
import { useWorkspaces, selectActiveWorkspaceId } from './workspacesStore'
// Tags (Task 9) — the board's tag filter (FilterBar). `effectiveTagFilter` resolves the chosen tag id for a
// workspace (null when it cannot see it); the workspace-scoped selectors below take that as a
// SECOND required argument, same as workspaceId (spec §4.1: no denormalized tag index here).
import { effectiveTagFilter, useTags } from './tagsStore'

/**
 * Past sessions (D-5) — the DELETE confirm's payload (RENDERER VIEW-STATE; not session truth).
 * The modal this drove WAS the Story-4.3 Stop confirm; Archive (D-3) needs no confirmation at
 * all, so the ONE remaining confirm is Delete's. Non-null when the operator triggered it (the
 * card's red Delete control, the focused bar's Delete button); null when no confirm is shown.
 * The renderer renders `<StopConfirm/>` from this payload.
 * Set via `showStopConfirm(payload)`; cleared via `clearStopConfirm()`.
 * [state.md: modal open/closed = renderer view-state; session truth = main]
 */
export interface StopConfirmPayload {
  /** The opaque terminalId to delete (via window.launch.deleteSession — CH.sessionDelete). */
  terminalId: string
  /** The session id the renderer has correlated for this terminal — null before that binding
   *  landed, and null on an already-exited pane (`session.removed` drops the binding). Only a
   *  HINT: main finds that pane's record itself, through the terminal's last bound id
   *  (`deleteTerminalSession`, src/main/pty/launchRemoval.ts). */
  sessionId: string | null
  /** The session name to display verbatim in the confirm dialog (UX-DR22). */
  sessionName: string
}

import { sortByEnteredColumn } from '../lib/sortByEnteredColumn'

/**
 * Session-naming — the NAME PROMPT payload (RENDERER VIEW-STATE; not session truth). Null when no
 * prompt is shown. The renderer renders ONE `<SessionNameDialog/>` from this payload.
 * Set via `showSessionNamePrompt(payload)`; cleared via `clearSessionNamePrompt()`.
 * [state.md: modal open/closed = renderer view-state; session truth = main]
 *
 * ONE state, TWO modes — A2 (rename) reuses this rather than adding a second modal state, so the
 * single-modal rule (UX-DR14) holds by construction: there is no way to have a create prompt and a
 * rename prompt open at once.
 *
 * A DISCRIMINATED UNION, not a wide record with optional fields: the two modes carry genuinely
 * different payloads (a `cwd` that does not exist as a session yet vs. a `sessionId` that does),
 * and the union makes the illegal mixes — a rename with a cwd, a create with a session id —
 * uncompilable instead of merely wrong at runtime.
 */
export type SessionNamePromptPayload =
  | {
      /** CREATE: naming a session that has NOT been launched yet. */
      mode: 'create'
      /** The directory the native picker returned — handed straight back to
       *  `window.launch.launch`. The launch cannot fire until the name is known, so the cwd has to
       *  survive the round-trip through the modal. NOTHING is spawned while the prompt is open, so
       *  cancelling is a complete no-op. */
      cwd: string
      /** The value the dialog's input starts at (the cwd basename). The operator may replace it. */
      initialName: string
      /** Session templates: set when the prompt was opened from a template; App branches the
       *  submit on it (launchFromTemplate vs launch). Absent for the folder flow. */
      templateId?: string
    }
  | {
      /** RENAME: retitling a session that ALREADY EXISTS on the board. */
      mode: 'rename'
      /** The stable session id (launch-minted uuid) to retitle — NEVER a pid, NEVER a terminalId.
       *  Handed to `window.launch.rename`. */
      sessionId: string
      /** The value the dialog's input starts at (the session's CURRENT name). */
      initialName: string
    }

/**
 * Story 5.6 (AC-1) — a single app-launched terminal's metadata (RENDERER VIEW-STATE).
 * Holds OPAQUE STRINGS + timestamps ONLY — never a Terminal/xterm instance, never a pid,
 * never session truth. See state.md: "active terminal" is renderer-owned; the xterm/PTY
 * INSTANCES stay in imperative refs inside EmbeddedTerminal (terminal.md / state.md SM-C2).
 */
export interface LaunchedTerminal {
  /** The opaque terminalId returned by window.launch.launch(cwd). */
  terminalId: string
  /** Epoch-millis when the launch was recorded (stamped via the injected now()). */
  launchedAt: number
  /** Display label — the basename of the picked cwd (e.g. "myproject"). */
  label: string
  /** Workspaces — the workspace MAIN stamped on this launch (from SessionLaunchResult). Held
   *  here ONLY so a frame can be hidden before its first session delta ever arrives; it is
   *  stamped once and never rewritten, so it goes STALE once a card is moved
   *  (`CH.sessionSetWorkspace` moves the SESSION, not this entry). Never filter on it directly —
   *  go through `terminalWorkspaceId(state, entry)`, which prefers the bound session's value. */
  workspaceId: string
}

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
  /** Workspaces — which workspace this card belongs to (session truth, read off the delta).
   *  The store never writes it; only main's `session.updated` changes it. */
  workspaceId: string
  /** Tags — the card's tag ids (session truth, read off the delta). The store never writes them. */
  tagIds: string[]
  /** Name-sync — a rename waiting for the next prompt; read off the delta, absent = false. */
  nameSyncPending?: boolean
}

/** The two columns that were ever HERO-ELIGIBLE. Idle is NEVER the hero (FROZEN-1 / AC-2) —
 *  it is always a flank. The type is kept (the slot plumbing is typed on it) even though the
 *  occupant no longer varies, so restoring a swap is a one-line change here. */
export type HeroColumn = Extract<Column, 'needs-you' | 'working'>

/**
 * THE hero column — PINNED to Needs-you.
 *
 * This SUPERSEDES the Story-1.5 adaptive cascade (Needs-you when anything needed you,
 * Working otherwise) and its 400ms hero-swap debounce, both REMOVED with this change. The
 * swap moved columns under the operator's cursor every time the last needs-you session
 * cleared, and the debounce existed only to make that movement tolerable; a fixed slot
 * order removes the cause instead of damping the symptom.
 *
 * Consequences that are load-bearing, not incidental:
 * - the slot order is CONSTANT — working · needs-you · idle (Board.tsx `SLOT_ORDER`);
 * - the center is the hero even while EMPTY (an empty gold column is a true statement —
 *   nothing needs you — and it keeps the board's shape stable);
 * - Idle is still never the hero (AC-2 holds, now by construction).
 *
 * It is a module constant, NOT store state: nothing can move it, so storing it would be a
 * denormalized copy of a literal (AC-8's spirit).
 */
export const HERO_COLUMN: HeroColumn = 'needs-you'

/** Story 3.4 — return a shallow copy of `record` without `key` (immutable delete). Pure; no
 *  mutation of the input. Used to clear an ack/binding entry on a c9watch column-leave/removal. */
function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  const next = { ...record }
  delete next[key]
  return next
}

export interface BoardState {
  /** Session projections keyed by the stable `id`. */
  sessionsById: Record<string, BoardSession>
  /** Highest epoch seen — older deltas are discarded (idempotent, AC-6). */
  epoch: number
  /** False until the first delta arrives OR the engine-started `watch:status` push lands
   *  (the cold-load skeleton, AC-5 / Story 5.3 — see `setReconnecting`). */
  coldLoaded: boolean
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
   * Story 5.6 (AC-1) — the renderer's OWN list of app-launched terminals (RENDERER VIEW-STATE;
   * NOT session truth — session truth stays MAIN-owned). Keyed by the opaque `terminalId`.
   * An entry is recorded the moment a launch returns its terminalId (`openLaunchedTerminal`);
   * cleared when the PTY exits naturally (`forgetLaunchedTerminal`).
   *
   * HARD limits (state.md / terminal.md / state.md SM-C2):
   *   (a) NEVER holds xterm/Terminal objects (those stay in imperative refs).
   *   (b) NEVER becomes a parallel store of session truth (board columns = main's projection).
   *   (c) Metadata ONLY: { terminalId, launchedAt, label } — opaque strings + timestamps.
   * [state.md: "active terminal" is renderer view-state; architecture.md:548]
   */
  launchedTerminals: Record<string, LaunchedTerminal>
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
   * Past sessions (D-5) — the DELETE-CONFIRM modal payload (RENDERER VIEW-STATE; not session
   * truth). The modal was Story 4.3's Stop confirm; Archive (D-3) has no confirm at all now, so
   * this is the confirm for Delete only. Non-null when the operator triggered it. Null when no
   * confirm is shown. The renderer renders `<StopConfirm/>` from this payload.
   * Set via `showStopConfirm(payload)`; cleared via `clearStopConfirm()`.
   * Single-modal rule (UX-DR14): cannot co-exist with quitGuard.
   * [state.md: modal open/closed = renderer view-state; session truth = main]
   */
  stopConfirm: StopConfirmPayload | null
  /**
   * Session-naming — the create-time NAME PROMPT payload (RENDERER VIEW-STATE; not session
   * truth). Non-null while the operator is naming a session that has not been launched yet.
   * Set via `showSessionNamePrompt(payload)`; cleared via `clearSessionNamePrompt()`.
   * [state.md: modal open/closed = renderer view-state; session truth = main]
   */
  sessionNamePrompt: SessionNamePromptPayload | null
  /** Action feedback (spec 2026-09-29 §2.2) — true while the prompt's launch/rename invoke is in
   *  flight: the prompt stays open and its confirm reads `Starting…` / `Renaming…`. Reset by
   *  show/clear. RENDERER VIEW-STATE. */
  sessionNamePromptBusy: boolean
  /** The prompt's mapped refusal copy (never a thrown message), or null. Reset by show/clear. */
  sessionNamePromptError: string | null
  /**
   * Session templates — whether the templates picker dialog is open (RENDERER VIEW-STATE).
   * [state.md: modal open/closed = renderer view-state]
   */
  templatesDialogOpen: boolean
  /**
   * Phrase shortcuts — whether the Manage-shortcuts dialog is open (RENDERER VIEW-STATE).
   * [state.md: modal open/closed = renderer view-state]
   */
  shortcutsDialogOpen: boolean
  /**
   * Workspaces — whether the Manage-workspaces dialog is open (RENDERER VIEW-STATE).
   * [state.md: modal open/closed = renderer view-state]
   */
  workspacesDialogOpen: boolean
  /**
   * Tags — whether the Manage-tags dialog is open (RENDERER VIEW-STATE).
   * [state.md: modal open/closed = renderer view-state]
   */
  tagsDialogOpen: boolean
  /**
   * Rules — whether the Manage-rules dialog is open (RENDERER VIEW-STATE).
   * [state.md: modal open/closed = renderer view-state]
   */
  rulesDialogOpen: boolean
  /**
   * Settings — whether the Settings dialog is open (RENDERER VIEW-STATE). Opened from the header ☰
   * menu, so it joins the single-modal rule like every other dialog.
   * [state.md: modal open/closed = renderer view-state]
   */
  settingsDialogOpen: boolean
  /**
   * Past sessions (D-6) — whether the Past-sessions dialog is open (RENDERER VIEW-STATE). Opened
   * from the header ☰ menu's last row; joins the single-modal rule like every other dialog.
   * [state.md: modal open/closed = renderer view-state]
   */
  pastSessionsDialogOpen: boolean
  /**
   * The filter bar's search box — the text VERBATIM, as typed (RENDERER VIEW-STATE, never
   * persisted). `useBoardFilter` hands it to the board and rail selectors, which match it against
   * the card NAME only. It survives a workspace switch: the box shows it, so nothing is hidden
   * by a filter the operator cannot see.
   */
  searchQuery: string
  /** Reduce ONE validated, epoch-framed delta. Discards stale-epoch deltas. */
  applyWatchEvent: (payload: WatchEventsPayload) => void
  /** Consume main's `CH.watchStatus` push — the Story-5.3 COLD-LOAD-COMPLETE signal the
   *  Story-6.4 native engine emits at start (`{ reconnecting: false }`, twice as belt-and-
   *  suspenders): any push flips `coldLoaded` so the skeleton clears even when no delta
   *  ever arrives. Idempotent (a repeat push on a cold-loaded store is a no-op — the
   *  two-shot emit can never flap the UI). The `reconnecting` flag itself is vestigial —
   *  the native engine has no watch child to lose and only ever sends `false`. */
  setReconnecting: (reconnecting: boolean) => void
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
   *  as window operations, which this is NOT.)
   *  Story 5.6 (AC-1): also records the `launchedTerminals` entry with `label` (cwd basename)
   *  and `launchedAt` stamped from the store-factory closure `now`.
   *  Workspaces: also stamps the entry's `workspaceId` (from `SessionLaunchResult.workspaceId`)
   *  so a kept-alive frame can be hidden/shown by workspace before any session delta arrives. */
  openLaunchedTerminal: (terminalId: string, label: string, workspaceId: string) => void
  /**
   * Programmatic API — record a launched terminal in the registry WITHOUT touching the view.
   *
   * WHY IT EXISTS: an API create (`POST /v1/sessions`) is not the operator's own click. It arrives
   * while they are typing in another terminal, and `openLaunchedTerminal` would yank the view to
   * the new one — worse still into a template's OWN workspace, leaving the focused terminal outside
   * the active one. So the API path registers only: `viewMode`, `focusedTerminalId` and the active
   * workspace are all left EXACTLY as they were, and the operator opens the new card when they
   * choose to.
   *
   * The terminal still MOUNTS and still spawns its pty: every registry key is folded into
   * `selectKeptAliveTerminalIds`, and `App.tsx` mounts the focused layer (hidden, via
   * `hasFocusableTerminal`) whenever that list is non-empty — which runs `EmbeddedTerminal`'s
   * mount effect, and that is what opens the pty.
   *
   * Registers ONCE, keyed on terminalId, and NEVER restamps `launchedAt` (same rule as
   * `openLaunchedTerminal`, which is now this action plus the view flip, so the two cannot drift).
   */
  registerLaunchedTerminal: (terminalId: string, label: string, workspaceId: string) => void
  /** Story 5.6 (AC-5) — remove a launched terminal from the registry when its PTY exits
   *  naturally (the `window.terminal.onExit` push). Idempotent: a terminalId not in the
   *  registry (e.g. a plain #terminals shell) is a no-op. Also removes it from
   *  `selectKeptAliveTerminalIds` so it is no longer kept mounted. */
  forgetLaunchedTerminal: (terminalId: string) => void
  /**
   * Workspaces — reconcile the focused view with a newly-active workspace.
   *
   * Re-points the PIN (`focusedTerminalId`) at that workspace's most recently launched terminal,
   * or drops to the board when it has none. It does NOT change `viewMode` otherwise: the view is
   * the operator's, so a switch made from the board comes back to the board.
   *
   * It NEVER unmounts a terminal: every kept-alive frame stays in `launchedTerminals` and simply
   * renders inactive (`active={false}` → `visibility:hidden` on the whole frame — terminal.md).
   * Switching back is a pure show/hide with the PTY untouched.
   */
  focusWorkspace: (activeId: string) => void
  /** Story 3.2 (FR-11 / F6) — activate a card by its session `id` (the Board `onActivateCard`
   *  seam): SELECT it (the ONE selection, reconciled with the Story-2.2 `selectedId`), ACKNOWLEDGE
   *  it, and open ITS OWN terminal. A no-op if the card is not present.
   *
   *  The terminal it opens is resolved from `terminalIdBySessionId[id]` — the SAME binding the
   *  rail's `switchTerminal` uses, so a board click and a rail click land on the same terminal.
   *  Story 3.2 shipped this before that map existed and could only flip `viewMode`, which meant a
   *  card click re-showed whatever terminal was focused LAST (click card B, see card A's terminal).
   *
   *  No binding yet (pre-correlation) ⇒ select + acknowledge but STAY on the board: there is no
   *  terminal of this card's own to show, and showing another session's terminal under this card's
   *  name is worse than not navigating. In-app view-state only — NO window raise. */
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
   * Past sessions (D-5) — open the DELETE confirm for a specific session (the modal that was
   * Story 4.3's Stop confirm; the action keeps its name). Sets `stopConfirm = payload`. Pure,
   * small, no side effects. No IPC here — the explicit delete (`window.launch.deleteSession`,
   * via `sessionExit.deleteTerminal`) happens at the confirm's call site BEFORE view-state
   * changes (FROZEN F1; state.md: no IPC inside store actions).
   * Single-modal rule (UX-DR14): do NOT show when quitGuard is open.
   */
  showStopConfirm: (payload: StopConfirmPayload) => void
  /**
   * Past sessions (D-5) — close the Delete confirm (operator cancelled OR the delete was sent).
   * Sets `stopConfirm = null`. No teardown here — the explicit delete happens at the call site
   * BEFORE this (FROZEN F1).
   */
  clearStopConfirm: () => void
  /**
   * Session-naming — open the create-time name prompt for a just-picked directory.
   * Sets `sessionNamePrompt = payload` (not busy, no error). Pure, small, no side effects: the
   * launch IPC fires from `lib/namePromptFlow.ts` when the dialog submits, never from inside this action
   * (state.md: no IPC inside store actions).
   */
  showSessionNamePrompt: (payload: SessionNamePromptPayload) => void
  /**
   * Session-naming — close the name prompt (operator cancelled OR the launch was fired).
   * Sets `sessionNamePrompt = null` and resets busy/error. No teardown here: a launch still in
   * flight when the prompt closes follows the late-result path in `lib/namePromptFlow.ts`
   * (registry only, never the view).
   */
  clearSessionNamePrompt: () => void
  /** Mark the prompt's invoke in flight (true also clears the error line) or done. */
  setSessionNamePromptBusy: (busy: boolean) => void
  setSessionNamePromptError: (message: string | null) => void
  /**
   * Session templates — open the templates picker dialog. No-op if already open.
   */
  openTemplatesDialog: () => void
  /**
   * Session templates — close the templates picker dialog. No-op if already closed.
   */
  closeTemplatesDialog: () => void
  /**
   * Phrase shortcuts — open the Manage-shortcuts dialog. No-op if already open.
   */
  openShortcutsDialog: () => void
  /**
   * Phrase shortcuts — close the Manage-shortcuts dialog. No-op if already closed.
   */
  closeShortcutsDialog: () => void
  /**
   * Workspaces — open the Manage-workspaces dialog. No-op if already open.
   */
  openWorkspacesDialog: () => void
  /**
   * Workspaces — close the Manage-workspaces dialog. No-op if already closed.
   */
  closeWorkspacesDialog: () => void
  /** Tags — open the Manage-tags dialog. No-op if already open. */
  openTagsDialog: () => void
  /** Tags — close the Manage-tags dialog. No-op if already closed. */
  closeTagsDialog: () => void
  /** Rules — open the Manage-rules dialog. No-op if already open. */
  openRulesDialog: () => void
  /** Rules — close the Manage-rules dialog. No-op if already closed. */
  closeRulesDialog: () => void
  /** Settings — open the Settings dialog. No-op if already open. */
  openSettingsDialog: () => void
  /** Settings — close the Settings dialog. No-op if already closed. */
  closeSettingsDialog: () => void
  /** Past sessions — open the Past-sessions dialog. No-op if already open. */
  openPastSessionsDialog: () => void
  /** Past sessions — close the Past-sessions dialog. No-op if already closed. */
  closePastSessionsDialog: () => void
  /** The filter bar's search box — store the text as typed (the selectors trim it). */
  setSearchQuery: (query: string) => void
}

export interface BoardStoreOptions {
  /** Epoch-millis clock — inject for determinism; defaults to Date.now. */
  now?: () => number
}

/** A Zustand vanilla store instance (the store API over `BoardState`). */
export type BoardStore = StoreApi<BoardState>

/**
 * Workspaces — the workspace a launched terminal currently belongs to. DERIVED at the point of
 * use, never a stored copy (state.md: derived state is computed in narrow selectors, never
 * denormalized and kept in sync).
 *
 * `LaunchedTerminal.workspaceId` is stamped ONCE from `SessionLaunchResult` and is never written
 * again, but `CH.sessionSetWorkspace` (the card's move affordance) moves the SESSION. So the
 * stamp goes stale the moment a card is moved, and a stamp-based filter then hides the terminal
 * from the workspace its card is actually in while offering it in the one it left.
 *
 * The SESSION's own `workspaceId` is the truth — main ships it on every `session.updated` delta.
 * The stamp is the fallback for its ONE stated purpose: the pre-correlation window, before any
 * delta for this terminal has arrived (no binding yet, or a binding whose card is not on the
 * board yet).
 */
function terminalWorkspaceId(state: BoardState, entry: LaunchedTerminal): string {
  for (const [sessionId, terminalId] of Object.entries(state.terminalIdBySessionId)) {
    if (terminalId !== entry.terminalId) continue
    const session = state.sessionsById[sessionId]
    if (session !== undefined) return session.workspaceId
  }
  return entry.workspaceId
}

/**
 * Build a fresh board store. Exported as a FACTORY so tests inject `now()` and get an
 * isolated instance; the app uses the singleton `boardStore` / `useBoard` below.
 */
export function createBoardStore(options: BoardStoreOptions = {}): BoardStore {
  const now = options.now ?? Date.now

  return createStore<BoardState>((set, get) => ({
    sessionsById: {},
    epoch: 0,
    coldLoaded: false,
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
    // Past sessions (D-5) — no Delete confirm shown until the operator triggers it.
    stopConfirm: null,
    // Session-naming — no name prompt shown until the directory picker returns a path.
    sessionNamePrompt: null,
    sessionNamePromptBusy: false,
    sessionNamePromptError: null,
    // Session templates — the templates picker dialog starts closed.
    templatesDialogOpen: false,
    // Phrase shortcuts — the Manage-shortcuts dialog starts closed.
    shortcutsDialogOpen: false,
    // Workspaces — the Manage-workspaces dialog starts closed.
    workspacesDialogOpen: false,
    // Tags — the Manage-tags dialog starts closed.
    tagsDialogOpen: false,
    // Rules — the Manage-rules dialog starts closed.
    rulesDialogOpen: false,
    // Settings — the Settings dialog starts closed.
    settingsDialogOpen: false,
    // Past sessions — the Past-sessions dialog starts closed.
    pastSessionsDialogOpen: false,
    // The filter bar's search box starts empty: nothing hidden.
    searchQuery: '',
    // Story 5.6 (AC-1) — no launched terminals recorded until the first launch returns a terminalId.
    launchedTerminals: {},

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
          workspaceId: event.workspaceId,
          tagIds: event.tagIds,
          ...(event.pendingToolName !== undefined
            ? { pendingToolName: event.pendingToolName }
            : {}),
          ...(event.nameSyncPending === true ? { nameSyncPending: true } : {})
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
          ...(ackCleared ? { acknowledgedById: omitKey(state.acknowledgedById, event.id) } : {})
          // No hero re-evaluation: the hero is PINNED (HERO_COLUMN) — a count change can
          // never move the center slot.
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
            : {})
          // No hero re-evaluation: the hero is PINNED (HERO_COLUMN) — emptying Needs-you
          // leaves the center where it is, now showing an empty column.
        })
        return
      }

      // attention.raised — the board IGNORES it (Epic 2 / Epic 3 consume it). It still
      // advances the epoch (it is a real, validated delta on the stream). It does NOT
      // change column membership, so the hero pending-state is untouched.
      set({ epoch: payload.epoch, coldLoaded: true })
    },

    setReconnecting: () => {
      // Story 5.3 — COLD-LOAD-COMPLETE: receiving ANY `watch:status` push means the
      // main-side session engine has started (Story 6.4 emits `{ reconnecting: false }`
      // at engine start, twice as belt-and-suspenders) → cold-load is done, the skeleton
      // clears even when no delta ever arrives (the normal empty cold start). Idempotent:
      // a repeat push on a cold-loaded store changes nothing, so the two-shot emit can
      // never flap the UI. The pushed `reconnecting` flag is vestigial (the native engine
      // only ever sends false — the reconnect banner died with the c9watch feed).
      if (!get().coldLoaded) set({ coldLoaded: true })
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

    registerLaunchedTerminal: (terminalId, label, workspaceId) => {
      // Story 5.6 (AC-1): record the registry entry with label + launchedAt stamped from closure
      // now(). Workspaces: also stamp workspaceId (from SessionLaunchResult) on the entry.
      // Register the launch ONCE, keyed on terminalId — never restamp launchedAt on a re-open
      // (the label is the stable cwd basename; a re-open must not re-sort the Starting list).
      //
      // Registry ONLY: this action touches NEITHER `viewMode` NOR `focusedTerminalId` NOR the
      // active workspace, which is what lets an API launch mount its terminal (via
      // selectKeptAliveTerminalIds → App's hidden focused layer → EmbeddedTerminal's mount effect,
      // which spawns the pty) without stealing the view the operator is working in.
      const state = get()
      if (state.launchedTerminals[terminalId] !== undefined) return
      const entry: LaunchedTerminal = { terminalId, launchedAt: now(), label, workspaceId }
      set({ launchedTerminals: { ...state.launchedTerminals, [terminalId]: entry } })
    },

    openLaunchedTerminal: (terminalId, label, workspaceId) => {
      // REGISTER, then FOCUS — one path, so the API's register-only launch and the operator's own
      // launch can never drift in what they record.
      //
      // Optimistic drop-into-Focused-session the moment the launch returns its terminalId (UX-DR19).
      // The terminal renders + is typeable immediately; the session `id` (selectedId) reconciles
      // later. Single-window in-app VIEW-STATE only — no routing, no window raise.
      get().registerLaunchedTerminal(terminalId, label, workspaceId)
      set({ viewMode: 'focused', focusedTerminalId: terminalId })
    },

    forgetLaunchedTerminal: (terminalId) => {
      // Story 5.6 (AC-5) — remove the launched terminal registry entry on natural PTY exit.
      // Idempotent: a terminalId not in the registry is a no-op (e.g. a plain #terminals shell).
      const state = get()
      if (state.launchedTerminals[terminalId] === undefined) return
      const next = { ...state.launchedTerminals }
      delete next[terminalId]
      set({ launchedTerminals: next })
    },

    focusWorkspace: (activeId) => {
      // Workspaces: resolve each terminal's workspace through `terminalWorkspaceId` (the SESSION's
      // value when the terminal is bound, the launch stamp only before that) — the stamp alone
      // goes stale as soon as a card is moved. PURE show/hide: this only moves focus; every
      // registry key stays in `selectKeptAliveTerminalIds`, so nothing is ever unmounted.
      const state = get()
      const next = Object.values(state.launchedTerminals)
        .filter((t) => terminalWorkspaceId(state, t) === activeId)
        .sort((a, b) => b.launchedAt - a.launchedAt)[0]
      if (next === undefined) {
        set({ viewMode: 'board', focusedTerminalId: null })
        return
      }
      // Re-point the PIN, never the VIEW. Switching workspace changes WHAT you are looking at,
      // not WHERE you are looking — from w1's board, via an empty w2, back to w1 must land on
      // w1's board with its card, not inside w1's terminal. `viewMode` is the operator's (Esc
      // and a card click own it); this action only keeps `focusedTerminalId` inside the active
      // workspace, which selectRailActiveSessionId and EmbeddedTerminal's shortcut scope both
      // assume. The board fallback above is the one exception: with no terminal to show there
      // is no focused view to stay in.
      set({ focusedTerminalId: next.terminalId })
    },

    activateCard: (id) => {
      // Activate a present card (the Board onActivateCard seam): SELECT it (ONE selection,
      // reconciled with the Story-2.2 selectedId). A no-op for an absent card.
      //
      // WHICH terminal it opens is the whole point, and it was missing. This action originally
      // shipped in Story 3.2, BEFORE the sessionId→terminalId reverse map existed, so it could
      // only flip `viewMode` and left `focusedTerminalId` on whatever was focused last. Story 3.4
      // built that map (`terminalIdBySessionId`, from the CH.launchCorrelated push) and wired it
      // into the RAIL only — the board card click was never updated. Result: open card A, Esc to
      // the board, click card B → B is selected, the view flips to Focused, and A's terminal is
      // still on screen. So resolve the binding HERE and switch to it, exactly like the rail's
      // switchTerminal does.
      const state = get()
      if (state.sessionsById[id] === undefined) return
      const terminalId = state.terminalIdBySessionId[id]
      // Story 3.4 (AC-4 / UX-DR28) — opening a session ACKNOWLEDGES it (clears its in-app emphasis).
      // The known sessionId stamps the ONE ack state (rail + card read the same selectRailEmphasis).
      set({
        selectedId: id,
        acknowledgedById: { ...state.acknowledgedById, [id]: now() },
        // No binding yet (the correlation push has not landed) ⇒ STAY on the board. There is no
        // terminal of this card's own to show, and entering Focused would put a DIFFERENT
        // session's terminal on screen under this card's name — the same defect, one card later.
        ...(terminalId !== undefined
          ? { viewMode: 'focused' as const, focusedTerminalId: terminalId }
          : {})
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
      // Past sessions (D-5) — open the Delete confirm. Pure, small, no side effects.
      // The explicit delete (window.launch.deleteSession) MUST happen at the component call site
      // BEFORE clearing view-state (FROZEN F1; the confirm's Delete button handles this ordering
      // through sessionExit.deleteTerminal).
      // [state.md: modal open/closed = view-state; no IPC inside store actions]
      set({ stopConfirm: payload })
    },

    clearStopConfirm: () => {
      // Past sessions (D-5) — close the Delete confirm (cancelled or the delete was sent).
      // No PTY teardown here — the explicit window.launch.deleteSession runs BEFORE this at the
      // call site (FROZEN F1).
      const state = get()
      if (state.stopConfirm !== null) set({ stopConfirm: null })
    },

    showSessionNamePrompt: (payload) => {
      // Session-naming — open the create-time name prompt. Pure: no launch IPC here (the name
      // prompt flow, lib/namePromptFlow.ts, fires it on submit). A fresh prompt is never busy.
      set({
        sessionNamePrompt: payload,
        sessionNamePromptBusy: false,
        sessionNamePromptError: null
      })
    },

    clearSessionNamePrompt: () => {
      // Session-naming — close the name prompt. An in-flight launch it leaves behind follows the
      // late-result path (lib/namePromptFlow.ts): registry only, never the view.
      const state = get()
      if (state.sessionNamePrompt !== null) {
        set({ sessionNamePrompt: null, sessionNamePromptBusy: false, sessionNamePromptError: null })
      }
    },

    setSessionNamePromptBusy: (busy) => {
      set(
        busy
          ? { sessionNamePromptBusy: true, sessionNamePromptError: null }
          : { sessionNamePromptBusy: false }
      )
    },

    setSessionNamePromptError: (message) => {
      if (get().sessionNamePromptError !== message) set({ sessionNamePromptError: message })
    },

    openTemplatesDialog: () => {
      if (!get().templatesDialogOpen) set({ templatesDialogOpen: true })
    },
    closeTemplatesDialog: () => {
      if (get().templatesDialogOpen) set({ templatesDialogOpen: false })
    },

    openShortcutsDialog: () => {
      if (!get().shortcutsDialogOpen) set({ shortcutsDialogOpen: true })
    },
    closeShortcutsDialog: () => {
      if (get().shortcutsDialogOpen) set({ shortcutsDialogOpen: false })
    },

    openWorkspacesDialog: () => {
      if (!get().workspacesDialogOpen) set({ workspacesDialogOpen: true })
    },
    closeWorkspacesDialog: () => {
      if (get().workspacesDialogOpen) set({ workspacesDialogOpen: false })
    },

    openTagsDialog: () => {
      if (!get().tagsDialogOpen) set({ tagsDialogOpen: true })
    },
    closeTagsDialog: () => {
      if (get().tagsDialogOpen) set({ tagsDialogOpen: false })
    },

    openRulesDialog: () => {
      if (!get().rulesDialogOpen) set({ rulesDialogOpen: true })
    },
    closeRulesDialog: () => {
      if (get().rulesDialogOpen) set({ rulesDialogOpen: false })
    },

    openSettingsDialog: () => {
      if (!get().settingsDialogOpen) set({ settingsDialogOpen: true })
    },
    closeSettingsDialog: () => {
      if (get().settingsDialogOpen) set({ settingsDialogOpen: false })
    },

    openPastSessionsDialog: () => {
      if (!get().pastSessionsDialogOpen) set({ pastSessionsDialogOpen: true })
    },
    closePastSessionsDialog: () => {
      if (get().pastSessionsDialogOpen) set({ pastSessionsDialogOpen: false })
    },
    setSearchQuery: (query) => {
      if (get().searchQuery !== query) set({ searchQuery: query })
    }
  }))
}

// ---------------------------------------------------------------------------
// Selectors (NARROW, derive-don't-persist — state.md). Pure functions over the
// state; column grouping + sort are COMPUTED here, never stored. Components
// subscribe to the smallest slice they need; an object/array selector REQUIRES
// `useShallow` (architecture rule) — see the bound hooks below.
// ---------------------------------------------------------------------------

/** What the filter bar narrows the board and the rail by. REQUIRED by every board/rail selector,
 *  like `workspaceId`, so a caller can never forget it; `NO_FILTER` is the explicit "everything".
 *  Alerts never read these selectors, so no filter can ever mute one (spec §4.1).
 *  - `tagId`: the tag filter (`effectiveTagFilter`) — `null` means All tags.
 *  - `query`: the search box, as typed — matched against the card NAME only, case-insensitively;
 *    blank hides nothing. (Folder and the rest are future filter TYPES, not search.) */
export interface BoardFilter {
  tagId: string | null
  query: string
}

export const NO_FILTER: BoardFilter = { tagId: null, query: '' }

/** Does this card pass the filter bar? */
function passesFilter(session: BoardSession, filter: BoardFilter): boolean {
  if (filter.tagId !== null && !session.tagIds.includes(filter.tagId)) return false
  const query = filter.query.trim().toLowerCase()
  return query === '' || session.sessionName.toLowerCase().includes(query)
}

/** All sessions in a column, SORTED by entered-column time (working desc;
 *  needs-you/idle asc — `sortByEnteredColumn`). Derived; never persisted.
 *  Workspaces (Task 9a): `workspaceId` is REQUIRED (not defaulted) so a caller can never
 *  forget to scope it — the board must show only the active workspace's cards.
 *  `filter` is REQUIRED like `workspaceId` (see `BoardFilter`). */
export function selectColumn(
  state: BoardState,
  column: Column,
  workspaceId: string,
  filter: BoardFilter
): BoardSession[] {
  const inColumn = Object.values(state.sessionsById).filter(
    (s) => s.column === column && s.workspaceId === workspaceId && passesFilter(s, filter)
  )
  return sortByEnteredColumn(inColumn, (s) => s.enteredColumnAt, column)
}

/** Live count for a column (a primitive — safe without useShallow). Workspaces (Task 9a):
 *  `workspaceId` REQUIRED — the column header counts only the active workspace's cards.
 *  `filter` is REQUIRED like `workspaceId` (see `BoardFilter`). */
export function selectColumnCount(
  state: BoardState,
  column: Column,
  workspaceId: string,
  filter: BoardFilter
): number {
  let n = 0
  for (const id in state.sessionsById) {
    const s = state.sessionsById[id]
    if (s?.column === column && s.workspaceId === workspaceId && passesFilter(s, filter)) n++
  }
  return n
}

/** Total session count (a primitive — used for the empty-board state). Workspaces (Task 9a):
 *  `workspaceId` REQUIRED — "is the board empty" is asked per-workspace, not globally (a
 *  hidden workspace with sessions must not suppress the active workspace's empty state, and
 *  vice versa).
 *  `filter` is REQUIRED like `workspaceId` (see `BoardFilter`). */
export function selectTotalCount(
  state: BoardState,
  workspaceId: string,
  filter: BoardFilter
): number {
  let n = 0
  for (const s of Object.values(state.sessionsById)) {
    if (s.workspaceId === workspaceId && passesFilter(s, filter)) n++
  }
  return n
}

/** Cold-load flag (primitive). */
export const selectColdLoaded = (state: BoardState): boolean => state.coldLoaded

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
 * Past sessions (D-5) — the Delete-confirm payload (RENDERER VIEW-STATE; null = no confirm shown).
 * Non-null when the operator pressed Delete on a card or in the focused bar.
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectStopConfirm = (state: BoardState): StopConfirmPayload | null => state.stopConfirm

/**
 * Session-naming — the create-time name-prompt payload (RENDERER VIEW-STATE; null = no prompt).
 * Non-null between the picker returning a path and the operator submitting or cancelling.
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectSessionNamePrompt = (state: BoardState): SessionNamePromptPayload | null =>
  state.sessionNamePrompt
/** Action feedback — the name prompt's invoke is in flight (primitive). */
export const selectSessionNamePromptBusy = (state: BoardState): boolean =>
  state.sessionNamePromptBusy
/** Action feedback — the name prompt's mapped refusal copy, or null (primitive). */
export const selectSessionNamePromptError = (state: BoardState): string | null =>
  state.sessionNamePromptError

/**
 * Session templates — whether the templates picker dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectTemplatesDialogOpen = (state: BoardState): boolean => state.templatesDialogOpen

/**
 * Phrase shortcuts — whether the Manage-shortcuts dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectShortcutsDialogOpen = (state: BoardState): boolean => state.shortcutsDialogOpen

/**
 * Workspaces — whether the Manage-workspaces dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectWorkspacesDialogOpen = (state: BoardState): boolean => state.workspacesDialogOpen

/**
 * Tags — whether the Manage-tags dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectTagsDialogOpen = (state: BoardState): boolean => state.tagsDialogOpen

/**
 * Settings — whether the Settings dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectSettingsDialogOpen = (state: BoardState): boolean => state.settingsDialogOpen

/** The filter bar's search text, as typed (a primitive). */
export const selectSearchQuery = (state: BoardState): string => state.searchQuery

/**
 * Rules — whether the Manage-rules dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectRulesDialogOpen = (state: BoardState): boolean => state.rulesDialogOpen

/**
 * Past sessions — whether the Past-sessions dialog is open (RENDERER VIEW-STATE).
 * [state.md: modal open/closed = renderer view-state]
 */
export const selectPastSessionsDialogOpen = (state: BoardState): boolean =>
  state.pastSessionsDialogOpen

/**
 * Workspaces — needs-you counts keyed by workspace, INCLUDING workspaces that are not active.
 * This is the switcher badge and it is the whole reason the renderer keeps every session: main
 * ships every delta, so a hidden workspace's count is free here and needs no second IPC channel.
 * Derived, never stored (state.md forbids a denormalized copy).
 */
export const selectNeedsYouCountByWorkspace = (state: BoardState): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const session of Object.values(state.sessionsById)) {
    if (session.column !== 'needs-you') continue
    counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1
  }
  return counts
}

/**
 * Workspaces — working counts keyed by workspace, INCLUDING workspaces that are not active. The
 * switcher's blue pill; like the needs-you selector above, a subset of the card count below.
 * Derived, never stored (state.md forbids a denormalized copy).
 */
export const selectWorkingCountByWorkspace = (state: BoardState): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const session of Object.values(state.sessionsById)) {
    if (session.column !== 'working') continue
    counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1
  }
  return counts
}

/**
 * Workspaces — card counts keyed by workspace, every column, INCLUDING workspaces that are not
 * active. The switcher's per-workspace total; the needs-you selector above is its subset.
 * Derived, never stored (state.md forbids a denormalized copy).
 */
export const selectCardCountByWorkspace = (state: BoardState): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const session of Object.values(state.sessionsById)) {
    counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1
  }
  return counts
}

/** Story 3.4 (FR-16 / Task 4.3) — the set of app-launched terminal ids to keep ALIVE in the
 *  focused view (so a rail switch is a pure show/hide, never a recreate — terminal.md). It is the
 *  correlated bindings (`terminalIdBySessionId` values) UNION the current `focusedTerminalId` (the
 *  optimistic just-launched terminal whose binding may not have landed yet) UNION every
 *  `launchedTerminals` key (Story 5.6 AC-2: a registry entry keeps its PTY mounted even after
 *  focus moves away or a second launch arrives before correlation — the load-bearing term that
 *  closes the silent-kill). Returns a STABLE, SORTED, de-duplicated string[] so an equal set
 *  under `useShallow` does not re-render / remount the terminals. Derived; not stored. */
export function selectKeptAliveTerminalIds(state: BoardState): string[] {
  const ids = new Set<string>(Object.values(state.terminalIdBySessionId))
  if (state.focusedTerminalId !== null) ids.add(state.focusedTerminalId)
  // Story 5.6 (AC-2): fold every registry key so a launched terminal is NEVER unmounted/killed
  // by focus moving away (e.g. a second launch) before it correlates. DO NOT remove this term.
  for (const terminalId of Object.keys(state.launchedTerminals)) {
    ids.add(terminalId)
  }
  return [...ids].sort()
}

/**
 * Story 5.6 (AC-3) — the launched terminals that are NOT YET represented by a c9watch board card
 * ("starting" — live PTY, no card yet). STABLE, SORTED (by launchedAt then terminalId).
 *
 * Membership predicate: a `launchedTerminals` entry is "starting" iff no `sessionsById` card
 * exists whose corresponding `terminalIdBySessionId` binding maps to this terminalId.
 * Once `addCorrelation` lands AND the card is present in `sessionsById`, the entry drops
 * from this result → supersede is automatic, no double-card (AC-4).
 *
 * Supersede window: between `launch:correlated` landing and the next card-carrying delta
 * shipping from main, the predicate keeps the strip entry up (~one delta) — correct, avoids
 * a flicker gap (the card isn't present yet, so this guards the "no card" case correctly).
 *
 * REQUIRES `useShallow` at the call site (returns an array). Derived; not stored.
 *
 * Workspaces (Task 9a): `workspaceId` REQUIRED — a launched-but-uncorrelated terminal from a
 * hidden workspace must not show up in the active workspace's Starting strip/banner.
 */
export function selectStartingTerminals(
  state: BoardState,
  workspaceId: string
): LaunchedTerminal[] {
  // Build a set of terminalIds that already have a card in sessionsById via the correlation map.
  const correlatedTerminalIds = new Set<string>()
  for (const [sessionId, terminalId] of Object.entries(state.terminalIdBySessionId)) {
    if (state.sessionsById[sessionId] !== undefined) {
      correlatedTerminalIds.add(terminalId)
    }
  }
  // Workspaces: the workspace is DERIVED (`terminalWorkspaceId`), not read off the launch stamp.
  // For THIS selector the two agree by construction — an entry whose session is on the board is
  // already excluded by `correlatedTerminalIds`, which is the same condition under which the
  // helper prefers the session's value — so this is consistency insurance, not a behavior change:
  // it keeps the filter correct if the exclusion predicate above ever narrows.
  return Object.values(state.launchedTerminals)
    .filter(
      (lt) =>
        terminalWorkspaceId(state, lt) === workspaceId && !correlatedTerminalIds.has(lt.terminalId)
    )
    .sort((a, b) => {
      if (a.launchedAt !== b.launchedAt) return a.launchedAt - b.launchedAt
      return a.terminalId < b.terminalId ? -1 : a.terminalId > b.terminalId ? 1 : 0
    })
}

/** Story 3.4 (FR-16 / AC-1) — the SORTED session-id list the attention rail renders. SAME source
 *  as the board (`sessionsById` = the post-3.3 launched-set-filtered feed main ships). STABLE sort:
 *  needs-you sessions FIRST (they want you), then by `enteredColumnAt` ascending (oldest-waiting
 *  first), calm rows below in the same entered-time order. Returns ONLY the ids (a string[]) so the
 *  rail subscribes to a small, stable projection (per-row emphasis is a separate narrow selector,
 *  so an emphasis flip does not re-sort/re-render the whole rail — Task 3.6). Derived; not stored. */
// Workspaces (Task 9a): `workspaceId` REQUIRED — the rail lists only the active workspace's
// sessions (a hidden workspace's session must not appear, or be announced, in this rail).
export function selectRailOrder(state: BoardState, workspaceId: string): string[] {
  return Object.values(state.sessionsById)
    .filter((s) => s.workspaceId === workspaceId)
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
 *  unrelated change does not re-render the column).
 *
 *  Workspaces (Task 9a): this bound hook reads the active workspace ITSELF (via
 *  `useWorkspaces(selectActiveWorkspaceId)`) and passes it down to the pure `selectColumn` —
 *  the one place `Column.tsx` couples to the workspace, so the component and its callers stay
 *  workspace-agnostic. */
export function useColumnSessions(column: Column): BoardSession[] {
  const activeWorkspaceId = useWorkspaces(selectActiveWorkspaceId)
  const filter = useBoardFilter(activeWorkspaceId)
  return useStore(
    boardStore,
    useShallow((state: BoardState) => selectColumn(state, column, activeWorkspaceId, filter))
  )
}

/** The filter bar's current filter for `workspaceId`: the tag it can see (`effectiveTagFilter`,
 *  null when it cannot see the chosen one) plus the search text. The ONE place the board, the
 *  columns and the rail read it, so they can never disagree about what is hidden. */
export function useBoardFilter(workspaceId: string): BoardFilter {
  const tagId = useTags((s) => effectiveTagFilter(s, workspaceId))
  const query = useBoard(selectSearchQuery)
  return { tagId, query }
}

// ---------------------------------------------------------------------------
// Rail SECTIONS — the pinned-active row + one group per column.
//
// The rail used to be ONE flat list sorted needs-you-first. That put the session the operator is
// literally looking at somewhere in the middle whenever another session went needs-you, so "which
// terminal am I in" moved under them while they were typing in it. The list is now:
//
//     <pinned active row>          ← no divider above it; it needs no label to explain itself
//     ──── Needs you ────
//     ──── Working ────
//     ──── Idle ────
//     ──── Starting ────           (selectStartingTerminals, unchanged)
//
// The pinned row is REMOVED from its own section (`selectRailSection` filters it out) — a nav list
// that shows the same session twice makes the operator check whether they are two sessions.
//
// WHY TWO SELECTORS AND NOT ONE SHAPE: `useShallow` compares one level deep, so a selector
// returning nested arrays/objects would allocate fresh identities on every store change and
// re-render the whole rail — the exact churn state.md's narrow-selector rule exists to prevent.
// A `string | null` (the pinned id) and a `string[]` per section both compare correctly.
// ---------------------------------------------------------------------------

/** The PINNED session: the one whose terminal is currently focused. `null` when no terminal is
 *  focused, or when the focused terminal has no correlated card yet (a just-launched terminal
 *  still in the Starting group — the pin stays empty rather than guessing). A primitive — safe
 *  without `useShallow`. */
export function selectRailActiveSessionId(state: BoardState): string | null {
  const focused = state.focusedTerminalId
  if (focused === null) return null
  for (const [sessionId, terminalId] of Object.entries(state.terminalIdBySessionId)) {
    if (terminalId === focused && state.sessionsById[sessionId] !== undefined) return sessionId
  }
  return null
}

/** One rail section's session ids: everything in `column` EXCEPT the pinned active session,
 *  oldest-entered first (the same ascending order the flat rail used, so the longest-waiting
 *  session stays at the top of its group), id as the final deterministic tiebreak.
 *
 *  NOTE this deliberately does NOT use `sortByEnteredColumn` (which the BOARD columns use, and
 *  which sorts `working` DESCENDING). The rail is a "who has been waiting longest" list in every
 *  group; flipping one group's direction would make the same three sessions read in two different
 *  orders depending on which surface you look at.
 *
 *  Returns an array → REQUIRES `useShallow` at the call site. Derived; never persisted.
 *
 *  Workspaces (Task 9a): `workspaceId` REQUIRED — a section groups only the active workspace's
 *  sessions (a hidden workspace's needs-you session must not leak into this rail's groups).
 *  `filter` is REQUIRED like `workspaceId` (see `BoardFilter`). The PINNED row (P1-6) is
 *  untouched: it comes from `selectRailActiveSessionId`, which this selector only reads to EXCLUDE
 *  from the section, never to filter. */
export function selectRailSection(
  state: BoardState,
  column: Column,
  workspaceId: string,
  filter: BoardFilter
): string[] {
  const activeId = selectRailActiveSessionId(state)
  return Object.values(state.sessionsById)
    .filter(
      (s) =>
        s.column === column &&
        s.id !== activeId &&
        s.workspaceId === workspaceId &&
        passesFilter(s, filter)
    )
    .sort((a, b) => {
      if (a.enteredColumnAt !== b.enteredColumnAt) return a.enteredColumnAt - b.enteredColumnAt
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((s) => s.id)
}
