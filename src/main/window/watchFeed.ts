import { BrowserWindow } from 'electron'
import { CH } from '../../shared/ipc/contract'
import type { ReducerWatchEventsPayload } from '../../shared/ipc/contract'
// Story 1.4 fix — validate-at-source for the watch:status connection-state push.
import { WatchStatusSchema } from '../../shared/schemas/watchDelta'
import { LaunchRequestedSchema } from '../../shared/schemas/launch'
import { DEFAULT_SETTINGS } from '../../shared/schemas/settings'
// Story 6.2 — the reducer-storage Session type (parse-once contract): the spawn-time
// launch synthesis CONSTRUCTS a valid Session from main-owned values (minted uuid, picked
// cwd, pty pid) — it never re-runs SessionSchema over internal data.
import type { Session } from '../../shared/schemas/session'
import type { Tag } from '../../shared/schemas/tag'
import type { ApiSession } from '../../shared/schemas/api'
import { keepVisibleTags } from '../../shared/tags/tagScope'
// Story 2.2 — the KDE attention notifier (Electron Notification → libnotify), behind a DI
// seam. Fires 1:1 off the tracker's attention.raised; informational only (NO self-raise).
import { createAttentionNotifier } from '../kde/notifications'
// Attention reminders (spec 2026-09-10) — re-notify a session still blocked on you.
import { createAttentionReminders, type AttentionReminders } from '../kde/attentionReminders'
// F1 (final-review fix wave) — the extracted, independently-tested `remind` callback body.
import { createReminderSink } from '../kde/reminderSink'
import { createNotificationActivate } from '../kde/notificationActivate'
import { isViewingSession } from '../kde/viewedSession'
// Story 2.3 — the tray + PAINTED-badge controller (behind a DI seam, mirrors the notifier) +
// the pure badge-count fn. The count = needs-you + idle, derived from the SAME reducer map +
// columnForStatus the board uses (single source of truth). Tray is badge + menu only (NO
// self-raise); never-crash if the tray/display is unavailable.
import { createTrayController, type TrayController } from '../kde/tray'
import { computeBadgeCount } from '../kde/badge'
// Story 1.4 — validate-at-source enrichment of the session.updated delta (extracted
// to its own module so it stays unit-testable without pulling electron/node-pty).
import { enrichDelta } from '../c9watch/enrichDelta'
// Story 3.3 (FR-1 amended) — the BOARD-SHIP membership gate (pure; reads only the event id +
// the launched-set predicate). Drops external/Konsole deltas at the ship chokepoint so the
// board shows ONLY app-launched sessions. Kept in its own pure module for unit coverage.
import { shouldEmitRaise, shouldShipToBoard } from '../c9watch/shipGate'
// The session reducer — the authoritative Map<id,Session> + typed session deltas.
// Story 6.4: the c9watch CLI feed is RETIRED; sessions are born at spawn
// (upsertLaunched, Story 6.2) and transitioned/removed by hooks + stop/exit
// (applyHookStatus, Stories 6.3/hook-ingest). The dir name `c9watch/` is historical.
import { createReducer } from '../c9watch/reducer'
// Story 1.2 — the column-transition tracker: consumes each reducer delta + the
// reduced map, emits attention.raised on a needs-you ENTRY edge (first observation
// suppressed), stamps time-entered-column, debounces flaps.
import { createAttentionTracker, type AttentionTracker } from '../c9watch/attention'
import type { SettingsStore } from '../persistence/settings'
import type { WorkspacesStore } from '../persistence/workspaces'
import type { PastSessionsStore } from '../persistence/pastSessions'
import type { LivePastSessions } from '../persistence/livePastSessions'
// Past sessions (D-3) — the PURE, unit-tested reason → history decision (archive writes the
// record via buildPastSessionRecord; delete removes any earlier one; a null store no-ops).
import { applyRemovalReason } from '../persistence/pastSessionRecord'
import type { TagsStore } from '../persistence/tags'
import { staleTagEdits } from '../persistence/tagsIpc'
import { createRulesEngine, type RulesEngine } from '../rules/rulesEngine'
import type { RulesSnapshot } from '../rules/evaluateRules'
import { runDeltaPipeline } from '../rules/deltaPipeline'
import type { RemovalReason } from '../pty/launchRemoval'
import type { LaunchService } from '../pty/launchSession'
import type { LaunchedSet } from '../pty/launchedSet'
import type { TerminalManager } from '../pty/terminalManager'
import type { ShellCompanionRegistry } from '../pty/shellCompanion'
import type { ProcessSessionSource } from '../pty/claudeSessionFile'
import { approvalStatusChange } from '../pty/approvalKey'
import { createApiEventHub, type ApiEventHub, type ApiSeam } from '../api/apiSeam'
import { projectApiSession } from '../api/apiSession'
// Hook-status feature — real-time session status from Claude Code lifecycle hooks.
// The hook server binds a localhost HTTP listener; hook events flow through the SAME
// handleDelta chokepoint as c9watch deltas (same enrich/column/tray treatment).
import { createHookServer, type HookServer } from '../hooks/hookServer'
import { hookStatus } from '../hooks/hookStatus'
import { createTranscriptWatcher, type TranscriptWatcher } from '../hooks/transcriptWatcher'
import { forgetSession, trackHookEvent, type SessionTrackingDeps } from '../hooks/sessionTracking'
// Session-rebind — claude can change its own session id mid-run (a `/clear` keeps the pty and
// the terminal, but fires SessionEnd for the old id and posts every later hook under a new
// one). These two decisions keep the card through that switch. [hooks/sessionRebind.ts]
import {
  claimByProcess,
  findAdoptionTarget,
  namedByShellPane,
  sessionEndKeepsCard,
  type OrphanRegistry
} from '../hooks/sessionRebind'
// Name-sync — the per-window store of names waiting to be pushed to claude on its next
// UserPromptSubmit hook POST (the only way to rename an already-running session).
import { createPendingTitles } from '../hooks/pendingTitles'
import { renameLaunched as renameLaunchedCard } from '../hooks/renameLaunched'
// Name-sync — the read-back decision (claude is the authority on its own name). Pure + here
// rather than inline, so it is testable: nothing can import index.ts.
import { titleReadBackRename } from '../hooks/titleReadBack'
import type { ServerHealthState } from '../serverHealth'
import type { ReducerLike } from '../lifecycle/computeLiveLaunchedSessions'
import { sendLaunchCorrelated } from '../ipc/sendLaunchCorrelated'

export interface LaunchBoardSeam {
  /** Story 6.2 — synthesize/refresh the instant card at spawn (upsertLaunched → handleDelta). */
  upsertLaunched(session: Session): void
  /** Workspaces — the live-session guard (spec W-6): true when THIS window's board has any
   *  card in `workspaceId`. Read-only scan of the reducer snapshot; no handleDelta involved. */
  hasSessionsInWorkspace(workspaceId: string): boolean
  /** Past sessions — is this id a live card on THIS window's board? Read-only. */
  hasSession(sessionId: string): boolean
  /** Story 6.3 removal, now with the exit's REASON (D-3): `archive` snapshots the card into the
   *  past-sessions store BEFORE it goes; `delete` drops any record. Idempotent either way. */
  removeLaunched(sessionId: string, reason: RemovalReason): void
  /** ESCAPE-INTERRUPT — demote a session to idle because the operator pressed Escape.
   *  Interrupting fires no hook and (when interrupted early) leaves no transcript trace,
   *  so the keystroke is the only evidence. A session already idle is a quiet no-op. */
  interruptLaunched(sessionId: string): void
  /** R4 — a key typed into a launched terminal: Enter/1/2 on an open permission prompt moves
   *  the card to Working (claude sends no hook on approval). Anything else is a no-op. */
  keyLaunched(sessionId: string, data: string): void
  /** Session-naming A2 — retitle an existing session (renameSession → handleDelta). Unknown id
   *  is a quiet no-op inside the reducer, so this never needs a caller-side existence check. */
  renameLaunched(sessionId: string, name: string): void
  /** Workspaces — move an existing card to another workspace (setWorkspace → handleDelta).
   *  Unknown session id is a quiet reducer no-op; the target workspace's EXISTENCE is checked by
   *  the caller (the IPC handler), not here — mirrors renameLaunched's no-existence-check shape. */
  setWorkspaceLaunched(sessionId: string, workspaceId: string): void
  /** Deterministic-attention — the operator viewed this session (markSeen → handleDelta).
   *  Only a YourTurn session demotes; everything else is a quiet reducer no-op. */
  seenLaunched(sessionId: string): void
  /** Tags — the workspace a card lives in, or undefined for an unknown id. Read-only; feeds the
   *  `session:set-tags` scope check (T-11). */
  workspaceOf(sessionId: string): string | undefined
  /** Tags — replace a card's tags (setTags → handleDelta). The caller already proved every id
   *  exists and is visible to the card (parseSessionSetTags). Unknown session id is a quiet
   *  reducer no-op. Never triggers rules (spec §2.4). */
  setTagsLaunched(sessionId: string, tagIds: readonly string[]): void
  /** Tags — the catalog changed (a tag deleted or re-scoped): strip every tag a card can no longer
   *  see (staleTagEdits → setTags → handleDelta), spec §1.4. */
  pruneTags(lookup: (tagId: string) => Pick<Tag, 'workspaceId'> | null): void
}

/** What the per-window session engine reads from the app. Maps here are shared with other
 *  main-process code and stay owned by index.ts; values index.ts assigns after app-ready are
 *  GETTERS, read at call time. */
export interface WatchFeedDeps {
  /** Smoke mode — no session engine at all. */
  smoke: boolean
  reducers: Map<Electron.WebContents, ReducerLike>
  trackers: Map<Electron.WebContents, AttentionTracker>
  focusedTerminals: Map<Electron.WebContents, string | null>
  ruleEngines: Map<Electron.WebContents, RulesEngine>
  launchBoardSeams: Map<Electron.WebContents, LaunchBoardSeam>
  apiSeams: Map<Electron.WebContents, ApiSeam>
  launchedSet: LaunchedSet
  livePastSessions: LivePastSessions
  orphanRegistry: OrphanRegistry
  processSessions: ProcessSessionSource
  serverHealth: ServerHealthState
  getLaunchService: () => LaunchService | null
  getTerminalManager: () => TerminalManager | null
  getShellCompanions: () => ShellCompanionRegistry | null
  getSettingsStore: () => SettingsStore | null
  getTagsStore: () => TagsStore | null
  getPastSessionsStore: () => PastSessionsStore | null
  requireWorkspacesStore: () => WorkspacesStore
  rulesSnapshot: () => RulesSnapshot
  apiLog: (message: string) => void
}

export interface WatchFeed {
  registerWatchFeed(window: BrowserWindow): void
  teardownWatchFeed(wc: Electron.WebContents): void
}

export function createWatchFeed(deps: WatchFeedDeps): WatchFeed {
  const {
    smoke: SMOKE,
    reducers,
    trackers,
    focusedTerminals,
    ruleEngines,
    launchBoardSeams,
    apiSeams,
    launchedSet,
    livePastSessions,
    orphanRegistry,
    processSessions,
    serverHealth,
    getLaunchService,
    getTerminalManager,
    getShellCompanions,
    getSettingsStore,
    getTagsStore,
    getPastSessionsStore,
    requireWorkspacesStore,
    rulesSnapshot,
    apiLog
  } = deps

  // Transcript watchers — per-window handles, disposed in teardownWatchFeed so no fs watch
  // outlives its window. Same lifetime contract as hookServers below.
  const transcriptWatchers = new Map<Electron.WebContents, TranscriptWatcher>()

  // Hook-status feature — per-window hook HTTP listener handle, closed in teardownWatchFeed
  // (mirrors `trackers`/`reducers`). Prevents an EADDRINUSE leak when a window
  // closes→reopens or HMR reloads.
  const hookServers = new Map<Electron.WebContents, HookServer>()

  // Story 2.3 — one tray controller per window (same lifetime as the feed/reducer/tracker/
  // notifier). It mirrors the live needs-you+idle count onto the OS tray icon (PAINTED badge,
  // NOT app.setBadgeCount). Constructed in registerWatchFeed, fed the recomputed count on every
  // delta + after the seed, destroyed in teardownWatchFeed. A tray/paint failure degrades to a
  // no-op and never touches the feed (never-crash).
  const trays = new Map<Electron.WebContents, TrayController>()

  // Attention reminders — one scheduler per window (same lifetime as the notifier/tracker). Kept
  // in a map so teardownWatchFeed can clear its timers; none may fire into a closed window.
  const reminderSchedulers = new Map<Electron.WebContents, AttentionReminders>()

  // Programmatic API — the per-window event hub (its seam lives in `apiSeams`, shared with the
  // listener). The hub is held in its own map only so the teardown can clear its subscribers —
  // nothing else reads it.
  const apiHubs = new Map<Electron.WebContents, ApiEventHub>()

  // Story 6.4 — the NATIVE SESSION ENGINE wiring (the function name predates the CLI
  // retirement and is kept for continuity — there is no c9watch feed anymore). The
  // "engine" is: the per-window reducer + tracker + tray + notifier below, the hook
  // server (status transitions), the Story-6.2 spawn-time launch synthesis (instant
  // card), and the Story-6.3 stop/exit removal.
  //
  // Smoke mode is a packaged node-pty exit gate (no board/session engine needed there);
  // never spin up the engine there.
  function registerWatchFeed(window: BrowserWindow): void {
    if (SMOKE) return
    const wc = window.webContents
    if (reducers.has(wc)) return

    // Programmatic API — this window's event hub, declared FIRST because `handleDelta` (below)
    // closes over it. The binding must exist before that function is DEFINED, not merely before it
    // runs: today registerWatchFeed finishes before the first delta arrives, but that is an accident
    // of ordering, not a guarantee, and a temporal-dead-zone capture would throw inside the one
    // chokepoint every delta passes through.
    const apiHub = createApiEventHub(apiLog)
    apiHubs.set(wc, apiHub)

    const reducer = createReducer({
      now: () => Date.now(),
      // never-log-the-parsed-value: PATH + CODE only (Critical Guardrail #6).
      log: (err) => console.warn(`[c9watch][feed] dropped line path=${err.path} code=${err.code}`)
    })
    // Story 4.2 (FR-14) — store the reducer reference in the app-global registry so the
    // quit handler can read reducer.snapshotMap() for the liveness compute (ARCH-FORK-1 option A).
    // Same lifetime as the feed; deleted in teardownWatchFeed alongside trackers.delete.
    reducers.set(wc, reducer)
    // Story 1.2 — one tracker per window (same lifetime as the reducer/feed). It reads
    // the reducer's already-validated deltas + map (parse-once; never re-parses) and
    // produces the entry-transition attention.raised events. Injected now() for
    // determinism (the default Date.now in production).
    const tracker = createAttentionTracker({ now: () => Date.now() })
    // Story 3.5 (SM-2) — store the tracker reference in the per-window map so the
    // app-global telemetry IPC handler can look up columnOf/enteredColumnAt. Same lifetime
    // as the feed; removed in teardownWatchFeed (below).
    trackers.set(wc, tracker)
    // UX-13 — is the operator looking at this session right now (window focused, its terminal in
    // the focused view)? Then neither the first alert nor a reminder fires for it.
    const isViewing = (id: string): boolean =>
      isViewingSession(id, {
        windowFocused: () => {
          if (wc.isDestroyed()) return false
          return BrowserWindow.fromWebContents(wc)?.isFocused() ?? false
        },
        focusedTerminalId: () => focusedTerminals.get(wc) ?? null,
        sessionIdFor: (terminalId) => getLaunchService()?.sessionIdFor(terminalId) ?? null
      })
    // Story 2.2 — one notifier per window (same lifetime as the reducer/tracker/feed). It
    // fires a KDE notification 1:1 off the tracker's attention.raised (no extra debounce — the
    // tracker's per-session ~700ms emission debounce is the sole storm-suppression authority).
    // A click raises the window and opens the session (UX-12 / R29, notificationActivate.ts).
    // `settings.notificationsEnabled` off = no popup (UX-13); read live on every alert.
    const notifier = createAttentionNotifier({
      onActivate: createNotificationActivate({
        isDestroyed: () => wc.isDestroyed(),
        raise: () => {
          const win = BrowserWindow.fromWebContents(wc)
          if (win === null || win.isDestroyed()) return
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        },
        send: (payload) => wc.send(CH.attentionActivate, payload),
        log: (message) => console.warn(message)
      }),
      enabled: () => (getSettingsStore()?.get() ?? DEFAULT_SETTINGS).notificationsEnabled,
      // never-log-the-parsed-value: id + code only, never a session value (Guardrail #6).
      log: (message) => console.warn(message)
    })
    // Story 2.3 — one tray controller per window (same lifetime as the feed/reducer/tracker/
    // notifier). Default DI seams = the real Electron Tray + nativeImage painter; a headless box
    // (Tray unsupported / paint throws) degrades to a working no-op (never-crash, AC-8). It paints
    // the live needs-you+idle count; NO click-to-summon (badge + menu only — AC-4); minimal Quit
    // menu (basic app.quit(), NO Epic-4 Quit-guard, NO Story-2.4 sound toggle — AC-5).
    const tray = createTrayController({
      // never-log-the-value: a `code=` ONLY, never a session value (Guardrail #6).
      log: (message) => console.warn(message)
    })
    trays.set(wc, tray)
    // Attention reminders (spec 2026-09-10) — while a LAUNCHED session stays blocked on a
    // permission prompt or a question, re-notify up to `reminderCount` times with doubling gaps.
    // Fed every delta from handleDelta below; disposed in teardownWatchFeed. Settings are read
    // live, so a change in the Settings panel applies without a restart.
    const reminders = createAttentionReminders({
      getSettings: () => getSettingsStore()?.get() ?? DEFAULT_SETTINGS,
      getSession: (id) => reducer.snapshotMap().get(id),
      // F1 (final-review fix wave) — extracted to reminderSink.ts so the launched gate, the
      // ReminderInput shape and the validate-at-source send are exercised by a real test instead
      // of a copy of this body living only in the pipeline test's fixture.
      remind: createReminderSink({
        isLaunched: (id) => launchedSet.has(id),
        isViewing,
        notifier,
        send: (payload) => wc.send(CH.attentionReminder, payload),
        isDestroyed: () => wc.isDestroyed(),
        // never-log-the-parsed-value: id + code only.
        log: (message) => console.error(message)
      }),
      // never-log-the-parsed-value: id + code only.
      log: (message) => console.warn(message)
    })
    reminderSchedulers.set(wc, reminders)
    // Rules (spec §2) — one engine per window, the same lifetime as this window's reducer (§2.6). It
    // reads the column edge from the tracker (handleDelta passes before/after via runDeltaPipeline)
    // and writes tags back through the same handleDelta chokepoint (setTags → handleDelta), so a
    // rule's tag write ships as its OWN LATER session.updated, never bundled into the delta that
    // triggered it. `handleDelta` is a hoisted `function` declaration (below), so referencing it here
    // — before its textual position — is safe: this callback only ever RUNS once a rule actually
    // fires, well after registerWatchFeed's synchronous body (and handleDelta's declaration) ran.
    const rulesEngine = createRulesEngine({
      getRules: rulesSnapshot,
      getSession: (id) => reducer.snapshotMap().get(id),
      columnOf: (id) => tracker.columnOf(id),
      enteredColumnAt: (id) => tracker.enteredColumnAt(id),
      setTags: (sessionId, tagIds) => {
        reducer.setTags(sessionId, tagIds).forEach(handleDelta)
      },
      // never-log-the-parsed-value: id + code only.
      log: (message) => console.warn(message)
    })
    ruleEngines.set(wc, rulesEngine)
    // Hook-status feature — extract the onDelta body into a named handleDelta so that
    // hook deltas can route through the SAME chokepoint (same enrich/column/tray/attention
    // treatment). The spec requires this extraction: hook events call
    // reducer.applyHookStatus(...).forEach(handleDelta) — same path, no new channel.
    // The transcript tail (see demoteOnInterrupt below). Declared BEFORE handleDelta, which closes
    // over it through `tracking` — the same temporal-dead-zone reason as `apiHub` above. Kept in
    // `transcriptWatchers` so teardownWatchFeed disposes it with the window (R13).
    const transcriptWatcher = createTranscriptWatcher({
      onSignal: (sessionId) => {
        demoteOnInterrupt(sessionId, 'transcript_interrupt')
      }
    })
    transcriptWatchers.set(wc, transcriptWatcher)
    const tracking: SessionTrackingDeps = {
      watcher: transcriptWatcher,
      log: (line) => console.log(line),
      warn: (line) => console.warn(line)
    }

    function handleDelta(delta: ReducerWatchEventsPayload): void {
      // A removed session's tail is dead weight — drop them here, the one
      // chokepoint EVERY removal passes through (hook SessionEnd, in-app Stop, pty exit, and the
      // old id of a `/clear` rebind, which adoptCard removes directly).
      if (delta.event.type === 'session.removed') {
        forgetSession(delta.event.id, tracking)
        livePastSessions.onRemoved(delta.event.id)
      } else if (delta.event.type === 'session.updated' && launchedSet.has(delta.event.id)) {
        const session = reducer.snapshotMap().get(delta.event.id)
        if (session !== undefined) livePastSessions.onSession(session)
      }
      if (wc.isDestroyed()) return
      // Rules (spec §2.2) — runDeltaPipeline (rules/deltaPipeline.ts) owns the column-edge order
      // the rules engine depends on: read `tracker.columnOf(id)` BEFORE `tracker.onDelta` sees this
      // delta, let the tracker see it (mutates its column map, returns any attention.raised for the
      // edge), read the column AFTER, `ship` the delta (unchanged Story-1.2..3.3 behavior below),
      // and ONLY THEN run the rules engine's afterDelta — pinned by deltaPipeline.test.ts, since
      // index.ts itself is not importable by any test.
      runDeltaPipeline(delta, {
        columnOf: (id) => tracker.columnOf(id),
        onTrackerDelta: (d) => tracker.onDelta(d, reducer.snapshotMap()),
        ship: (raisedEvents) => {
          // Attention reminders — start / keep / cancel this session's reminder series off the SAME
          // delta (every status change and removal passes through here). Never throws.
          reminders.onDelta(delta)
          // Story 3.2 (FR-11) — attempt the Tgid correlation join for the not-yet-correlated app
          // launches against the POST-delta reducer snapshot, on the SAME synchronous tick (F4 —
          // the onDelta path already runs per delta with the current snapshotMap; no new polling
          // loop). This RE-RESOLVES the Tgid each time (the reported pid wanders — never cached)
          // and adds a landed join's session id to the launched-set. It NEVER throws (fail-closed
          // throughout) and is independent of the board ship below — a correlation failure never
          // blocks a delta. The launch service is null until app-ready constructs it (a race during
          // startup is a no-op). It CONSUMES the reducer's already-parsed Session map (parse-once;
          // never re-parses JSON).
          getLaunchService()?.correlateAgainst(reducer.snapshotMap().values())
          // Story 2.3 — recompute the tray badge off the POST-delta reducer map on the SAME tick,
          // for EVERY delta type (session.updated can raise/lower the count via a column change;
          // session.removed lowers it when the removed session was in needs-you). The badge counts
          // needs-you ONLY (Jose 2026-06-19 / UX-DR3) — idle/working never count. Recompute-from-
          // truth (cheap, can't drift) rather than incrementally diff; the controller no-ops when
          // the count is unchanged. Derives from the SAME snapshotMap + columnForStatus the board
          // uses (single source of truth, AC-3). Never throws (never-crash, AC-8).
          // Story 3.3 — narrow the count to LAUNCHED sessions only (the SAME membership source as
          // the board + attention): an external needs-you session never bumps the tray badge (AC-3).
          tray.setCount(computeBadgeCount(reducer.snapshotMap(), (id) => launchedSet.has(id)))
          const outbound = enrichDelta(delta, tracker, reducer.snapshotMap())
          // A `session.updated` whose enrichment failed validate-at-source is DROPPED (the
          // enricher logged it by path+code) — we do not ship a half-formed delta. A
          // `session.removed` (no enrichment) and a passed `session.updated` send as-is —
          // epoch-framed on the SAME CH.watchEvents channel (const, never a string literal).
          // Story 3.3 (FR-1 amended) — the BOARD-SHIP membership gate: ship ONLY launched-set
          // members. An external/Konsole session's delta is NOT sent, so the renderer board store
          // never learns of it and it never becomes a card (AC-2). The gate keys on the stable
          // `id` (NEVER pid). `session.removed` is INSIDE the gate by design: if its id is in the
          // set, the removed delta DOES ship so the card vanishes (edge case (a) — no stranded
          // stale card); if its id was never launched, there was no card to remove anyway.
          if (outbound !== null && shouldShipToBoard(outbound.event, (id) => launchedSet.has(id))) {
            wc.send(CH.watchEvents, outbound)
            // Programmatic API — fan the SAME gated, enriched delta out to any open SSE stream, from
            // inside the same `if` so the two consumers cannot diverge: a session the board never
            // shows (an external, non-app-launched one) never reaches an API client either. The type
            // check is the narrowing to `ApiSessionEvent` — `attention.raised` is an ALERT and is
            // deliberately not on the wire (the status change that raised it rides the
            // `session.updated` the client already gets). The hub never throws (it contains a
            // subscriber that does), so this cannot break the delta path.
            if (
              outbound.event.type === 'session.updated' ||
              outbound.event.type === 'session.removed'
            ) {
              apiHub.emit(outbound.event)
            }
          }
          // Then any attention.raised for the SAME edge, framed with the SAME epoch.
          // Re-check the destroyed window per send: a late event after close is a no-op.
          // Story 3.3 — the ATTENTION emission gate at the SOURCE: only a LAUNCHED session's raise
          // is emitted. Gating BOTH the renderer SEND and notifier.notify() here narrows EVERY
          // attention consumer from ONE place — the renderer never receives an external raise so
          // the SOUND (useAttentionSound, rides CH.watchEvents) and any rail SOURCE (Story 3.4)
          // auto-narrow, and the JUMP-TO-CARD (CH.attentionActivate, pushed from the notifier's
          // onActivate) cannot fire because no notification is ever created. Do NOT add a redundant
          // filter inside any renderer consumer (it would be a second, drift-prone source). The
          // Story-1.2 tracker still COMPUTES attention.raised above (raisedEvents) — only EMISSION
          // is gated here, never the computation, and the frozen AttentionEvent union is NOT
          // reshaped.
          for (const raised of raisedEvents) {
            // UX-13 — no sound and no popup for the session the operator is looking at.
            if (!shouldEmitRaise(raised.id, (id) => launchedSet.has(id), isViewing)) continue
            if (!wc.isDestroyed()) wc.send(CH.watchEvents, { epoch: delta.epoch, event: raised })
            // Story 2.2 — fire the KDE notification 1:1 off this SAME attention.raised (the
            // raisedEvents array is already debounced by the tracker; add NO second debounce).
            // The notifier never throws (never-crash) and only ever sees the tracker's needs-you-
            // entry output, so it never fires on session.updated/removed (AC-2, by construction).
            notifier.notify(raised)
          }
        },
        afterRules: ({ before, after }) => {
          // Rules (spec §2.2) — LAST, after this delta shipped: a rule's tag change goes out as
          // its own session.updated BEHIND the status one, so the renderer sees status first, then
          // tags. That tag delta re-enters here with before === after and runs nothing (T-3: no
          // loops).
          rulesEngine.afterDelta(delta, before, after)
        }
      })
    }

    // Story 6.2 — expose THIS window's upsertLaunched → handleDelta path to the app-global
    // terminal:open handler (the instant-card synthesis at spawn). The synthesized delta flows
    // through the SAME chokepoint as every c9watch/hook delta — tracker (stamps the `working`
    // column for `Connecting`), tray, enrich (EnrichedSessionUpdatedSchema — sessionName/
    // projectPath/pid all present by construction), ship gate (the id is already in the
    // launched-set — mintSpawn added it BEFORE this runs).
    // Name-sync — names waiting to be pushed to claude, keyed by session id. PER-WINDOW, like the
    // reducer and the hook server beside it: session truth is per-window, so a pending rename
    // belongs to the board that owns that session. Written by `renameLaunched`, read-and-cleared
    // by the hook server's response builder.
    const pendingTitles = createPendingTitles()

    /** D-3 — the ONE removal chokepoint for this window. Reads the card BEFORE the reducer drops
     *  it, then hands the reason → history decision to the PURE, unit-tested
     *  `applyRemovalReason` (pastSessionRecord.ts): `archive` snapshots it into the past-sessions
     *  store (a card that already left is a quiet no-op — no record, no log); `delete` drops any
     *  record for the id instead. Rides the SAME hook-removal reducer path as Story 6.3
     *  (applyHookStatus removed → handleDelta), so the card-removal delta is unchanged — only the
     *  store side-effect is new. */
    function removeLaunchedSession(sessionId: string, reason: RemovalReason): void {
      const stored = reducer.snapshotMap().get(sessionId)
      applyRemovalReason(reason, sessionId, stored, getPastSessionsStore(), Date.now())
      // A removed card can have no pending rename to push.
      pendingTitles.forget(sessionId)
      reducer.applyHookStatus(sessionId, { kind: 'removed' }).forEach(handleDelta)
    }

    launchBoardSeams.set(wc, {
      upsertLaunched: (session) => {
        reducer.upsertLaunched(session).forEach(handleDelta)
      },
      hasSessionsInWorkspace: (workspaceId) => {
        for (const session of reducer.snapshotMap().values()) {
          if (session.workspaceId === workspaceId) return true
        }
        return false
      },
      hasSession: (sessionId) => reducer.snapshotMap().has(sessionId),
      // Story 6.3 — the fast stop/exit removal rides the HOOK-REMOVAL reducer path (REUSE,
      // not a new reducer API): applyHookStatus(id, removed) deletes the session + emits
      // `session.removed`, and the delta takes the SAME handleDelta chokepoint (tracker →
      // tray → ship gate; the launched-set membership is never revoked, so the removed delta
      // passes the gate and the card vanishes). Idempotent: an already-removed / never-
      // synthesized id emits [] SILENTLY (the reducer's removed-path treats unknown-id as
      // the applyStop-style already-gone no-op), so the belt-and-suspenders SessionEnd hook
      // arriving later is quiet.
      removeLaunched: (sessionId, reason) => removeLaunchedSession(sessionId, reason),
      // ESCAPE-INTERRUPT — the operator pressed Escape, so claude stopped and is sitting at
      // its prompt. Rides the SAME applyHookStatus → handleDelta chokepoint as every other
      // status change. Guarded on an ACTUAL change so a stray Escape (dismissing an
      // autocomplete menu in an already-idle session) emits nothing.
      interruptLaunched: (sessionId) => {
        if (reducer.snapshotMap().get(sessionId)?.status === 'WaitingForInput') return
        demoteOnInterrupt(sessionId, 'interrupt_key')
      },
      keyLaunched: (sessionId, data) => {
        const change = approvalStatusChange(reducer.snapshotMap().get(sessionId)?.status, data)
        if (change === null) return
        console.log(`[claude-watcher][hooks] code=permission_answered_key session=${sessionId}`)
        reducer.applyHookStatus(sessionId, change).forEach(handleDelta)
      },
      // Session-naming A2 — the rename takes the SAME handleDelta chokepoint as every other delta
      // (tracker → tray → enrich → ship gate), so the retitled card reaches the renderer as an
      // ordinary `session.updated`. The tracker does NOT re-stamp `enteredColumnAt` here because the
      // status is unchanged (attention.ts stamps on a COLUMN change only) — the board keeps its
      // order, which is the behavior confirmed during A1 planning.
      // Name-sync — claude is renamed by ANSWERING its next `UserPromptSubmit` POST with this name,
      // pushed once by the hook server, then cleared. Queued only when the card exists (R17).
      renameLaunched: (sessionId, name) => {
        renameLaunchedCard({ reducer, pendingTitles, handleDelta }, sessionId, name)
      },
      // Workspaces — same handleDelta chokepoint as every other seam action; the moved card
      // reaches the renderer as an ordinary `session.updated`. The target workspace's existence is
      // the CALLER's job (the IPC handler below) — this seam trusts it was already checked, exactly
      // like renameLaunched trusts the name was already validated.
      setWorkspaceLaunched: (sessionId, workspaceId) => {
        const stored = reducer.snapshotMap().get(sessionId)
        // T-9 — a workspace's own tags do not exist outside it; global tags travel with the card.
        // Computed HERE (the reducer stays store-free) and applied in the SAME delta as the move.
        const tagIds =
          stored === undefined
            ? []
            : keepVisibleTags(stored.tagIds, workspaceId, (id) => getTagsStore()?.get(id) ?? null)
        const moved = reducer.setWorkspace(sessionId, workspaceId, tagIds)
        moved.forEach(handleDelta)
        // Rules (spec §5) — the new workspace's time rules count from the move; the old ones stop.
        if (moved.length > 0) rulesEngine.onWorkspaceMoved(sessionId)
      },
      seenLaunched: (sessionId) => {
        reducer.markSeen(sessionId).forEach(handleDelta)
      },
      workspaceOf: (sessionId) => reducer.snapshotMap().get(sessionId)?.workspaceId,
      setTagsLaunched: (sessionId, tagIds) => {
        reducer.setTags(sessionId, tagIds).forEach(handleDelta)
      },
      pruneTags: (lookup) => {
        for (const edit of staleTagEdits(reducer.snapshotMap().values(), lookup)) {
          reducer.setTags(edit.sessionId, edit.tagIds).forEach(handleDelta)
        }
      }
    })

    // Programmatic API — THIS window's seam, registered right after the board seam because it is
    // the same stage of the same pipeline exposed sideways: the same reducer map, the same
    // launched-set membership gate, the same tracker column, and the same launch service the
    // `+ New session` popover uses. A card an HTTP client made is indistinguishable from one the
    // operator made, and the API can neither invent session truth nor reach past this seam.
    apiSeams.set(wc, {
      listSessions: () => {
        const out: ApiSession[] = []
        for (const session of reducer.snapshotMap().values()) {
          // The SAME membership gate the board ship uses — an external session is not listable.
          if (!launchedSet.has(session.id)) continue
          const projected = projectApiSession(session, tracker, apiLog)
          // null = not placed in a column yet (benign, the next delta fixes it) or a strict-parse
          // rejection (projectApiSession logged the code). Either way it is not on the wire.
          if (projected !== null) out.push(projected)
        }
        return out
      },
      getSession: (id) => {
        const session = reducer.snapshotMap().get(id)
        if (session === undefined || !launchedSet.has(id)) return null
        return projectApiSession(session, tracker, apiLog)
      },
      onEvent: (cb) => apiHub.onEvent(cb),
      // Main REGISTERS the launch recipe and asks the renderer to open the terminal; the renderer's
      // open is what actually spawns the pty and mints the session id. Nothing about the request is
      // the renderer's own: the label and the workspace are main's.
      requestLaunch: (req) => {
        const launchService = getLaunchService()
        if (launchService === null) throw new Error('launch service not initialized')
        const { terminalId } = launchService.launch(req)
        // The template's own scope when it has one (resolved by the command), else main's active
        // workspace — the same value `terminal:open` stamps on the synthesized card.
        const workspaceId = req.workspaceId ?? requireWorkspacesStore().activeId()
        // Validate AT SOURCE before the push (main→renderer delta; zod-boundaries.md). `label` is
        // caller-supplied content, so a miss logs PATH + CODE only — never the value. The launch is
        // already registered at this point: dropping the push loses the terminal, not the recipe,
        // and the create then answers 504 rather than opening a terminal nobody asked for.
        const r = LaunchRequestedSchema.safeParse({ terminalId, label: req.name, workspaceId })
        if (!r.success) {
          const issue = r.error.issues[0]
          console.error(
            `[claude-watcher][api] dropped launch:requested path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
          )
        } else if (!wc.isDestroyed()) {
          wc.send(CH.launchRequested, r.data)
        }
        return { terminalId, workspaceId }
      },
      // The bind lands when the renderer opens the terminal and `mintSpawn` runs. A missing launch
      // service rejects with the SAME error the timeout uses, so the command answers 504 either way
      // rather than leaking a second failure mode a caller cannot act on.
      awaitSessionId: (terminalId, timeoutMs) => {
        const launchService = getLaunchService()
        if (launchService === null) return Promise.reject(new Error('spawn_timeout'))
        return launchService.awaitBinding(terminalId, timeoutMs)
      }
    })

    // Hook-status feature — start the localhost HTTP hook listener. Hook events route through
    // handleDelta (same chokepoint as c9watch deltas). onHookEvent maps the event name to a
    // HookStatusChange and dispatches applyHookStatus → handleDelta.
    // Session-rebind PART 2 — re-key this window's card from an orphaned launch's OLD session id
    // to the NEW one claude now reports. Returns true when the card was adopted (the caller then
    // applies the incoming status against the new id as normal).
    //
    // ORDER IS LOAD-BEARING: create the new card and re-bind BEFORE dropping the old one. A live
    // launched terminal with no card is exactly what the renderer renders as "Starting"
    // (boardStore `selectStartingTerminals`) — the symptom this whole change exists to kill — so
    // the terminal must never be card-less, not even for one delta.
    //
    // The old id is deliberately LEFT in the launched-set: the set has no delete, membership is a
    // per-run board-eligibility gate, and the old card is gone anyway (a stale member gates nothing).
    function adoptOrphanedCard(cwd: string, newSessionId: string): boolean {
      const launchService = getLaunchService()
      const terminalManager = getTerminalManager()
      if (launchService === null || terminalManager === null) return false
      const service = launchService
      const terminals = terminalManager
      // SEC-1: a non-UUID id is refused before either proof (findAdoptionTarget). PART 2b first —
      // the EXACT proof: claude's own record says which launched pty now runs this id. Needs no
      // orphan record, so it also rescues a card whose SessionEnd came late, never came, or came
      // longer than the heuristic's window ago. Fallback — the cwd + single-match + alive + window
      // heuristic (a claude without records).
      const target = findAdoptionTarget(
        newSessionId,
        {
          byProcess: () =>
            claimByProcess(newSessionId, service.bindings(), terminals, processSessions),
          byOrphan: () => orphanRegistry.claim(cwd, Date.now(), terminals),
          // Card shell pane — a claude the operator runs in a card's shell is never that card.
          byCompanion: () =>
            namedByShellPane(
              newSessionId,
              getShellCompanions()?.terminalIds() ?? [],
              terminals,
              processSessions
            )
        },
        (message) => console.warn(message)
      )
      if (target === null) return false
      return adoptCard(target.terminalId, target.sessionId, newSessionId, target.proof)
    }

    /** Re-key a live launched terminal's card from `oldSessionId` to `newSessionId`. Shared by
     *  both proofs; `proof` only labels the log line. Reached ONLY through `findAdoptionTarget`,
     *  which has already refused a non-UUID id (SEC-1). */
    function adoptCard(
      terminalId: string,
      oldSessionId: string,
      newSessionId: string,
      proof: 'pid' | 'cwd'
    ): boolean {
      const launchService = getLaunchService()
      if (launchService === null) return false
      const stored = reducer.snapshotMap().get(oldSessionId)
      if (stored === undefined) {
        // The card left by another path (stop/exit) — any orphan record is stale, drop it.
        orphanRegistry.clear(terminalId)
        return false
      }
      // Main-owned data reshaped by main (parse-once boundary: never re-run through SessionSchema).
      // Workspaces — `{ ...stored, id: newSessionId }` already carries `workspaceId` (it is on
      // `stored`, a full `Session`), so the rebound card keeps its workspace with no extra code.
      launchedSet.add(newSessionId)
      reducer.upsertLaunched({ ...stored, id: newSessionId }).forEach(handleDelta)
      launchService.rebind(terminalId, newSessionId)
      // D-10 — a rename waiting for the next prompt follows the card to its new id, or the next
      // prompt's read-back reverts it to claude's stale title (pendingTitles.ts `rebind`).
      pendingTitles.rebind(oldSessionId, newSessionId)
      sendLaunchCorrelated(wc, terminalId, newSessionId)
      // R8 — tell an API stream on the OLD id where the card went, BEFORE its removal: the stream
      // ends on `session.rebound {newId}` and never reports the rebind as `session.removed`. The new
      // id is already on the board (upserted above), so a client that re-subscribes finds it. The old
      // id was a launched card, so this passes the same board-ship membership the deltas do.
      apiHub.emit({ type: 'session.rebound', id: oldSessionId, newId: newSessionId })
      reducer.applyHookStatus(oldSessionId, { kind: 'removed' }).forEach(handleDelta)
      orphanRegistry.clear(terminalId)
      // PATH + CODE only — never the cwd (leaks the filesystem layout) or any hook field.
      console.warn(`[c9watch][hooks] path=(hook) code=hook_session_id_rebound proof=${proof}`)
      return true
    }

    // The transcript tail — the ONE fact no Claude Code hook reports: an Esc interrupt.
    //
    // Probe-verified twice (claude 2.1.250, both `command` and `http` hooks): pressing Esc
    // fires no hook of any kind, and no idle notification follows even after 90 seconds.
    // Claude does record it in its own session transcript the instant it happens, so the
    // app tails that file.
    //
    // (Background work needs nothing here — the `Stop` payload reports it directly in
    // `background_tasks`; see hooks/backgroundTasks.ts.)
    /**
     * The ONE way an interrupt demotes a card. Both interrupt detectors land here — the Esc
     * KEYSTROKE seen on the pty, and the `[Request interrupted by user]` marker the transcript
     * tail finds — so the rule below cannot drift between them.
     *
     * The rule: an interrupt always demotes to idle, background work or not. It used to keep
     * the card on `Working` while the last `Stop` said work was running, and a task that never
     * ends (a dev server) then held it there forever, Esc included (R5). A turn end with work
     * running is still `Working` (hookStatus.ts); an interrupt is the operator's own key,
     * so it is the calm column. If claude later wakes on the task's completion, that turn's own
     * hooks move the card again.
     */
    function demoteOnInterrupt(sessionId: string, code: string): void {
      // Claude is now sitting at its prompt waiting, and the operator is the one who
      // pressed the key — so this is idle-by-truth: the calm column, no notification.
      console.log(`[c9watch][hooks] code=${code} session=${sessionId}`)
      reducer
        .applyHookStatus(sessionId, { kind: 'status', status: 'WaitingForInput' })
        .forEach(handleDelta)
    }

    const hookServer = createHookServer({
      onHookEvent: (evt) => {
        // Name-sync READ-BACK — claude's own name for the session, reported on every
        // `UserPromptSubmit`. This runs BEFORE the status mapping (and before its unknown-event
        // early return) because a name correction must not depend on the event also producing a
        // status change. CLAUDE is the authority on its own name: it may differ from what we
        // asked for because a live-name collision made claude add a suffix, because the operator
        // typed `/rename` in the terminal, or because accepting a plan retitled the session.
        // Only rename on a REAL difference — `renameSession` emits a `session.updated`
        // unconditionally, so comparing first is what keeps every prompt from shipping a
        // redundant delta. Never log `session_title` (operator content).
        // `pendingTitles.has` is NON-consuming: the server consumes the title AFTER this
        // callback returns, when it builds the response. A pending push means the incoming
        // `session_title` predates that push and must not be believed.
        const readBack = titleReadBackRename(
          evt,
          reducer.snapshotMap().get(evt.session_id)?.sessionName,
          pendingTitles.has(evt.session_id)
        )
        if (readBack !== null) {
          reducer.renameSession(evt.session_id, readBack).forEach(handleDelta)
        }

        const change = hookStatus(evt)

        // Session-rebind PART 2 — an UNKNOWN id posting a status may be that same pty under its
        // new id. Adopt only under sessionRebind.ts's narrow proof; anything looser would put an
        // external session on the board (Story 3.3 ship gate). A miss falls through to the
        // unchanged `hook_unknown_id` no-op below. Runs BEFORE the tracking gate, so a session
        // under its new `/clear` id is known by then and keeps its transcript tail.
        if (change?.kind === 'status' && !reducer.snapshotMap().has(evt.session_id)) {
          adoptOrphanedCard(evt.cwd ?? '', evt.session_id)
        }

        // Tail the transcript and record the background verdict — for a KNOWN id only (SEC-2:
        // an unknown POST must not grow a watcher; SEC-3: its raw id is never logged). Runs
        // before the unknown-event return, so an event we do not map still records its verdict.
        trackHookEvent(evt, reducer.snapshotMap().has(evt.session_id), tracking)
        // UX-08 — the record learns where claude keeps this conversation, so Open can tell when
        // claude has since deleted it. Known, launched ids only (the same gate as the tail).
        const knownSession = reducer.snapshotMap().get(evt.session_id)
        if (
          knownSession !== undefined &&
          launchedSet.has(evt.session_id) &&
          evt.transcript_path !== undefined
        ) {
          livePastSessions.notePath(knownSession, evt.transcript_path)
        }

        if (change === null) return // unrecognized event — ignore

        // Session-rebind PART 1 — removal is STOP/EXIT-driven (CLAUDE.md); this hook is only
        // belt-and-suspenders. A SessionEnd for a session whose pty is STILL ALIVE is therefore
        // not a removal at all — it is claude changing its own session id mid-run. Keep the card
        // and remember the terminal so the new id can adopt it below.
        const launchService = getLaunchService()
        const terminalManager = getTerminalManager()
        if (change.kind === 'removed' && launchService !== null && terminalManager !== null) {
          const keptTerminalId = sessionEndKeepsCard(evt.session_id, launchService, terminalManager)
          if (keptTerminalId !== null) {
            orphanRegistry.mark({
              terminalId: keptTerminalId,
              sessionId: evt.session_id,
              cwd: evt.cwd ?? '',
              orphanedAt: Date.now()
            })
            // PATH + CODE only — never the cwd or any hook field.
            console.warn('[c9watch][hooks] path=(hook) code=hook_sessionend_pty_alive')
            return
          }
        }

        // Past sessions (D-3) — a SessionEnd that reaches here (the pty-alive guard above did NOT
        // keep the card) is a real removal: archive it, belt-and-suspenders behind Stop/exit. Rides
        // the SAME removeLaunchedSession chokepoint as terminal:stop/onExit/the explicit exits.
        if (change.kind === 'removed') {
          removeLaunchedSession(evt.session_id, 'archive') // belt-and-suspenders, idempotent
          return
        }
        reducer.applyHookStatus(evt.session_id, change).forEach(handleDelta)
      },
      // Name-sync WRITE — read-and-clear, so the name is pushed to claude exactly ONCE. Pushing
      // it every prompt would fight claude's collision rule and re-suffix the name forever
      // (see pendingTitles.ts).
      takePendingTitle: (sessionId) => {
        const name = pendingTitles.take(sessionId)
        // D-11 — the push is on its way in this response; the ⟳ mark comes off the card now.
        if (name !== null) reducer.clearNameSyncPending(sessionId).forEach(handleDelta)
        return name
      },
      log: (err) => console.warn(`[c9watch][hooks] dropped hook path=${err.path} code=${err.code}`),
      // SEC-6 / UX-05 — only a bind THIS process made lets a spawn carry `--settings`.
      onListening: () => serverHealth.hookBound(),
      onError: (errno) => serverHealth.hookFailed(errno)
    })
    hookServers.set(wc, hookServer)

    // Story 6.4 — ENGINE START (the c9watch feed is retired; nothing is spawned here).
    //
    // (1) The Story-5.3 COLD-LOAD-COMPLETE contract: the renderer skeleton clears on the
    //     one-time `CH.watchStatus { reconnecting: false }` push. Emit that same signal at
    //     engine start, validated AT SOURCE (zod-boundaries.md: main→renderer = validate
    //     at source; CH.* const, never a literal). `reconnecting: true` is never sent
    //     anymore (there is no watch child to lose) — the channel + payload types stay;
    //     the renderer consumes the push purely as the cold-load signal.
    //
    //     TIMING: the retired feed emitted this after `await c9watch list` — a real async
    //     gap that let the renderer's onStatus subscription (a React effect, mounted just
    //     after first paint / 'ready-to-show') attach first. Preserve an equivalent gap:
    //     defer the emit a tick, then re-emit once after a short beat as belt-and-
    //     suspenders — the consumer is idempotent (`setReconnecting(false)` on an
    //     already-cold-loaded store is a no-op), so the repeat can never flap the UI,
    //     while a lost first emit can strand the skeleton forever.
    const emitEngineStarted = (): void => {
      if (wc.isDestroyed()) return
      const r = WatchStatusSchema.safeParse({ reconnecting: false })
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][engine] dropped watch:status path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.watchStatus, r.data)
    }
    setTimeout(emitEngineStarted, 0)
    setTimeout(emitEngineStarted, ENGINE_STARTED_RESEND_MS)

    // (2) Story 2.3 — seed the initial tray badge. At cold start the launched-set is
    //     empty (nothing launched yet), so this is 0 — the empty board is the NORMAL
    //     cold state (FR-1 amended / F5). Same membership source as the board (Story 3.3).
    tray.setCount(computeBadgeCount(reducer.snapshotMap(), (id) => launchedSet.has(id)))
  }

  // Drop a window's session-engine registries (tray/tracker/reducer/board seam) and
  // close its hook listener. Idempotent. Called on window close. (The name predates the
  // Story-6.4 CLI retirement — there is no feed to stop anymore.)
  function teardownWatchFeed(wc: Electron.WebContents): void {
    // Story 2.3 — destroy the per-window tray controller (no leaked Tray). Idempotent + never
    // throws; safe to run even if the feed below is absent.
    const tray = trays.get(wc)
    if (tray) {
      trays.delete(wc)
      tray.destroy()
    }
    // Attention reminders — clear every armed reminder timer so none fires into a closed window.
    const reminders = reminderSchedulers.get(wc)
    if (reminders) {
      reminderSchedulers.delete(wc)
      reminders.dispose()
    }
    // Rules — clear every armed time-rule timer so none fires into a closed window.
    const rulesEngine = ruleEngines.get(wc)
    if (rulesEngine) {
      ruleEngines.delete(wc)
      rulesEngine.dispose()
    }
    focusedTerminals.delete(wc)
    // Story 3.5 (SM-2) — remove the per-window tracker reference (same lifetime as the feed).
    // The telemetry IPC handler will see no tracker for a destroyed window → graceful no-op.
    trackers.delete(wc)
    // Story 4.2 (FR-14) — remove the per-window reducer reference (ARCH-FORK-1 option A).
    // Same lifetime as the feed; mirrors the trackers.delete above.
    reducers.delete(wc)
    // Story 6.2/6.3 — remove the per-window launch board seam (same lifetime as the feed).
    // A terminal:open/stop racing a window close finds no seam → graceful no-op.
    launchBoardSeams.delete(wc)
    // Programmatic API — drop this window's seam (the listener then answers `no_window`) and clear
    // its hub, so a subscriber can never be notified for a board that is gone. The open SSE streams
    // themselves end when the server closes or when their client goes; clearing is what stops them
    // hearing from a window that no longer exists in between.
    apiSeams.delete(wc)
    const apiHub = apiHubs.get(wc)
    if (apiHub) {
      apiHubs.delete(wc)
      apiHub.clear()
    }
    // Hook-status feature — close the per-window hook listener so a window close→reopen
    // ('activate') or dev HMR reload does not leak the listener and hit EADDRINUSE on the
    // next bind. Idempotent; close() never throws.
    const hookServer = hookServers.get(wc)
    if (hookServer) {
      hookServers.delete(wc)
      hookServer.close()
      serverHealth.hookClosed()
    }
    // Stop every transcript tail so no fs watch outlives the window. Idempotent, never throws.
    const watcher = transcriptWatchers.get(wc)
    if (watcher) {
      transcriptWatchers.delete(wc)
      watcher.dispose()
    }
  }

  return { registerWatchFeed, teardownWatchFeed }
}

/** Story 6.4 — the one guarded re-emit of the cold-load-complete signal (see above). */
const ENGINE_STARTED_RESEND_MS = 1_000
