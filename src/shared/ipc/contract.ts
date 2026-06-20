// Story 0.2 — the single typed IPC contract for the main <-> renderer seam.
//
// This is the ONE source of truth for channel names AND their payload shapes.
// Main, preload, AND renderer import from here; no channel may appear as a
// string literal at a call site (enforced by the authored `no-literal-channels`
// ESLint rule). [Source: architecture.md#Layer 1; #Canonical Recipes; AC-1]
//
// Conventions (architecture.md#Naming Patterns / #Format Patterns):
//   - Channels are lowercase `domain:action` strings.
//   - Payload types are PascalCase, NO `I` prefix, camelCase fields.
//   - `invoke` returns the value directly — NO `{ data, error }` wrapper.
//   - Events are discriminated unions on a `type` field.

/**
 * The canonical channel registry. A single `as const` object so every channel
 * name lives in exactly one place and is referenced as `CH.xxx` everywhere.
 *
 * The first group are the channels the Story-0.1 smoke wires LIVE on disk — they
 * must be in the contract so AC-1 ("no channel is a string literal at a call
 * site") holds against the real codebase, not just future code.
 *
 * The second group are the architecture's named-but-not-yet-wired channels.
 * They document the seam and bind in later epics; defining them now keeps the
 * contract the single registry. [Source: architecture.md#Naming Patterns]
 */
export const CH = {
  // --- Live today (Story 0.1 PTY/smoke spike) ---
  ptyStart: 'pty:start',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  smokeConfig: 'smoke:config',
  smokeReport: 'smoke:report',

  // --- Named in the architecture, wired in later epics ---
  // Story 3.2 (FR-11) — `session:launch` is now WIRED (was reserved-but-unwired): the
  // renderer asks main to launch a raw `claude` under node-pty in a picked cwd. Returns the
  // opaque `terminalId` the renderer's EmbeddedTerminal opens against. `session:stop` stays
  // RESERVED (the Epic-4 FR-15 per-session stop — NOT this story). See SessionLaunchRequest /
  // SessionLaunchResult below.
  sessionLaunch: 'session:launch',
  // Story 4.3 (FR-15) — `session:stop` stays RESERVED (superseded-by-reuse).
  // The Story-4.3 per-session Stop action REUSES `terminal:stop` (`CH.terminalStop`) on the
  // focused `terminalId` via `window.terminal.stop(focusedTerminalId)` — the proven SM-3 path
  // (Story 3.1; `terminalManager.stop` = port.close() THEN pty.kill() + `launchService.forget`).
  // The renderer already holds `focusedTerminalId`; a session-level alias would only add a thin
  // session→terminal indirection that re-derives what the renderer already has — no gain, more
  // blast radius. Leave reserved; do NOT wire or add a handler for `session:stop`.
  sessionStop: 'session:stop',
  // Story 3.4 (FR-16) — the ADDITIVE `launch:correlated` push (main → renderer). Fired ONCE,
  // when the Story-3.2 Tgid correlation join LANDS in `correlateAgainst` (the /proc-only join
  // that binds an app-spawned `claude` to its c9watch session `id`). It carries the
  // `{ terminalId, sessionId }` binding the renderer cannot derive itself (the join is a
  // main-only /proc Tgid computation). The renderer builds a `terminalIdBySessionId` view-state
  // so the attention rail can switch the visible terminal BY session id — a pure renderer
  // show/hide of the kept-alive terminals (NO per-switch IPC). This is a SEPARATE channel, NOT a
  // new member of the FROZEN `AttentionEvent` union. See `LaunchCorrelatedEvent` below.
  launchCorrelated: 'launch:correlated',
  // Story 3.2 (FR-11) — the native KDE directory picker. An `invoke` that opens the OS
  // `dialog.showOpenDialog({ properties: ['openDirectory'] })` in MAIN and returns the chosen
  // path, or `null` on cancel. The dialog runs in MAIN (it is an OS dialog); the renderer
  // NEVER opens a dialog itself (UX-DR23). See SessionPickDirectoryResult below.
  sessionPickDirectory: 'session:pick-directory',
  watchSnapshot: 'watch:snapshot',
  watchEvents: 'watch:events',
  // Story 1.4 fix — the watch CONNECTION-state push (separate from the session
  // deltas on `watch:events`). Main surfaces the feed's real reconnect state here;
  // see `WatchStatus` below for why this is a dedicated channel, not a union member.
  watchStatus: 'watch:status',
  // Story 2.2 (FR-9) — the in-app jump-to-card push. Fired by main when the operator
  // ACTIVATES an attention notification (informational only — NO window self-raise,
  // AR-8 cut). Carries only the stable session `id`; the renderer selects that card if
  // it is present on the board, else no-ops. See `AttentionActivatePayload` below.
  attentionActivate: 'attention:activate',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  // --- Story 3.1 (FR-10) — the embedded-terminal lifecycle/control seam ---
  // The BYTE path does NOT ride these channels — it rides a transferred MessagePort
  // (MessageChannelMain). Only the lifecycle/control (open → port transfer, resize,
  // stop, exit/dead push) rides IPC. [Source: .claude/rules/ipc.md; architecture.md:553]
  //
  // `terminal:open`   renderer → main : ({ terminalId }) — main spawns ONE pty + a
  //                   MessageChannel, wires port1↔pty, and TRANSFERS port2 back to the
  //                   renderer on this same channel's reply (the port rides the event).
  // `terminal:resize` renderer → main : ({ terminalId, cols, rows }) — main resizes the
  //                   PTY FIRST (renderer computed cols/rows via fit()); terminal.md.
  // `terminal:stop`   renderer → main : ({ terminalId }) — destroy: port.close() THEN
  //                   pty.kill() (architecture.md:554).
  // `terminal:exit`   main → renderer : a dead-terminal push (the pty exited/died) → the
  //                   per-terminal "Terminal exited." pane (UX-DR18).
  terminalOpen: 'terminal:open',
  terminalResize: 'terminal:resize',
  terminalStop: 'terminal:stop',
  terminalExit: 'terminal:exit',

  // Story 3.5 (SM-2) — the telemetry acknowledge signal: renderer → main (ADDITIVE —
  // does NOT reshape the FROZEN `AttentionEvent` union). The renderer signals the
  // acknowledge moment: `{ sessionId, acknowledgedAt }`. MAIN computes the wait duration
  // (`acknowledgedAt − enteredColumnAt`) because MAIN owns the tracker's `enteredColumnAt`
  // (the Story-1.2 attention tracker). Recommended as an `invoke` (typed parse-and-throw
  // + back-pressure, consistent with `settings:set`) — returns void. [story 3.5 FROZEN-3;
  // .claude/rules/ipc.md 4-file recipe; src/shared/schemas/telemetry.ts (TelemetryAcknowledgeSchema)]
  telemetryAcknowledge: 'telemetry:acknowledge',

  // Story 4.2 (FR-14) — the Quit-guard round-trip (ADDITIVE; frozen AttentionEvent union
  // NOT reshaped; all new channels are CH.* consts — no-literal-channels enforced).
  //
  // ONE quit chokepoint: Ctrl+Q (renderer keydown → app:request-quit invoke → main app.quit()
  // → the one before-quit decision). Tray Quit already calls app.quit() (no change needed
  // there). A confirmed quit or a nothing-live quit flows through the same chokepoint.
  //
  // `app:request-quit`  renderer → main INVOKE (no payload). The Ctrl+Q chokepoint: the
  //                     renderer asks main to begin a true quit by calling app.quit(), which
  //                     flows through the ONE before-quit guard decision. NOT a direct quit
  //                     from the renderer (sandboxed). Returns void.
  //
  // `quit:guard-show`   main → renderer PUSH carrying QuitGuardPayload. Fired when main's
  //                     before-quit finds ≥1 live app-launched session and needs confirmation.
  //                     Validated AT SOURCE in main before wc.send. The frozen AttentionEvent
  //                     union is NOT reshaped — this is a separate channel.
  //
  // `quit:confirm`      renderer → main INVOKE (no payload). The operator chose "Quit anyway"
  //                     → main sets isQuitting, calls teardownAllSessions, then app.quit().
  //                     Returns void.
  //
  // `quit:cancel`       renderer → main INVOKE (no payload). The operator cancelled → main
  //                     clears the pending-quit state; no teardown; every PTY stays live.
  //                     The before-quit preventDefault() already aborted THIS quit. Returns void.
  //
  // [Source: story 4.2 Task 3.1; .claude/rules/ipc.md (4-file recipe, conventions, frozen union,
  //  no-literal-channels); FROZEN #1/#2/#3; ARCH-FORK-1 (option A)]
  appRequestQuit: 'app:request-quit',
  quitGuardShow: 'quit:guard-show',
  quitConfirm: 'quit:confirm',
  quitCancel: 'quit:cancel'
} as const

/** The union of every valid channel name. [Source: architecture.md#Canonical Recipes] */
export type Channel = (typeof CH)[keyof typeof CH]

/**
 * The three LIVE board columns (Story 1.4 — shared home).
 *
 * This union has ONE definition shared by main, preload, AND renderer so no
 * string-literal copy can drift. The classifier home stays
 * `src/main/c9watch/columns.ts` (`columnForStatus`); that module IMPORTS this
 * `Column` type from the contract (the contract is the only layer all three sides
 * may import — the renderer must never reach into `src/main`). There is NO `done`
 * column: an exited session VANISHES (`session.removed`), it never lands in one.
 * [Source: story 1.4 Task 1.1; src/main/c9watch/columns.ts; c9watch-0.8.1-contract.md §4]
 */
export type Column = 'working' | 'needs-you' | 'idle'

// ---------------------------------------------------------------------------
// Payload types (PascalCase, no `I` prefix, camelCase fields).
// `invoke` returns the value directly — no envelope wrapper. [Format Patterns]
// ---------------------------------------------------------------------------

/** `pty:resize` request — renderer-computed terminal dimensions. */
export type PtyResizeRequest = {
  cols: number
  rows: number
}

/** `pty:input` request — raw keystroke bytes from the terminal. */
export type PtyInputRequest = string

/** `pty:data` event — raw PTY output bytes streamed to the renderer. */
export type PtyDataEvent = string

/** `pty:exit` event — the PTY process exited. */
export type PtyExitEvent = {
  exitCode: number
}

/**
 * `smoke:config` invoke return — whether smoke mode is on, plus the main-process
 * ABI versions the packaged smoke records. (Story 0.1 AC-3 harness.)
 */
export type SmokeConfig = {
  enabled: boolean
  electron: string
  abi: string
  node: string
}

/**
 * `smoke:report` request — the renderer's smoke verdict. Kept structurally open
 * (the smoke harness assembles an ad-hoc checks object) but typed as a record so
 * the channel is contract-covered. (Story 0.1 AC-3 harness.)
 */
export type SmokeReport = Record<string, unknown>

// ---------------------------------------------------------------------------
// AttentionEvent — the FROZEN discriminated union (AC-1).
//
// "Frozen" = a stable, named contract type (NOT a runtime Object.freeze) that
// downstream epics may rely on without it shifting under them. Epic-2's
// attention engine is the consumer; we freeze the shape now, before any consumer
// exists, so the contract is stable.
//
// Discriminated on `type`, mirroring the architecture's event union shape
// (`session.updated | session.removed | attention.raised`). The attention model
// (PRD FR-5/FR-9): a Card transitions into Needs-you or into Done/Idle; the
// session is identified by its stable `id` (plus human-facing `sessionName` /
// `projectPath`); attention is alert-only.
// [Source: epics.md#Story 0.2 AC; #Epic 0 scope; architecture.md#Format Patterns]
// ---------------------------------------------------------------------------

/**
 * A session was updated (state/fields changed) — board should re-render it.
 *
 * Story 1.4 WIDENING (payload-type widening of THIS member only — the frozen
 * `AttentionEvent` union's three `type` members are NOT reshaped):
 *   - `column` + `enteredColumnAt` — the board's column placement + the UX-DR10
 *     sort key, COMPUTED in main by the Story-1.2 tracker (`tracker.columnOf(id)` /
 *     `tracker.enteredColumnAt(id)`) and VALIDATED AT SOURCE in `main/index.ts`
 *     before `wc.send` (.claude/rules/zod-boundaries.md: main→renderer = validate
 *     at source). These are the two fields AC-7 / FROZEN-2 enumerate.
 *   - `pid` + `pendingToolName?` — the remaining native c9watch fields AC-1
 *     requires every card to show VERBATIM (`sessionName`/`projectPath`/`status`
 *     were already on the wire; `pid`/`pendingToolName` were not). They ride this
 *     same updated member so the renderer's `BoardSession` projection is built
 *     PURELY from the validated delta — the renderer never re-parses c9watch JSON
 *     (AC-8 / parse-once). Read from the reducer's already-parsed `Session` in
 *     main; never re-validated in the renderer.
 * The frozen union is unchanged: this adds fields to a MEMBER, it does not add or
 * remove a `type` discriminant (same precedent as Story 1.2 adding `attention.raised`
 * as a third `event` value). [Source: story 1.4 Task 1 / AC-1 / AC-7 / FROZEN-2;
 * .claude/rules/ipc.md (frozen-union rule); .claude/rules/zod-boundaries.md]
 */
export type SessionUpdatedEvent = {
  type: 'session.updated'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
  /** New status string from c9watch (not enum-locked). */
  status: string
  /** Board column placement, computed by the Story-1.2 tracker. */
  column: Column
  /** Epoch-millis the session entered its current column (UX-DR10 sort key). */
  enteredColumnAt: number
  /** Process id — a native c9watch field shown verbatim on the card (AC-1).
   *  A wandering thread id; NEVER used as identity (key on `id`). */
  pid: number
  /** What the session is blocked on, when c9watch reports one (AC-1). */
  pendingToolName?: string
}

/**
 * Story 1.4 — the BARE `session.updated` the REDUCER produces, BEFORE main's
 * enrichment stage. The reducer (Story 1.1) reduces the c9watch feed into session
 * truth but does NOT know a session's `column`/`enteredColumnAt` (that is the
 * Story-1.2 tracker's job, downstream). So the reduce stage emits this bare member;
 * the ship stage (`enrichDelta` in `main/index.ts`) upgrades it to the enriched,
 * renderer-facing `SessionUpdatedEvent` and validates AT SOURCE before `wc.send`.
 *
 * "main parses + reduces, then ships VALIDATED deltas" (.claude/rules/state.md) — the
 * reduce stage (this bare type) and the ship stage (the enriched `SessionUpdatedEvent`)
 * are distinct; the renderer only ever sees the enriched wire type.
 */
export type ReducerSessionUpdatedEvent = {
  type: 'session.updated'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
  /** New status string from c9watch (not enum-locked). */
  status: string
}

/** A session disappeared (process gone / watch `stopped`) — remove its card. */
export type SessionRemovedEvent = {
  type: 'session.removed'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
}

/** A session crossed into a state that needs the human's attention (alert-only). */
export type AttentionRaisedEvent = {
  type: 'attention.raised'
  /** Stable session id (UUID). Never key on pid. */
  id: string
  sessionName: string
  projectPath: string
  /** The status that triggered the alert — a needs-you status (e.g. NeedsAttention
   *  / NeedsPermission). Note: WaitingForInput is IDLE (calm) and never raises. */
  status: string
  /** The pending tool awaiting the human, when c9watch reports one. */
  pendingToolName?: string
  /** Event time in epoch millis (coerced from the c9watch ISO-8601 timestamp). */
  timestamp: number
}

/**
 * The frozen attention/session event union. Consumers discriminate on `type`.
 * [Source: architecture.md#Format Patterns ("events = discriminated unions on a
 * `type` field"); epics.md#Epic 0 scope ("the frozen `AttentionEvent` type")]
 */
export type AttentionEvent = SessionUpdatedEvent | SessionRemovedEvent | AttentionRaisedEvent

/**
 * `watch:events` payload — a single session delta produced by the main-process
 * c9watch adapter, FRAMED with the snapshot's monotonic `epoch`.
 *
 * The `event` is one of the FROZEN `AttentionEvent` members. Story 1.1 emitted
 * `session.updated` / `session.removed` only; Story 1.2 ALSO rides
 * `attention.raised` on this same epoch-framed channel (the column-transition
 * tracker's entry-edge event) — so `event` is now the FULL `AttentionEvent` union.
 *
 * This is a payload-TYPE WIDENING, NOT a reshape of the frozen `AttentionEvent`
 * union itself (Epic 2 relies on that union's shape verbatim): `attention.raised`
 * simply becomes a third valid `event` value on the existing `watch:events` channel
 * — no new channel, no new union member. [Source: story 1.2 Task 4; AC-3]
 *
 * The epoch rides ALONGSIDE the event as the channel's transport frame, so the
 * renderer can DISCARD any delta whose epoch is older than the latest it has seen
 * (AC-2: "the renderer discards any delta older than the current epoch; idempotent
 * apply"). The epoch is monotonic — it only ever increases.
 * [Source: story 1.1 AC-2/AC-4, story 1.2 Task 4; architecture.md#Communication/State
 *  Patterns ("each snapshot carries a monotonic epoch … renderer discards stale");
 *  src/shared/ipc/contract.ts (frozen AttentionEvent); .claude/rules/ipc.md]
 */
export type WatchEventsPayload = {
  /** Monotonic snapshot epoch this delta belongs to (only ever increases). */
  epoch: number
  /** The frozen session/attention event (Story 1.1: updated/removed; Story 1.2 adds
   *  attention.raised — the full frozen AttentionEvent union, NOT reshaped). Story 1.4:
   *  `session.updated` is the ENRICHED member (column/enteredColumnAt/pid/pendingToolName). */
  event: AttentionEvent
}

/**
 * Story 1.4 — the BARE epoch-framed delta the REDUCER produces (and the tracker
 * consumes), BEFORE enrichment. Its `event` is the bare `session.updated`
 * (`ReducerSessionUpdatedEvent`) / `session.removed` / `attention.raised`. The ship
 * stage (`enrichDelta`) maps a bare `session.updated` to the enriched
 * `WatchEventsPayload` the renderer receives; removed/raised pass through unchanged.
 *
 * The tracker (`attention.ts`) only reads the `type` discriminant + `id`/`status` off
 * the event, so it consumes this bare payload directly — it never needs the enriched
 * fields. [Source: story 1.4 Task 1; .claude/rules/state.md (reduce → ship stages)]
 */
export type ReducerWatchEventsPayload = {
  /** Monotonic snapshot epoch this delta belongs to (only ever increases). */
  epoch: number
  /** The bare reducer/tracker event (pre-enrichment). */
  event: ReducerSessionUpdatedEvent | SessionRemovedEvent | AttentionRaisedEvent
}

/**
 * Story 1.4 FIX — `watch:status` push: the feed's REAL connection/liveness state.
 *
 * Why a DEDICATED channel (not a member of the frozen `AttentionEvent` union, and not
 * a field on `WatchEventsPayload`): connection state is NOT a session event. It carries
 * no `id`/epoch, is not stale-discardable, and has a different lifecycle (it fires on the
 * watch CHILD's exit/restart, independent of any session delta). Folding it into the
 * frozen union would reshape a contract Epic-2 relies on; folding it onto the epoch-framed
 * `WatchEventsPayload` would force a phantom event/epoch for a state that has neither.
 * `.claude/rules/ipc.md` ("prefer a small dedicated typed channel/event") → its own channel.
 *
 * This REPLACES the renderer's old line-silence inference of `reconnecting`: the verified
 * contract (`c9watch-0.8.1-contract.md` — `watch --changes-only` emits 0 lines on a quiet
 * machine) means silence is the NORMAL steady state, not a gap. Main already detects the
 * watch child's `exit` and runs a serialized auto-reconnect (Story 1.1, feed.ts); it emits
 * `reconnecting: true` while that reconnect is in flight and `reconnecting: false` once the
 * watch restarted + the `list` reconcile applied. Validated AT SOURCE before `wc.send`
 * (.claude/rules/zod-boundaries.md: main→renderer = validate at source).
 * [Source: story 1.4 code-review MED; AC-6 / UX-DR17 (banner = a real watch-stream GAP,
 *  NOT line silence); src/main/c9watch/feed.ts (reconnect lifecycle)]
 */
export type WatchStatus = {
  /** True while the watch child has died and a reconnect is in flight; false once the
   *  watch is restarted and the `list` reconcile has been applied. */
  reconnecting: boolean
}

/**
 * Story 2.2 (FR-9) — `attention:activate` push payload: main → renderer.
 *
 * Fired when the operator ACTIVATES an attention notification. It carries ONLY the
 * stable session `id` (the UUID, never `pid`) — the renderer locates-and-highlights
 * that card if it is still on the board, else no-ops. This is an in-app VIEW-STATE
 * signal (a `selectedId` in the board store), NOT a window raise/navigation/agent
 * input: the app NEVER summons or focuses its own window (AR-8 self-raise cut,
 * 2026-06-19). Validated AT SOURCE in main before send (renderer-facing delta;
 * .claude/rules/zod-boundaries.md). [Source: story 2.2 Task 1.1; AC-5/AC-8; FROZEN F3]
 */
export type AttentionActivatePayload = {
  /** The activated session's stable id (UUID). Never key on pid. */
  id: string
}

/**
 * Story 2.4 — settings IPC payload types for the ALREADY-RESERVED `CH.settingsGet` /
 * `CH.settingsSet` channels (no new channel name invented — the consts exist above).
 *
 * The SINGLE shape source is the schema-inferred `Settings` / `SettingsPatch` from
 * `src/shared/schemas/settings.ts` (one source of truth — never a hand-written copy).
 * This file re-exports them as the channels' payload TYPES so call sites import the
 * settings shape from the contract alongside the channel consts, consistent with the
 * rest of the seam.
 *
 *   - `settings:get`  invoke → returns `Settings` (the value DIRECTLY — NO {data,error}
 *     envelope, per the contract conventions above).
 *   - `settings:set`  invoke takes a `SettingsPatch` (partial) and returns the new
 *     validated `Settings`. The arg is parse-and-throw-typed at the main boundary
 *     (untrusted cross-process input — zod-boundaries.md IPC-arg row).
 *
 * MAIN owns the persisted authority (electron-store); the renderer reaches these ONLY via
 * the typed `window.settings.*` contextBridge wrapper, never electron-store directly (F4).
 * [Source: story 2.4 Task 3; AC-5/7; src/shared/schemas/settings.ts; .claude/rules/ipc.md]
 */
export type { Settings, SettingsPatch } from '../schemas/settings'

// ---------------------------------------------------------------------------
// Story 3.2 (FR-11) — the in-app LAUNCH seam payload types (native picker + raw
// `claude` launch). These are NEW, separate channels — the frozen `AttentionEvent`
// union + the watch/settings/terminal seams are NOT reshaped. The launch builds ON
// TOP of the Story-3.1 embedded terminal: the launch spawns the PTY in main and hands
// the renderer the SAME opaque `terminalId` its `EmbeddedTerminal` opens against (F1/F6).
// The picked directory path + the launch request are UNTRUSTED cross-process input →
// the main handler parse-and-throws (zod-boundaries.md IPC-arg row); never log the path.
// [Source: story 3.2 Task 1; UX-DR23 (native picker); AR-7 (raw launch); .claude/rules/ipc.md]
// ---------------------------------------------------------------------------

/**
 * `session:pick-directory` invoke return — the chosen working directory, or `null` on
 * cancel. The dialog runs in MAIN (an OS dialog); cancel ⇒ `null` ⇒ no-op (no launch, no
 * view change — UX-DR23). The path is a string the renderer hands straight back to
 * `session:launch`; it is re-validated (parse-and-throw) at the launch boundary, never
 * trusted as a launch arg just because the picker produced it.
 */
export type SessionPickDirectoryResult = string | null

/**
 * `session:launch` request — the picked working directory the raw `claude` launches in.
 * UNTRUSTED cross-process input → parse-and-throw at the main boundary (a blank/non-string
 * cwd FAILS CLOSED). NEVER log the `cwd` value (a directory path leaks the operator's
 * filesystem layout — log path/code only). [zod-boundaries.md IPC-arg row]
 */
export type SessionLaunchRequest = {
  /** The directory the native picker returned — where `claude` is spawned (AR-7 raw launch). */
  cwd: string
}

/**
 * `session:launch` invoke return — the opaque `terminalId` the renderer's `EmbeddedTerminal`
 * opens against (mirrors the Story-3.1 terminal keying — terminals key by `terminalId`, NEVER
 * the session `id`, NEVER a pid — F6). The terminal is typeable IMMEDIATELY (AC-3: never
 * blocked on the Tgid correlation join). The c9watch session `id` is NOT known yet at launch
 * (the join binds the app-spawned claude `Tgid` to the session `id` later, on a feed delta) —
 * so the launch reply carries only the `terminalId`, and the optimistic App-launched card is
 * derived from main's session truth once the join lands (UX-DR19).
 */
export type SessionLaunchResult = {
  /** The opaque per-terminal id (NOT a session id, NOT a pid — F6). */
  terminalId: string
}

/**
 * Story 3.4 (FR-16) — `launch:correlated` push payload: main → renderer.
 *
 * Emitted ONCE per launch, the moment the Story-3.2 Tgid correlation join LANDS in
 * `correlateAgainst` (right after `launch.correlatedId = result.id` / `launchedSet.add(result.id)`).
 * It surfaces the `terminalId ↔ sessionId` binding — born in main (the /proc Tgid join is a
 * main-only computation the renderer cannot run) — so the renderer can build a
 * `terminalIdBySessionId` view-state. The attention rail uses that map to switch the visible
 * terminal BY session id (a pure renderer show/hide of the kept-alive terminals; NO per-switch IPC).
 *
 * Both fields are already-trusted, safe-to-keep main values: `terminalId` is a main-minted opaque
 * id; `sessionId` is the parse-once c9watch session `id` (the stable UUID — NEVER a pid). It is
 * validated AT SOURCE in main before send (main→renderer delta; zod-boundaries.md). This is a NEW,
 * SEPARATE channel — the FROZEN `AttentionEvent` union is NOT reshaped. [Source: story 3.4 Task 1]
 */
export type LaunchCorrelatedEvent = {
  /** The opaque per-terminal id the launch minted (NOT a session id, NOT a pid — F6). */
  terminalId: string
  /** The c9watch session id the launch correlated to (the stable UUID; NEVER a pid). */
  sessionId: string
}

// ---------------------------------------------------------------------------
// Story 3.1 (FR-10) — the embedded-terminal lifecycle payload types.
//
// PascalCase types, camelCase fields. The renderer reaches the PTY ONLY through the
// typed preload bridge + the transferred MessagePort — never `ipcRenderer`/Node
// directly (F4). The frozen `AttentionEvent` union + the watch/settings seams are NOT
// reshaped — these are a NEW, separate set of channels. [Source: .claude/rules/ipc.md
//  4-file recipe; architecture.md:553-559]
// ---------------------------------------------------------------------------

/**
 * `terminal:open` request — the renderer asks main to spawn a PTY for `terminalId` and
 * transfer back the MessagePort the bytes will ride. `terminalId` is an OPAQUE
 * per-terminal id (NOT the session `id` — session↔terminal pairing is Story 3.2; F6).
 * The arg is parse-and-throw-typed at the main boundary (untrusted cross-process input).
 */
export type TerminalOpenRequest = {
  /** Opaque per-terminal id. Never the session id; never a pid (F6). */
  terminalId: string
}

/**
 * `terminal:resize` request — renderer-computed terminal dimensions for `terminalId`.
 * The renderer computes cols/rows via `fit()` FIRST, then main resizes the PTY FIRST,
 * then the terminal reflows (terminal.md resize-ordering). Parse-and-throw at the boundary.
 */
export type TerminalResizeRequest = {
  terminalId: string
  cols: number
  rows: number
}

/** `terminal:stop` request — destroy the terminal `terminalId` (port.close() THEN
 *  pty.kill()). Parse-and-throw at the boundary. */
export type TerminalStopRequest = {
  terminalId: string
}

/**
 * `terminal:exit` event — main → renderer push when a terminal's PTY exits/dies. Drives
 * the per-terminal "Terminal exited." dead-terminal pane (UX-DR18). Validated AT SOURCE
 * in main before send (main→renderer delta; zod-boundaries.md). The dead state is
 * per-terminal local renderer state, never a global error (AC-4).
 */
export type TerminalExitEvent = {
  terminalId: string
  /** The PTY exit code (0 = clean exit; non-zero = error/crash). */
  exitCode: number
}

// ---------------------------------------------------------------------------
// Story 3.1 — the MessagePort BYTE protocol (the messages that ride the transferred
// port, NOT IPC). Discriminated unions on `type`, mirroring the event convention. The
// port is bidirectional: main→renderer carries output bytes; renderer→main carries
// keystrokes + the renderer-ACK flow-control signal. These are NOT `CH.*` channels —
// the port is its own transport — but they are typed here so both sides share one shape.
// The byte path is exercised by the packaged smoke (no `MessagePortMain` in jsdom).
// [Source: architecture.md:553-559; .claude/rules/ipc.md byte-transport note]
// ---------------------------------------------------------------------------

/** main → renderer over the port: a chunk of PTY output bytes to write to xterm. */
export type TerminalPortOutput = {
  type: 'output'
  data: string
}

/** main → renderer over the port: the PTY exited (mirrors `terminal:exit`, but on the
 *  port so the renderer sees it in-band with the byte stream it is draining). */
export type TerminalPortExit = {
  type: 'exit'
  exitCode: number
}

/** Messages MAIN posts to the renderer over the port. */
export type TerminalPortMainMessage = TerminalPortOutput | TerminalPortExit

/** renderer → main over the port: keystroke bytes from xterm's `onData`. */
export type TerminalPortInput = {
  type: 'input'
  data: string
}

/** renderer → main over the port: the renderer ACKed one rendered output chunk
 *  (xterm.write's callback fired) — the flow-control drain signal (AR-4). */
export type TerminalPortAck = {
  type: 'ack'
}

/** Messages the RENDERER posts to main over the port. */
export type TerminalPortRendererMessage = TerminalPortInput | TerminalPortAck

// ---------------------------------------------------------------------------
// Story 3.5 (SM-2) — the telemetry-acknowledge IPC payload type.
//
// The renderer signals the acknowledge moment via `CH.telemetryAcknowledge`; MAIN
// computes the wait duration. This is an ADDITIVE channel — the FROZEN `AttentionEvent`
// union is NOT reshaped. The payload type is the schema-inferred `TelemetryAcknowledgeRequest`
// from `src/shared/schemas/telemetry.ts` (one source of truth — never a hand-written copy).
// [Source: story 3.5 Task 3.1; FROZEN-3; .claude/rules/ipc.md 4-file recipe]
// ---------------------------------------------------------------------------

/**
 * `telemetry:acknowledge` invoke arg — the renderer signals ONLY `{ sessionId, acknowledgedAt }`;
 * MAIN reads its tracker for `enteredColumnAt` and computes `waitMs`. UNTRUSTED cross-process
 * input → parse-and-throw at the main boundary (zod-boundaries.md IPC-arg row). Returns void.
 */
export type { TelemetryAcknowledgeRequest } from '../schemas/telemetry'

// ---------------------------------------------------------------------------
// Story 4.2 (FR-14) — the Quit-guard payload type (ADDITIVE; frozen union NOT reshaped).
//
// `quit:guard-show` carries this payload from main → renderer. Main validates AT SOURCE
// before wc.send (main→renderer = validate at source; zod-boundaries.md). The renderer
// stores `quitGuard: QuitGuardPayload | null` as RENDERER VIEW-STATE in boardStore
// (session truth stays MAIN-owned; the modal open/closed is view-state — state.md).
//
// NEVER log a session value/path: QuitGuardPayload carries sessionName which is
// session-shaped data — log path/code only on a parse miss (zod-boundaries.md).
//
// [Source: story 4.2 Task 3.1; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md;
//  .claude/rules/state.md; src/shared/schemas/quitGuard.ts (the Zod schema)]
// ---------------------------------------------------------------------------

/** Per-session row in the Quit-guard modal list. */
export type QuitGuardSession = {
  /** Stable session id (UUID). NEVER pid (identity = id). */
  id: string
  sessionName: string
  status: string
  /** Board column — computed by `columnForStatus` (same classifier as the board/badge). */
  column: Column
}

/**
 * `quit:guard-show` push payload — main → renderer.
 *
 * Fired when the quit guard finds ≥1 live app-launched session. Main validates AT SOURCE
 * before send. The renderer renders the Quit-guard modal from this payload; it does NOT
 * re-derive the count (session truth stays MAIN-owned — state.md).
 */
export type QuitGuardPayload = {
  /** Total live app-launched sessions (launched-set ∩ present in any window's reducer). */
  total: number
  /**
   * How many of those are in the `working` column (actively running agents).
   * The modal highlights "N agents are still working." using this count.
   */
  workingCount: number
  /** Per-session detail for the modal list. */
  sessions: QuitGuardSession[]
}
