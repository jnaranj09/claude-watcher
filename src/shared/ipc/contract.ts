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
import type { Template } from '../schemas/template'
import type { Tag } from '../schemas/tag'
import type { Rule } from '../schemas/rule'
import type { Shortcut } from '../schemas/shortcut'
import type {
  Workspace,
  WorkspaceSaveRequest,
  WorkspaceDeleteRequest,
  WorkspaceSetActiveRequest
} from '../schemas/workspace'

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
  // opaque `terminalId` the renderer's EmbeddedTerminal opens against. See SessionLaunchRequest /
  // SessionLaunchResult below.
  sessionLaunch: 'session:launch',
  // Past sessions (D-3) — the two exits from the board, keyed by terminalId like `terminal:stop`
  // (the renderer holds the terminalId from the first frame; the session id lands later).
  // `session:archive` (was the reserved `session:stop`): stop the pty, write the archive record,
  // remove the card. No confirmation. `session:delete`: stop the pty, remove any record, remove
  // the card — after the Delete confirm. Both return void; the card leaves as `session.removed`.
  sessionArchive: 'session:archive',
  sessionDelete: 'session:delete',
  // Session-naming A2 — `session:rename`: retitle an EXISTING session by its stable id. A REAL
  // new channel: there is nothing existing to reuse (a rename is not a terminal operation, and
  // `terminal:*` is keyed by terminalId while the reducer's map is keyed by session id).
  // Renderer → main invoke returning void; the retitled card comes back the normal
  // way, as a `session.updated` delta over CH.watchEvents. See SessionRenameRequest below.
  sessionRename: 'session:rename',
  // Deterministic-attention — `session:seen`: renderer → main VIEW INTENT ("the operator is
  // looking at this session": active rail tab + focused window). Main demotes ONLY a
  // `YourTurn` session to idle (`reducer.markSeen` guard) — a seen can never clear a
  // question/permission (those clear on reply only — spec DA-3). Invoke returning void; the
  // demoted card returns as a normal `session.updated` delta over CH.watchEvents. This is
  // NOT the Story-3.4 acknowledge view-state (`acknowledgedById`, renderer-only emphasis):
  // seen is a session-TRUTH transition, ack is a highlight. The rename seam is the precedent
  // for user intent driving a truth change through a typed invoke.
  sessionSeen: 'session:seen',
  // Workspaces — `session:set-workspace`: renderer → main VIEW INTENT ("move this card"). A real
  // new channel, like `session:rename`: it is not a terminal operation, and `terminal:*` is keyed
  // by terminalId while the reducer's map is keyed by session id. Invoke returning void; the
  // moved card comes back the normal way, as a `session.updated` delta over CH.watchEvents.
  sessionSetWorkspace: 'session:set-workspace',
  // Story 3.4 (FR-16) — the ADDITIVE `launch:correlated` push (main → renderer). Fired ONCE,
  // when the Story-3.2 Tgid correlation join LANDS in `correlateAgainst` (the /proc-only join
  // that binds an app-spawned `claude` to its c9watch session `id`). It carries the
  // `{ terminalId, sessionId }` binding the renderer cannot derive itself (the join is a
  // main-only /proc Tgid computation). The renderer builds a `terminalIdBySessionId` view-state
  // so the attention rail can switch the visible terminal BY session id — a pure renderer
  // show/hide of the kept-alive terminals (NO per-switch IPC). This is a SEPARATE channel, NOT a
  // new member of the FROZEN `AttentionEvent` union. See `LaunchCorrelatedEvent` below.
  launchCorrelated: 'launch:correlated',
  // Programmatic API — `launch:requested` (main → renderer): the API asked for a card. Main has
  // registered the launch recipe and pushes the terminalId; the renderer opens the terminal
  // exactly like a UI launch (openLaunchedTerminal), which is what spawns the pty.
  launchRequested: 'launch:requested',
  // Programmatic API — the bearer token the Settings panel shows and regenerates.
  apiTokenGet: 'api:token-get',
  apiTokenRegenerate: 'api:token-regenerate',
  // Story 3.2 (FR-11) — the native KDE directory picker. An `invoke` that opens the OS
  // `dialog.showOpenDialog({ properties: ['openDirectory'] })` in MAIN and returns the chosen
  // path, or `null` on cancel. The dialog runs in MAIN (it is an OS dialog); the renderer
  // NEVER opens a dialog itself (UX-DR23). See SessionPickDirectoryResult below.
  sessionPickDirectory: 'session:pick-directory',
  // Session templates — a named { cwd, model, permissionMode } bundle the operator can launch
  // from without re-picking a directory each time. `session:launch-from-template` mirrors
  // `session:launch` (renderer → main invoke, returns SessionLaunchResult) but the renderer
  // sends only a `templateId`; main resolves the flags from its own validated store — the
  // renderer never carries them itself. `templates:list/save/delete` are the CRUD invokes for
  // the store; main owns the persisted file, the renderer holds a projection
  // (templatesStore.ts). See TemplatesSaveResult / SessionLaunchFromTemplateRequest below.
  sessionLaunchFromTemplate: 'session:launch-from-template',
  templatesList: 'templates:list',
  templatesSave: 'templates:save',
  templatesDelete: 'templates:delete',
  // Phrase shortcuts — the shortcuts CRUD channels. There is deliberately NO channel for
  // DELIVERING a phrase: it rides the existing terminal MessagePort `{type:'input'}` frame,
  // the same one every keystroke and the Ctrl+V takeover already use.
  shortcutsList: 'shortcuts:list',
  shortcutsSave: 'shortcuts:save',
  shortcutsDelete: 'shortcuts:delete',
  // Workspaces — the workspaces CRUD invokes plus the persisted active-workspace pointer.
  // `workspaces:set-active` is its own channel rather than a field on save: switching the view
  // is not editing a row, and it is the ONE call the switcher makes on every click.
  workspacesList: 'workspaces:list',
  workspacesSave: 'workspaces:save',
  workspacesDelete: 'workspaces:delete',
  workspacesSetActive: 'workspaces:set-active',
  // Tags — the tag catalog's CRUD invokes (main-owned file; the renderer holds a projection in
  // tagsStore.ts) plus `session:set-tags`, the manual-tagging write (spec §2.4). Invoke returning
  // void; the tagged card comes back the normal way, as a `session.updated` delta.
  tagsList: 'tags:list',
  tagsSave: 'tags:save',
  tagsDelete: 'tags:delete',
  sessionSetTags: 'session:set-tags',
  // Past sessions — the history's invokes (main-owned file; the renderer holds a projection in
  // pastSessionsStore.ts). `past-sessions:open` resumes a record as a live card and returns the
  // same shape as `session:launch` plus the record's name, so the renderer opens the terminal
  // through the popover's own path (D-12: Open takes the view).
  pastSessionsList: 'past-sessions:list',
  pastSessionsForget: 'past-sessions:forget',
  pastSessionOpen: 'past-sessions:open',
  // Rules — the rule list's invokes (main-owned, run-ordered file; the renderer holds a projection
  // in rulesStore.ts). `rules:move` is the only reorder: list order IS run order (spec T-14).
  rulesList: 'rules:list',
  rulesSave: 'rules:save',
  rulesDelete: 'rules:delete',
  rulesMove: 'rules:move',
  // Custom themes (spec 2026-09-20). `themes:list` rescans `<userData>/themes` and returns every
  // folder as a ThemeSummary (broken ones carry `error`). `theme:reload` re-applies the CHOSEN
  // theme id (settings.themeId) and pushes the result. `themes:open-folder` opens the folder in
  // the file manager (main; the renderer never touches `shell`). `theme:applied` is the ONE
  // main → renderer push carrying the composed ThemeBundle, validated at source. The apply on a
  // themeId CHANGE rides `settings:set` — no channel of its own.
  themesList: 'themes:list',
  themeReload: 'theme:reload',
  themesOpenFolder: 'themes:open-folder',
  themeApplied: 'theme:applied',
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
  // Attention reminders (spec 2026-09-10) — main pushes one each time it re-notifies a session
  // still blocked on you (a permission prompt or a question), so the renderer plays the attention
  // sound. NOT an `attention.raised`: the AttentionEvent union is frozen and a reminder is not a
  // new entry. Carries only the session `id`. See `AttentionReminderPayload` below.
  attentionReminder: 'attention:reminder',
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
  quitCancel: 'quit:cancel',

  // Terminal clipboard feature — the text clipboard bridge (renderer ↔ main).
  // Power stays in MAIN (Electron `clipboard` module; the sandboxed renderer NEVER
  // touches the OS clipboard directly — security posture). Both are typed invokes:
  //   - `clipboard:read-text`  invoke() → string  (no arg; returns '' for image-only)
  //   - `clipboard:write-text` invoke({ text }) → void  (arg is UNTRUSTED; parse-and-throw)
  // The IMAGE path does NOT ride these channels — `claude` reads the OS image itself
  // when the renderer forwards `\x16` via the existing port input frame. No image bytes
  // ever cross the renderer/IPC seam. [Source: spec-terminal-clipboard.md; .claude/rules/ipc.md]
  clipboardReadText: 'clipboard:read-text',
  clipboardWriteText: 'clipboard:write-text',

  // External links — a link clicked in a terminal opens in the OS default browser, never in the
  // app. invoke({ url }) → void; the arg is UNTRUSTED (parse-and-throw, LinkOpenExternalSchema)
  // and main opens http(s) only (src/main/links/externalLinks.ts). Never log the URL.
  linkOpenExternal: 'link:open-external',

  // Server health (UX-05, R11) — are the hook ingest and the API actually listening?
  // `server-health:get` → ServerHealth (the renderer asks on mount); `server-health:changed` is
  // the main → renderer push on every change, validated at source (ServerHealthSchema).
  serverHealthGet: 'server-health:get',
  serverHealth: 'server-health:changed',
  // Storage health (UX-06, UX-07) — store files that could not be read or written this run.
  // `storage-health:get` → StorageHealth (asked on mount); `storage-health:changed` is the push on
  // every new problem, validated at source (StorageHealthSchema).
  storageHealthGet: 'storage-health:get',
  storageHealth: 'storage-health:changed'
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
 *
 * The rule triggers' enums and the enriched delta's `ColumnSchema` derive from the same
 * list (spec §1.2), so a fourth column cannot be added to one and not the others.
 */
export const COLUMNS = ['working', 'needs-you', 'idle'] as const
export type Column = (typeof COLUMNS)[number]

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
  /** Workspaces — which workspace this card belongs to. The renderer filters on it; it never
   *  mutates it (session truth is main's). */
  workspaceId: string
  /** Tags — the card's tag ids (session truth, main-owned). Order carries no meaning: the renderer
   *  draws chips in TAG-LIST order. */
  tagIds: string[]
  /** What the session is blocked on, when c9watch reports one (AC-1). */
  pendingToolName?: string
  /** Name-sync (D-11) — true while an in-app rename waits for claude's next prompt (the card
   *  draws the ⟳ mark). Absent = false. */
  nameSyncPending?: boolean
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
 * Attention reminders — `attention:reminder` push payload: main → renderer. Fired each time main
 * re-notifies a launched session that is still blocked on a permission prompt or a question. It
 * carries ONLY the stable session `id`; the renderer plays the attention sound (when sound is on).
 * Validated AT SOURCE in main before send (`AttentionReminderSchema`).
 */
export type AttentionReminderPayload = {
  /** The reminded session's stable id (UUID). Never key on pid. */
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

// Server health — the hook/API listener state pushed to the banner and Settings.
export type { ServerHealth, HookHealth, ApiHealth } from '../schemas/serverHealth'
export type {
  StorageHealth,
  StorageProblem,
  StorageProblemCode,
  StoreName
} from '../schemas/storageHealth'

// Custom themes — the theme seam's payload types (schema-inferred; never a hand-written copy).
export type { ThemeSummary, ThemeBundle, ThemeApplyResult } from '../schemas/theme'

// Session templates — main-owned; the renderer holds a projection (templatesStore.ts).
export type {
  Template,
  TemplateSaveRequest,
  TemplateDeleteRequest,
  PermissionMode
} from '../schemas/template'
/** `templates:save` result — the saved row (so the dialog can select it) + the full sorted list. */
export type TemplatesSaveResult = { saved: Template; templates: Template[] }
/** `session:launch-from-template` arg. Returns `SessionLaunchResult` like `session:launch`. */
export type SessionLaunchFromTemplateRequest = { templateId: string; name: string }

// Tags — main-owned catalog; the renderer holds a projection (tagsStore.ts).
export type { Tag, TagSaveRequest, TagDeleteRequest, SessionSetTagsRequest } from '../schemas/tag'
/** `tags:save` result — the saved row (so the dialog can select it) + the full sorted list. */
export type TagsSaveResult = { saved: Tag; tags: Tag[] }

// Rules — main-owned, run-ordered list; the renderer holds a projection (rulesStore.ts).
export type {
  Rule,
  RuleSaveRequest,
  RuleDeleteRequest,
  RuleMoveRequest,
  RuleTrigger,
  RuleCondition,
  RuleAction
} from '../schemas/rule'
/** `rules:list` result — the rules in RUN order + the ids of those that can never fire (T-23: a
 *  missing or out-of-scope reference, or a regex that does not compile). */
export type RulesListResult = { rules: Rule[]; brokenIds: string[] }
/** `rules:save` result — the saved row (so the dialog can select it) PLUS the full view. */
export type RulesSaveResult = { saved: Rule } & RulesListResult

// Workspaces — main-owned; the renderer holds a projection (workspacesStore.ts). The list result
// is the file's VIEW, not a bare array: `activeId` and the list change together and must never be
// read from two different round-trips.
export type { Workspace, WorkspaceSaveRequest, WorkspaceDeleteRequest, WorkspaceSetActiveRequest }
export type WorkspacesListResult = { activeId: string; workspaces: Workspace[] }
/** `workspaces:save` result — the saved row (so the dialog can select it) PLUS the full view. */
export type WorkspacesSaveResult = { saved: Workspace } & WorkspacesListResult

// Phrase shortcuts — main-owned; the renderer holds a projection (shortcutsStore.ts). The phrase
// itself never travels on an IPC channel: the expander box's Enter posts it on the terminal's
// EXISTING MessagePort `{type:'input'}` frame, so these three channels are CRUD only.
export type { Shortcut, ShortcutSaveRequest, ShortcutDeleteRequest } from '../schemas/shortcut'
/** `shortcuts:save` result — the saved row PLUS the full sorted list, so the dialog can select
 *  the row it just created without guessing, and the renderer replaces its projection wholesale. */
export type ShortcutsSaveResult = { saved: Shortcut; shortcuts: Shortcut[] }

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
  /**
   * The OPERATOR-TYPED session name from the create-time prompt (prefilled with the cwd
   * basename, so this is the basename unless the operator changed it). Becomes the synthesized
   * card's `sessionName` in place of the derived basename.
   *
   * UNTRUSTED + NEVER-LOGGABLE, exactly like `cwd`: validated by `SessionNameSchema`
   * (trimmed, 1..`SESSION_NAME_MAX_LENGTH`) at the main boundary, and on a parse miss the
   * caller logs path/code only — an operator-typed name is content, not an opaque id.
   */
  name: string
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
  /** Workspaces — the workspace MAIN stamped on this launch. Returned so the renderer can
   *  register the launched terminal's workspace before any session delta arrives (it must be
   *  able to hide the frame if the operator switches away in between). */
  workspaceId: string
}

/**
 * Session-naming A2 — `session:rename` request: retitle an EXISTING session.
 *
 * UNTRUSTED cross-process input → `SessionRenameSchema.parse` + throw at the main boundary.
 * NEITHER field is loggable: `id` is an opaque uuid (safe but pointless to log) and `name` is
 * OPERATOR CONTENT. On a parse miss the handler logs path/code only — the throw IS the signal.
 * [zod-boundaries.md IPC-arg row]
 *
 * Keyed on the STABLE session `id` (the launch-minted uuid), NEVER a pid and NEVER a terminalId:
 * the reducer's map is keyed by session id, and that is the identity a rename has to hit.
 * Returns void — the renamed card reaches the renderer the normal way, as a `session.updated`
 * delta over `CH.watchEvents`, not as an invoke reply.
 */
export type SessionRenameRequest = {
  /** The stable session id (launch-minted uuid) to retitle. Unknown id is a no-op in main. */
  id: string
  /** The new operator-typed name. Validated by the SHARED `SessionNameSchema` — the same
   *  definition the create-time prompt uses, so both paths agree on what a legal name is. */
  name: string
}

/** Past sessions — `session:archive` arg. The terminalId of the pane to stop and archive. */
export type SessionArchiveRequest = { terminalId: string }
/** Past sessions — `session:delete` arg. MAIN decides which record goes: the terminal's bound
 *  session and, on a pane whose claude already exited (no binding left; its exit archived the
 *  card), the id the launch override last bound it to (`LaunchOverride.lastSessionId`).
 *  `sessionId` is only a HINT — the id the renderer knows for this terminal, null before
 *  correlation and null again once the card is gone; main drops that record too (idempotent). */
export type SessionDeleteRequest = { terminalId: string; sessionId: string | null }
/** Past sessions — `past-sessions:open` result: the launch the renderer opens (like
 *  SessionLaunchResult) plus the record's name for the Starting banner. */
export type PastSessionOpenResult = { terminalId: string; workspaceId: string; name: string }
export type {
  PastSession,
  PastSessionForgetRequest,
  PastSessionOpenRequest
} from '../schemas/pastSession'

// Workspaces — `session:set-workspace` request. Defined (via z.infer) at
// `../schemas/launch.ts#SessionSetWorkspaceSchema`; re-exported here so preload/main import the
// request type from the SAME place they import every other CH.* payload type.
export type { SessionSetWorkspaceRequest } from '../schemas/launch'

/**
 * `session:seen` request — the viewed session's stable id (the launch-minted uuid; NEVER a
 * pid/terminalId). UNTRUSTED cross-process input → parse-and-throw at the main boundary. An
 * UNKNOWN or non-YourTurn id is a quiet no-op in the reducer (viewing is not an error).
 */
export type SessionSeenRequest = {
  /** The stable session id of the session the operator is viewing. */
  id: string
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

/** Programmatic API — the `launch:requested` push. Validated at source (LaunchRequestedSchema). */
export type LaunchRequestedEvent = {
  terminalId: string
  /** The session name the API caller gave; the Starting banner's label. */
  label: string
  /** The workspace main will stamp on the card (the template's, else the active one). */
  workspaceId: string
}

/** Programmatic API — `api:token-get` / `api:token-regenerate` return value. */
export type ApiTokenResult = { token: string }

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
  /** Story 5.4 — a per-OPEN token (fresh for each create-effect run; NOT stable per terminal).
   *  Main echoes it back on the port transfer so the renderer pairs THIS port to THIS open. It
   *  disambiguates a re-open of the SAME terminalId (a StrictMode dev double-mount, or Reopen):
   *  without it the renderer could pair the STALE (already-closed) port from the prior open and
   *  ignore the live one → a blank terminal. Opaque non-empty string; never an identity key. */
  openToken: string
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
 *  pty.kill()). Parse-and-throw at the boundary.
 *  Story 5.6 — `openToken` is ADDITIVE and optional: when provided, the manager only kills if
 *  the token matches the terminal's current open token (stale cleanup-stops self-identify and
 *  are no-op'd). Omitting it (user-initiated / quit teardown) is an unconditional kill. */
export type TerminalStopRequest = {
  terminalId: string
  /** Optional per-open token (Story 5.6). When provided, a stale (superseded) stop is a no-op. */
  openToken?: string
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

// Story 5.1 — the window.postMessage tag for the preload→renderer main-world-port
// forward. NOT an IPC channel (no-literal-channels does NOT apply); it is a payload
// string that disambiguates the forward from unrelated postMessage traffic. ONE shared
// const here so preload and renderer can't drift. The preload forwards the real port
// via `window.postMessage({ tag: TERMINAL_PORT_TAG, terminalId, openToken }, '*', [port])`;
// the renderer reads `e.data.tag === TERMINAL_PORT_TAG && e.data.terminalId === terminalId &&
// e.data.openToken === openToken` (Story 5.4 adds the openToken match so a re-open of the same
// terminalId can't pair the stale port from the prior open).
// [Source: story 5.1 Task 2; story 5.4; Electron "MessagePort in the main world" docs; ipc.md]
export const TERMINAL_PORT_TAG = 'c9watch:terminal-port' as const

// Deterministic-attention feature — the "claude finished a turn; it is the operator's
// turn" status. NOT an enum-lock (status remains z.string() everywhere): a shared
// spelling for its producer (hookStatus Stop), its demoter (reducer.markSeen), and its
// renderer comparison (the seen effect), so the three cannot drift. It classifies to
// `needs-you` (columns.ts fail-toward-attention + an explicit pin test).
export const STATUS_YOUR_TURN = 'YourTurn' as const

// R5 (docs/reports/2026-09-23-bug-hunt) — a turn ended while claude's own background work (a
// dev server, a watcher) is still running. It IS the operator's turn, so the card sits in
// `needs-you` like `YourTurn`, but QUIETLY: the attention tracker raises nothing for it (no
// popup, no sound), reminders skip it, and markSeen demotes it like `YourTurn`. It used to be
// `Working`, which a task that never ends (a dev server) held forever.
export const STATUS_YOUR_TURN_BACKGROUND = 'YourTurnBackground' as const

/** The two "your turn" statuses: what a seen demotes to idle. */
export const YOUR_TURN_STATUSES: ReadonlySet<string> = new Set([
  STATUS_YOUR_TURN,
  STATUS_YOUR_TURN_BACKGROUND
])

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

// ---------------------------------------------------------------------------
// Terminal clipboard feature — clipboard text bridge payload type.
//
// `clipboard:write-text` invoke arg — the text the renderer asks main to write
// to the OS clipboard. UNTRUSTED cross-process input → parse-and-throw at the main
// boundary (zod-boundaries.md IPC-arg row). NEVER log the text value (user content;
// Guardrail #6 — log path+code only on a parse failure).
//
// `clipboard:read-text` has no request payload (a plain invoke() → string).
//
// [Source: spec-terminal-clipboard.md; .claude/rules/ipc.md; .claude/rules/zod-boundaries.md]
// ---------------------------------------------------------------------------

/**
 * `clipboard:write-text` invoke arg — the text to write to the OS clipboard.
 * UNTRUSTED cross-process input → parse-and-throw at the main boundary.
 * NEVER log the `text` value (user content; Guardrail #6).
 */
export type ClipboardWriteTextRequest = { text: string }
