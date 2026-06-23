import { app, shell, BrowserWindow, ipcMain, MessageChannelMain, dialog } from 'electron'
import type { MessagePortMain } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as os from 'os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import icon from '../../resources/icon.png?asset'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type {
  PtyResizeRequest,
  SmokeReport,
  TerminalPortMainMessage,
  TerminalPortRendererMessage
} from '../shared/ipc/contract'
// Story 3.1 (FR-10) — the embedded-terminal transport: the MAIN-side terminal manager (one
// node-pty per terminal behind the ptyFactory DI seam + the validated, flow-controlled
// MessagePort byte path) + its cross-process IPC-arg schemas (parse-and-throw at the boundary).
import { createTerminalManager, type PortLike, type TerminalManager } from './pty/terminalManager'
import {
  TerminalOpenSchema,
  TerminalResizeSchema,
  TerminalStopSchema,
  TerminalExitSchema
} from '../shared/schemas/terminal'
// Story 1.4 fix — validate-at-source for the watch:status connection-state push.
// Story 2.2 — validate-at-source for the FR-9 attention:activate push.
import { WatchStatusSchema, AttentionActivateSchema } from '../shared/schemas/watchDelta'
// Story 2.2 — the KDE attention notifier (Electron Notification → libnotify), behind a DI
// seam. Fires 1:1 off the tracker's attention.raised; informational only (NO self-raise).
import { createAttentionNotifier } from './kde/notifications'
// Story 2.3 — the tray + PAINTED-badge controller (behind a DI seam, mirrors the notifier) +
// the pure badge-count fn. The count = needs-you + idle, derived from the SAME reducer map +
// columnForStatus the board uses (single source of truth). Tray is badge + menu only (NO
// self-raise); never-crash if the tray/display is unavailable.
import { createTrayController, type TrayController } from './kde/tray'
import { computeBadgeCount } from './kde/badge'
// Story 1.4 — validate-at-source enrichment of the session.updated delta (extracted
// to its own module so it stays unit-testable without pulling electron/node-pty).
import { enrichDelta } from './c9watch/enrichDelta'
// Story 3.3 (FR-1 amended) — the BOARD-SHIP membership gate (pure; reads only the event id +
// the launched-set predicate). Drops external/Konsole deltas at the ship chokepoint so the
// board shows ONLY app-launched sessions. Kept in its own pure module for unit coverage.
import { shouldShipToBoard } from './c9watch/shipGate'
// Story 1.1 — the c9watch adapter: feed (spawn + NDJSON line-split + reconnect) +
// reducer (Zod-validate → Map<id,Session> + list seed/reconcile + epoch).
import { createReducer } from './c9watch/reducer'
import { createFeed, type Feed } from './c9watch/feed'
// Story 1.2 — the column-transition tracker: consumes each reducer delta + the
// reduced map, emits attention.raised on a needs-you ENTRY edge (cold-start
// suppressed / reconnect re-raised), stamps time-entered-column, debounces flaps.
import { createAttentionTracker, type AttentionTracker } from './c9watch/attention'
// Story 2.4 — the app-global settings store (electron-store in MAIN, behind a DI seam) +
// its versioned-Zod payload schema. The store is constructed ONCE (settings are app-global,
// NOT per-window like the feed/tray) and registered on the typed CH.settingsGet/Set channels.
// The renderer reads/writes via window.settings.* — never electron-store directly (F4).
import { createSettingsStore, type SettingsStore } from './persistence/settings'
import { createElectronSettingsBlobStore } from './persistence/electronSettingsBlobStore'
import { SettingsPatchSchema } from '../shared/schemas/settings'
// Story 3.2 (FR-11) — the in-app LAUNCH flow built ON TOP of the Story-3.1 terminal: the raw
// `claude` launch service (reuses the terminal manager + ptyFactory; reuses pidCorrelation.ts
// for the Tgid join) + the per-run launched-set it POPULATES. The picked dir + launch request
// are UNTRUSTED cross-process input → Zod parse-and-throw at the boundary (never log the path).
import { createLaunchService, type LaunchService } from './pty/launchSession'
import { createLaunchedSet, type LaunchedSet } from './pty/launchedSet'
import { readStatusFromProc } from './pty/pidCorrelation'
import { SessionLaunchSchema, LaunchCorrelatedSchema } from '../shared/schemas/launch'
// Story 3.5 (SM-2) — the append-only JSONL telemetry store (DI-seam'd, never-crash) +
// the REAL fs-backed line store (Electron-touching; injected from here — keeps telemetry.ts
// Electron-free + unit-testable). The Zod arg schema for the telemetry:acknowledge IPC arg.
import { createTelemetryStore, type TelemetryStore } from './persistence/telemetry'
import { createFsTelemetryLineStore } from './persistence/fsTelemetryLineStore'
import { TelemetryAcknowledgeSchema, TELEMETRY_VERSION } from '../shared/schemas/telemetry'
// Story 4.1 (FR-13) — centralized clean teardown (SM-3 = 0 orphans). Extracted for
// unit coverage (mirrors shipGate.ts precedent). Wired on `before-quit` so EVERY quit
// path (app.quit(), window-all-closed → app.quit(), tray Quit) tears down owned sessions.
// B-1/M-2: stop PTYs EXPLICITLY IN MAIN (terminalManager.destroyAll → port.close THEN
// pty.kill) — NEVER via an incidental renderer unmount. See App.tsx ~199-203 (M-2 latch
// WARNING) and App.launch.test.tsx (the B-1 guardrail that MUST stay green).
import { teardownAllSessions } from './lifecycle/teardownAllSessions'
// Story 4.2 (FR-14) — the Quit-guard: liveness compute + cancel-safe decision helper.
// The before-quit is REFACTORED from the 4-1 unconditional teardown into guard-then-teardown
// in ONE handler (FROZEN #1: cancel-must-not-kill). The liveness compute is the same
// launched-set ∩ reducer-map ∩ columnForStatus triple the badge uses (single source of truth).
import {
  computeLiveLaunchedSessions,
  type ReducerLike
} from './lifecycle/computeLiveLaunchedSessions'
import {
  handleBeforeQuit,
  handleQuitConfirm,
  handleQuitCancel,
  type QuitGuardState
} from './lifecycle/quitGuard'
import { QuitGuardPayloadSchema } from '../shared/schemas/quitGuard'
import type { QuitGuardPayload } from '../shared/ipc/contract'

// Smoke mode (Story 0.1 AC-3): when C9_SMOKE=1, the renderer runs a scripted
// type -> read-back -> resize -> TUI sequence and reports a JSON verdict, which
// we persist to C9_SMOKE_OUT (or stdout) and then exit. This makes the packaged
// exit gate machine-verifiable in a headless/autonomous run.
const SMOKE = process.env.C9_SMOKE === '1'
const SMOKE_OUT = process.env.C9_SMOKE_OUT || ''

// --- Story 0.1 spike: single dedicated PTY forwarder ---------------------------
// THIS STORY ONLY: a single PTY streamed to the renderer over a minimal IPC
// channel. The full MessagePort + flow-control + DI-seam transport is Epic-3 /
// Story 0.2 work and is intentionally NOT built here.
//
// Channels:
//   renderer -> main : 'pty:start'  ()               request the PTY
//   renderer -> main : 'pty:input'  (string)         keystrokes
//   renderer -> main : 'pty:resize' ({cols, rows})   resize
//   main -> renderer : 'pty:data'   (string)         pty output bytes
//   main -> renderer : 'pty:exit'   ({exitCode})     pty exited
const SHELL = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')

// Per-window PTY registry. IPC handlers are registered ONCE at module scope (see
// registerPtyIpc) and dispatch by `event.sender` so a second window from
// `app.on('activate')` neither throws (duplicate ipcMain.handle) nor accumulates
// stacked ipcMain.on listeners (Review F1). [Story 0.1 single-PTY spike]
const ptys = new Map<Electron.WebContents, IPty>()

// Story 3.1 (FR-10) — the ONE terminal manager. Embedded terminals are app-global like the
// settings store (NOT window-scoped like the feed): the manager keys terminals by an opaque
// terminalId and dispatches per-terminal, so it does not need per-window instances. It is
// INDEPENDENT of both the PTY spike registry (`ptys`) and the feed registry (`feeds`) — a
// c9watch watch reconnect must NEVER touch the PTY ports (architecture.md:568; the feed and
// terminal transports are separate). Constructed in registerTerminalIpc (after app-ready).
let terminalManager: TerminalManager | null = null

// Story 3.1 — which window opened each terminalId, so a dead-terminal push (onExit) routes to
// the right renderer. Populated on terminal:open, consulted + pruned on exit/stop. A window
// close prunes its terminals (teardownWindowTerminals). Keyed by the opaque terminalId (F6).
const terminalOwners = new Map<string, Electron.WebContents>()

// Story 3.2 (FR-11) — the in-app LAUNCH flow. The launch SERVICE spawns raw `claude` under the
// REUSED terminal manager (file/cwd override) and runs the Tgid correlation join (REUSING
// pidCorrelation.ts), POPULATING the per-run LAUNCHED-SET. Both are app-global (like the
// terminal manager + settings store — keyed by the stable session id / opaque terminalId, NOT
// per-window). Constructed after app-ready (so the terminal manager exists). The launched-set is
// born here; Story 3.3 CONSUMES it as the board+attention filter — 3.2 does NOT yet filter on it
// (the board still shows all sessions). [Source: story 3.2 Tasks 2/3/4; F5]
const launchedSet: LaunchedSet = createLaunchedSet()
let launchService: LaunchService | null = null

// Story 1.1 — the live c9watch feed → reducer → renderer wiring. ONE feed per
// window; the feed pushes validated session deltas (frozen `session.updated`/
// `session.removed`, epoch-framed) over CH.watchEvents. The feed is INDEPENDENT of
// the PTY registry above — a watch reconnect must never touch PTY state.
const feeds = new Map<Electron.WebContents, Feed>()

// Story 2.3 — one tray controller per window (same lifetime as the feed/reducer/tracker/
// notifier). It mirrors the live needs-you+idle count onto the OS tray icon (PAINTED badge,
// NOT app.setBadgeCount). Constructed in registerWatchFeed, fed the recomputed count on every
// delta + after the seed, destroyed in teardownWatchFeed. A tray/paint failure degrades to a
// no-op and never touches the feed (never-crash).
const trays = new Map<Electron.WebContents, TrayController>()

// Story 3.5 (SM-2) — one tracker reference per window, stored here so the app-global
// telemetry IPC handler can look up `tracker.columnOf(id)` + `tracker.enteredColumnAt(id)`
// when the acknowledge lands. SAME lifetime as the feed (constructed in registerWatchFeed,
// removed in teardownWatchFeed). The tracker is created inside registerWatchFeed; we just
// keep a reference here for the IPC handler's access pattern. [story 3.5 Task 4.1 / FROZEN-3]
const trackers = new Map<Electron.WebContents, AttentionTracker>()

// Story 4.2 (FR-14) — app-global reducer registry (ARCH-FORK-1 option A).
// Mirrors the existing `trackers` map (same lifetime: set in registerWatchFeed, deleted in
// teardownWatchFeed). The quit handler reads `reducer.snapshotMap()` via this map to compute
// the live session count without restructuring registerWatchFeed. Single source of truth
// (state.md): the reducer remains the authority; this is just a registry handle. The telemetry
// handler ALREADY reads the app-global `trackers` map (index.ts ~534) — this is the same pattern.
const reducers = new Map<Electron.WebContents, ReducerLike>()

// Story 4.2 (FR-14) — mutable quit-guard state (owned at app scope; one app, one guard).
// Initialized here so the before-quit handler, quitConfirm, and quitCancel all share ONE state.
// isQuitting flips true ONLY when a real quit proceeds (guard passed / nothing-live).
// pendingGuard is true while the operator is viewing the Quit-guard modal.
const quitGuardState: QuitGuardState = { isQuitting: false, pendingGuard: false }

// Smoke mode is a packaged node-pty exit gate (no c9watch on the box); never spin
// up the live feed there.
function registerWatchFeed(window: BrowserWindow): void {
  if (SMOKE) return
  const wc = window.webContents
  if (feeds.has(wc)) return

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
  // Story 2.2 — one notifier per window (same lifetime as the reducer/tracker/feed). It
  // fires a KDE notification 1:1 off the tracker's attention.raised (no extra debounce — the
  // tracker's per-session ~700ms emission debounce is the sole storm-suppression authority).
  // INFORMATIONAL ONLY: activating the notification emits the FR-9 in-app jump-to-card signal
  // (CH.attentionActivate, validated AT SOURCE) and NEVER raises/focuses the window (AR-8 cut).
  const notifier = createAttentionNotifier({
    onActivate: (id) => {
      if (wc.isDestroyed()) return
      // Validate AT SOURCE before send (renderer-facing delta; zod-boundaries.md). On a bad
      // id, drop + log by PATH + CODE only — never the value (the id is an opaque UUID, but
      // a blank id has no value to leak either). NO window raise anywhere on this path.
      const r = AttentionActivateSchema.safeParse({ id })
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][attention] dropped attention:activate path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      // Re-check the destroyed window per send (mirrors the other sends). CH.* const.
      if (!wc.isDestroyed()) wc.send(CH.attentionActivate, r.data)
    },
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
  const feed = createFeed({
    reducer,
    onDelta: (delta) => {
      if (wc.isDestroyed()) return
      // Story 1.4 ORDERING (re-ordered from 1.2): the tracker MUST process THIS delta
      // BEFORE we enrich+send a `session.updated`, so `tracker.columnOf(id)` /
      // `tracker.enteredColumnAt(id)` reflect this edge. So we run `tracker.onDelta`
      // FIRST (it both updates the tracker's column map AND returns any attention.raised
      // for the edge), THEN enrich the updated delta from the now-current tracker, THEN
      // send. The tracker reads the reducer's current map (parse-once, never re-parsed);
      // SAME SYNCHRONOUS TICK — no await — so snapshotMap() reflects the post-delta state.
      const raisedEvents = tracker.onDelta(delta, reducer.snapshotMap())
      // Story 3.2 (FR-11) — attempt the Tgid correlation join for the not-yet-correlated app
      // launches against the POST-delta reducer snapshot, on the SAME synchronous tick (F4 — the
      // onDelta path already runs per delta with the current snapshotMap; no new polling loop).
      // This RE-RESOLVES the Tgid each time (the reported pid wanders — never cached) and adds a
      // landed join's session id to the launched-set. It NEVER throws (fail-closed throughout) and
      // is independent of the board ship below — a correlation failure never blocks a delta. The
      // launch service is null until app-ready constructs it (a race during startup is a no-op).
      // It CONSUMES the reducer's already-parsed Session map (parse-once; never re-parses JSON).
      launchService?.correlateAgainst(reducer.snapshotMap().values())
      // Story 2.3 — recompute the tray badge off the POST-delta reducer map on the SAME tick,
      // for EVERY delta type (session.updated can raise/lower the count via a column change;
      // session.removed lowers it when the removed session was in needs-you). The badge counts
      // needs-you ONLY (Jose 2026-06-19 / UX-DR3) — idle/working never count. Recompute-from-truth
      // (cheap, can't drift) rather than incrementally diff; the controller no-ops when the
      // count is unchanged. Derives from the SAME snapshotMap + columnForStatus the board uses
      // (single source of truth, AC-3). Never throws (never-crash, AC-8).
      // Story 3.3 — narrow the count to LAUNCHED sessions only (the SAME membership source as the
      // board + attention): an external needs-you session never bumps the tray badge (AC-3).
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
      }
      // Then any attention.raised for the SAME edge, framed with the SAME epoch.
      // Re-check the destroyed window per send: a late event after close is a no-op.
      // Story 3.3 — the ATTENTION emission gate at the SOURCE: only a LAUNCHED session's raise
      // is emitted. Gating BOTH the renderer SEND and notifier.notify() here narrows EVERY
      // attention consumer from ONE place — the renderer never receives an external raise so the
      // SOUND (useAttentionSound, rides CH.watchEvents) and any rail SOURCE (Story 3.4) auto-
      // narrow, and the JUMP-TO-CARD (CH.attentionActivate, pushed from the notifier's
      // onActivate) cannot fire because no notification is ever created. Do NOT add a redundant
      // filter inside any renderer consumer (it would be a second, drift-prone source). The
      // Story-1.2 tracker still COMPUTES attention.raised above (raisedEvents) — only EMISSION is
      // gated here, never the computation, and the frozen AttentionEvent union is NOT reshaped.
      for (const raised of raisedEvents) {
        if (!launchedSet.has(raised.id)) continue
        if (!wc.isDestroyed()) wc.send(CH.watchEvents, { epoch: delta.epoch, event: raised })
        // Story 2.2 — fire the KDE notification 1:1 off this SAME attention.raised (the
        // raisedEvents array is already debounced by the tracker; add NO second debounce).
        // The notifier never throws (never-crash) and only ever sees the tracker's needs-you-
        // entry output, so it never fires on session.updated/removed (AC-2, by construction).
        notifier.notify(raised)
      }
    },
    // Story 1.4 fix — surface the feed's REAL connection state on its own channel
    // (CH.watchStatus). This is the signal the renderer's reconnect banner is driven
    // by (AC-6 / UX-DR17 = a real watch-stream GAP), NOT line silence (a quiet
    // `watch --changes-only` emits 0 lines — silence is the normal steady state).
    // Validate AT SOURCE before send (zod-boundaries.md: main→renderer = validate at
    // source); a malformed status never crosses the seam. CH.* const, never a literal.
    onStatus: (status) => {
      if (wc.isDestroyed()) return
      const r = WatchStatusSchema.safeParse(status)
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][feed] dropped watch:status path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.watchStatus, r.data)
    }
  })
  feeds.set(wc, feed)

  // start() runs the initial `c9watch list` seed then attaches the watch stream. A
  // missing/unrunnable c9watch CLI (e.g. dev box without it) must NOT crash the app
  // (never-crash) — the board simply stays empty until the feed can start.
  feed
    .start()
    .then(() => {
      // Story 2.3 — seed the initial badge AFTER the first `list` snapshot resolves, so the
      // count is correct at cold-start even if the seed produced no deltas (empty board → 0 →
      // plain base icon). The seed deltas already flowed through onDelta above; this is the
      // idempotent post-seed reconcile (the controller no-ops when unchanged). Re-check the
      // window isn't gone by the time the seed resolves.
      // Story 3.3 — narrow the seed count to LAUNCHED sessions too (same membership source). At
      // cold-start the launched-set is empty (nothing launched yet), so this is 0 — the empty
      // board is the NORMAL cold state (FR-1 amended / F5).
      if (!wc.isDestroyed())
        tray.setCount(computeBadgeCount(reducer.snapshotMap(), (id) => launchedSet.has(id)))
    })
    .catch((err) => {
      console.error(
        '[c9watch][feed] failed to start (board will stay empty):',
        err instanceof Error ? err.message : 'unknown'
      )
    })
}

// Stop + drop a window's feed. Idempotent. Called on window close (clean teardown
// via the feed's AbortController — no leaked watch child, no stacked listeners).
function teardownWatchFeed(wc: Electron.WebContents): void {
  // Story 2.3 — destroy the per-window tray controller (no leaked Tray). Idempotent + never
  // throws; safe to run even if the feed below is absent.
  const tray = trays.get(wc)
  if (tray) {
    trays.delete(wc)
    tray.destroy()
  }
  // Story 3.5 (SM-2) — remove the per-window tracker reference (same lifetime as the feed).
  // The telemetry IPC handler will see no tracker for a destroyed window → graceful no-op.
  trackers.delete(wc)
  // Story 4.2 (FR-14) — remove the per-window reducer reference (ARCH-FORK-1 option A).
  // Same lifetime as the feed; mirrors the trackers.delete above.
  reducers.delete(wc)
  const feed = feeds.get(wc)
  if (!feed) return
  feeds.delete(wc)
  feed.stop().catch((err) => {
    console.error(
      '[c9watch][feed] error during teardown:',
      err instanceof Error ? err.message : 'unknown'
    )
  })
}

// Story 4.1 (FR-13) — stop every terminal this window owned (explicit-MAIN teardown).
// Called from the `on('closed')` per-window path AND shared with teardownAllSessions
// (via the clearTerminalOwners dep) so there is ONE teardown contract: always explicit
// in MAIN, never incidental via a renderer unmount (B-1/M-2 hard constraint).
// Idempotent: after teardownAllSessions runs (on `before-quit`) the terminalOwners map
// is already clear, so this loop is a safe no-op on a normal app-quit close.
function teardownWindowTerminals(wc: Electron.WebContents): void {
  for (const [terminalId, owner] of [...terminalOwners.entries()]) {
    if (owner === wc) {
      terminalOwners.delete(terminalId)
      // B-1/M-2: explicit stop in MAIN — port.close() THEN pty.kill() (FROZEN #1/#2;
      // architecture.md:554). NEVER rely on a renderer FocusedSession/EmbeddedTerminal
      // unmount to kill the PTY (that is the exact B-1 path; App.tsx ~199-203 WARNING).
      terminalManager?.stop(terminalId)
    }
  }
}

// Build the child env for the PTY (Review F7): drop undefined-valued keys (the
// process.env type lies about this) and strip the test/harness vars (C9_SMOKE* and the
// Story-5.4 C9_TEST_PICK_DIR picker seam) so they do not leak into the spawned shell or
// anything it launches (e.g. claude).
function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'C9_SMOKE' || k === 'C9_SMOKE_OUT' || k === 'C9_TEST_PICK_DIR') continue
    env[k] = v
  }
  return env
}

function registerPtyIpc(): void {
  // Renderer asks for the PTY once the terminal element is mounted & sized.
  ipcMain.on(CH.ptyStart, (evt) => {
    const wc = evt.sender
    if (ptys.has(wc)) return
    const term = pty.spawn(SHELL, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: buildPtyEnv()
    })
    ptys.set(wc, term)

    // ABI proof for the record (AC-2 / AC-5): a successful spawn means node-pty
    // is ABI-matched to this Electron. Surface the ABI in a log line.
    console.log(
      `[c9watch][pty] spawned pid=${term.pid} shell=${SHELL} ` +
        `electron=${process.versions.electron} abi(process.versions.modules)=${process.versions.modules}`
    )

    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send(CH.ptyData, data)
    })

    term.onExit(({ exitCode }) => {
      console.log(`[c9watch][pty] exited code=${exitCode}`)
      if (!wc.isDestroyed()) wc.send(CH.ptyExit, { exitCode })
      ptys.delete(wc)
    })
  })

  ipcMain.on(CH.ptyInput, (evt, data: string) => {
    ptys.get(evt.sender)?.write(data)
  })

  // Resize ordering (Guardrail #8): the renderer computes cols/rows, then the
  // PTY is resized. We resize the pty here on receipt; the renderer fits after.
  ipcMain.on(CH.ptyResize, (evt, size: PtyResizeRequest) => {
    const term = ptys.get(evt.sender)
    if (term && size && size.cols > 0 && size.rows > 0) {
      try {
        term.resize(size.cols, size.rows)
      } catch (e) {
        console.error('[c9watch][pty] resize error', e)
      }
    }
  })

  // Smoke harness wiring (AC-3). Renderer asks whether smoke mode is on, and
  // posts its verdict here; main persists it and exits.
  ipcMain.handle(CH.smokeConfig, () => ({
    enabled: SMOKE,
    electron: process.versions.electron,
    abi: process.versions.modules,
    node: process.versions.node
  }))

  ipcMain.on(CH.smokeReport, (evt, report: SmokeReport) => {
    const term = ptys.get(evt.sender)
    const full = {
      ...report,
      main: {
        electron: process.versions.electron,
        abi: process.versions.modules,
        node: process.versions.node,
        ptyPid: term?.pid ?? null
      }
    }
    const json = JSON.stringify(full, null, 2)
    console.log('[c9watch][smoke] REPORT ' + json)
    // Review F10: a verdict we cannot persist must NOT look like a pass. If the
    // write fails, exit non-zero so the gate can never silently pass without a
    // persisted verdict the runner can read.
    let writeFailed = false
    if (SMOKE_OUT) {
      try {
        writeFileSync(SMOKE_OUT, json)
      } catch (e) {
        console.error('[c9watch][smoke] failed to write report', e)
        writeFailed = true
      }
    }
    term?.kill()
    ptys.delete(evt.sender)
    const passed = !writeFailed && full && (full as { pass?: boolean }).pass === true
    const code = passed ? 0 : 4
    // Review (smoke termination): `app.exit()` can fail to tear the process down
    // promptly under Electron+Wayland here (GPU/compositor teardown lingers),
    // which would hang the smoke runner until its external timeout and surface a
    // genuine pass as ETIMEDOUT/exit-2. The verdict is already persisted above,
    // so in smoke mode force a hard process exit as a fallback.
    app.exit(code)
    setTimeout(() => process.exit(code), 250)
  })
}

// Story 2.4 — the ONE app-global settings store. Settings are app-global (NOT window-scoped
// like the feed/tray), so this is a single instance for the whole app, constructed AFTER
// app-ready (electron-store needs userData). A null until then; registerSettingsIpc reads it.
let settingsStore: SettingsStore | null = null

// Story 3.5 (SM-2) — the ONE app-global telemetry store. Append-only JSONL in userData
// (AR-9: no database; Zod-validated + versioned; corrupt read → back up + start fresh).
// Null until AFTER app-ready (app.getPath('userData') needs ready). The per-window tracker
// is consulted by the IPC handler — reads `tracker.columnOf(id)` + `tracker.enteredColumnAt(id)`.
let telemetryStore: TelemetryStore | null = null

// Story 2.4 — register the settings IPC ONCE (mirrors registerPtyIpc): `settings:get` returns
// the value directly; `settings:set` PARSE-AND-THROW-TYPEs the untrusted patch at the boundary
// (zod-boundaries.md: renderer→main = THROW), then the store merges + re-validates + persists
// and returns the new validated Settings. CH.* consts only — never a string literal.
function registerSettingsIpc(): void {
  // settings:get — return the current validated settings (the value directly, no envelope).
  ipcMain.handle(CH.settingsGet, () => {
    if (settingsStore === null) {
      // Defensive: handlers register after the store is built; if a get races construction,
      // fail loudly rather than ship garbage (the renderer's get() catch falls back to defaults).
      throw new Error('settings store not initialized')
    }
    return settingsStore.get()
  })

  // settings:set — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary
  // (a malformed patch rejects the invoke). Never log the value — the throw IS the signal.
  // `raw` is annotated `unknown` (Electron types it contextually as `any`) so the trust
  // boundary is explicit at the signature — the value is untrusted until SettingsPatchSchema
  // validates it. [.claude/rules/zod-boundaries.md IPC-arg row]
  ipcMain.handle(CH.settingsSet, (_evt, raw: unknown) => {
    if (settingsStore === null) throw new Error('settings store not initialized')
    const patch = SettingsPatchSchema.parse(raw)
    return settingsStore.set(patch)
  })
}

// Story 3.5 (SM-2) — register the telemetry-acknowledge IPC ONCE (mirrors registerSettingsIpc:
// single-registration, app-global, parse-and-throw on the arg). Channels are CH.* consts only —
// never a string literal (no-literal-channels). The arg is UNTRUSTED cross-process input →
// TelemetryAcknowledgeSchema.parse(raw) throws a typed error on a bad arg (zod-boundaries.md
// IPC-arg row). MAIN computes the duration (it owns tracker.enteredColumnAt). Never logs the
// value — log path+code only (Guardrail #6; the arg carries sessionId which is an opaque UUID
// but the rule is uniform). The invoke returns void. [story 3.5 Task 3.3 / FROZEN-3]
function registerTelemetryIpc(): void {
  ipcMain.handle(CH.telemetryAcknowledge, (evt, raw: unknown) => {
    // PARSE-AND-THROW at the untrusted cross-process input boundary (zod-boundaries.md IPC-arg
    // row). A malformed arg rejects the invoke — the throw is the signal, nothing is logged here.
    const { sessionId, acknowledgedAt } = TelemetryAcknowledgeSchema.parse(raw)

    // Defensive: telemetryStore is null until app-ready (race); skip gracefully.
    // [mirrors settingsStore === null guard at index.ts:441,455]
    if (telemetryStore === null) {
      console.warn('[c9watch][telemetry] code=telemetry_store_not_initialized')
      return
    }

    // Fetch the per-window tracker via the event sender (the tracker is per-window, keyed by wc).
    const wc = evt.sender
    const tracker = trackers.get(wc)
    if (tracker === undefined) {
      // Window has no tracker (e.g. smoke mode / destroyed window). Skip gracefully.
      console.warn('[c9watch][telemetry] code=telemetry_no_tracker sessionId=' + sessionId)
      return
    }

    // Story 3.5 FROZEN-4: if the session is NOT in a waiting column at the moment the
    // acknowledge lands (it already left needs-you/idle, or is unknown to the tracker),
    // write NO telemetry event — the wait is unmeasurable. Do NOT build a grace-period.
    const column = tracker.columnOf(sessionId)
    if (column !== 'needs-you' && column !== 'idle') {
      // Session not in a waiting column — skip (not waiting, unknown, or working). Code-only log.
      console.warn(`[c9watch][telemetry] code=telemetry_skip_not_waiting sessionId=${sessionId}`)
      return
    }

    const enteredColumnAt = tracker.enteredColumnAt(sessionId)
    if (enteredColumnAt === undefined) {
      // Should not happen if columnOf returned a value, but be defensive.
      console.warn(`[c9watch][telemetry] code=telemetry_skip_no_entered_at sessionId=${sessionId}`)
      return
    }

    // Compute the wait duration. A negative waitMs is a clock/edge anomaly — SKIP (FROZEN-4).
    const waitMs = acknowledgedAt - enteredColumnAt
    if (waitMs < 0) {
      console.warn(`[c9watch][telemetry] code=telemetry_skip_negative_wait sessionId=${sessionId}`)
      return
    }

    // Build + record the event. The launched flag comes from the per-run launched-set (SM-1 basis).
    // All fields are already validated (sessionId from parse, column from tracker, waitMs >= 0).
    try {
      telemetryStore.record({
        version: TELEMETRY_VERSION,
        kind: 'idle-wait',
        sessionId,
        column,
        enteredColumnAt,
        acknowledgedAt,
        waitMs,
        launched: launchedSet.has(sessionId)
      })
    } catch (err) {
      // The store's record() never throws itself (never-crash), but be defensive on the outer
      // path too. Code-only log — never log the event value (Guardrail #6).
      console.warn(
        '[c9watch][telemetry] code=telemetry_record_error',
        err instanceof Error ? err.message : 'unknown'
      )
    }
  })
}

// Story 3.1 (FR-10) — adapt an Electron `MessagePortMain` (the MAIN end, port1) to the
// manager's tiny `PortLike` seam. The manager is transport-agnostic + unit-testable against a
// fake port (no `MessagePortMain` in jsdom — ipc.md); this is the ONE place the real port is
// adapted. The byte path (this port) is exercised by the packaged smoke. Messages are typed
// both ways: main posts `TerminalPortMainMessage` (output/exit); the renderer posts
// `TerminalPortRendererMessage` (input/ack). Electron delivers the renderer's message in
// `event.data` — we trust the SHAPE here (it is our own renderer over a private port, not the
// generic renderer→main IPC arg surface) but keep the typed projection explicit.
function adaptMessagePort(port: MessagePortMain): PortLike {
  return {
    postMessage: (message: TerminalPortMainMessage): void => port.postMessage(message),
    onMessage: (cb: (message: TerminalPortRendererMessage) => void): void => {
      port.on('message', (event) => cb(event.data as TerminalPortRendererMessage))
    },
    start: (): void => port.start(),
    close: (): void => port.close()
  }
}

// Story 3.1 (FR-10) — register the terminal-lifecycle IPC ONCE (mirrors registerPtyIpc /
// registerSettingsIpc; Review-F1 single-registration so app.activate re-creating a window can
// neither throw on duplicate ipcMain.handle nor stack ipcMain.on listeners). Channels are
// CH.* consts only — never a string literal (no-literal-channels). Cross-process args are
// UNTRUSTED → parse-and-throw-typed at the boundary (zod-boundaries.md IPC-arg row); the throw
// rejects the invoke. The BYTE path rides the transferred MessagePort, NOT these channels.
function registerTerminalIpc(): void {
  // Build the ONE app-global terminal manager. The pty factory + log are the DI seams (the
  // real node-pty-backed createPty is the default). onExit is the dead-terminal push: validate
  // AT SOURCE (main→renderer delta; zod-boundaries.md) then send CH.terminalExit to the OWNING
  // window. A failure here never throws out (never-crash). The spawned shell + sanitized env
  // mirror the Story-0.1 spike (buildPtyEnv strips the smoke vars).
  terminalManager = createTerminalManager({
    spawnDefaults: { file: SHELL, cwd: os.homedir(), env: buildPtyEnv() },
    onExit: (terminalId, exitCode) => {
      const wc = terminalOwners.get(terminalId)
      terminalOwners.delete(terminalId)
      // Story 3.4 (FR-16) / Story 5.4 — a launched `claude` that exits FOR REAL drops its
      // CORRELATION tracking here so a dead launch's PendingLaunch does not linger / keep
      // re-correlating. Story 5.4 narrows forget() to the correlation tracking ONLY: the
      // spawn-override (the Reopen recipe) is deliberately KEPT so the dead-pane "Reopen" affordance
      // re-spawns claude, not the default `$SHELL`. This is the ONLY forget() call site — the
      // CH.terminalStop handler intentionally does NOT forget (a StrictMode dev transient stop must
      // not drop tracking). Idempotent + never throws; the launched-set membership for an
      // ALREADY-joined session is left intact (the set is per-run, not per-terminal). Runs even if
      // the owning window is gone (below) — the forget is independent of the dead-terminal push.
      launchService?.forget(terminalId)
      if (!wc || wc.isDestroyed()) return
      // Validate AT SOURCE before send: a malformed exit never crosses the seam.
      const r = TerminalExitSchema.safeParse({ terminalId, exitCode })
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][term] dropped terminal:exit path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.terminalExit, r.data)
    },
    // never-log-the-value: a code= ONLY, never a pty/session value (Guardrail #6).
    log: (message) => console.warn(message)
  })

  // terminal:open — create a MessageChannel, wire its MAIN end (port1) to a fresh pty via the
  // manager, and TRANSFER the renderer end (port2) back on this invoke's reply. The renderer
  // receives the port and rides bytes over it. The arg is parse-and-throw-typed (a malformed
  // open rejects). Returns nothing structural — the port IS the return, transferred via
  // `event.ports` on the reply. We use `ipcMain.on` + `event.senderFrame`/`port` transfer
  // semantics: Electron transfers ports posted back to the sender via webContents.postMessage.
  ipcMain.on(CH.terminalOpen, (event, raw: unknown) => {
    // We use `ipcMain.on` (not `handle`) because the open must TRANSFER a MessagePort back, which
    // rides `wc.postMessage(channel, msg, [port])` — an `invoke` handler cannot RETURN a port.
    // So failures cannot reject the invoke; instead a failure that has a VALID terminalId pushes a
    // dead-terminal signal (CH.terminalExit) so the renderer flips to the dead pane rather than
    // HANGING on a port that never arrives (code-review M-2). Parse FIRST so we hold the id even
    // when the manager isn't ready yet.
    const wc = event.sender
    const parsed = TerminalOpenSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      // never-log-the-value: PATH + CODE only. A malformed open carries no usable id, so we can
      // only drop+log it (this is a programmer error — the renderer always sends `{terminalId}`).
      console.error(
        `[c9watch][term] dropped terminal:open path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    const { terminalId, openToken } = parsed.data
    if (terminalManager === null) {
      // The manager isn't ready (a race against app-ready construction). Surface it as a dead
      // terminal so the renderer's open() callback path resolves to the dead pane, not a hang.
      const r = TerminalExitSchema.safeParse({ terminalId, exitCode: 1 })
      if (r.success && !wc.isDestroyed()) wc.send(CH.terminalExit, r.data)
      return
    }
    const { port1, port2 } = new MessageChannelMain()
    // Record the owning window so a dead-terminal push (onExit) routes back here.
    terminalOwners.set(terminalId, wc)
    // Story 3.2 (FR-11) — if this terminalId is an app LAUNCH (the renderer opened the
    // EmbeddedTerminal against a launch-minted id), consume its spawn override so the manager
    // spawns raw `claude` in the picked cwd instead of the default shell. A non-launch
    // terminalId (the Story-3.1 host path) has no override → null → the unchanged shell spawn.
    const spawnOverride = launchService?.peekSpawnOverride(terminalId) ?? undefined
    // Open the terminal (manager wires port1 ↔ pty + flow control). Initial dims are the
    // renderer's first fit() over CH.terminalResize; spawn at a sane default until then. A spawn
    // failure degrades to the manager's onExit → CH.terminalExit (dead pane), never a hang.
    // Story 5.6 — pass openToken so the manager can (a) update the stored token on re-attach, and
    // (b) let a stale cleanup-stop (carrying the old token) self-identify as a no-op.
    terminalManager.open(terminalId, adaptMessagePort(port1), 80, 24, spawnOverride, openToken)
    // Transfer port2 to the renderer, ECHOING the renderer's per-open `openToken` (Story 5.4)
    // alongside the terminalId so the renderer can pair THIS port to THIS open. The token
    // disambiguates a re-open of the SAME terminalId (a StrictMode dev double-mount, or Reopen):
    // without it the renderer's one-shot listener could pair the STALE (already-closed) port from
    // the prior open and ignore the live one → a blank terminal. The renderer listens on
    // CH.terminalOpen for the `{ terminalId, openToken }` payload + `ports[0]`.
    if (!wc.isDestroyed()) wc.postMessage(CH.terminalOpen, { terminalId, openToken }, [port2])
  })

  // terminal:resize — main resizes the pty FIRST (the renderer already computed cols/rows via
  // fit(); terminal.md). UNTRUSTED arg → parse-and-throw-typed (this is an invoke so a reject
  // surfaces to the renderer). An out-of-range dim FAILS CLOSED.
  ipcMain.handle(CH.terminalResize, (_event, raw: unknown) => {
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    const { terminalId, cols, rows } = TerminalResizeSchema.parse(raw)
    terminalManager.resize(terminalId, cols, rows)
  })

  // terminal:stop — destroy the terminal (port.close() THEN pty.kill(), in the manager).
  // UNTRUSTED arg → parse-and-throw-typed.
  ipcMain.handle(CH.terminalStop, (_event, raw: unknown) => {
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    const { terminalId, openToken } = TerminalStopSchema.parse(raw)
    // Story 5.6 — forward the optional openToken to the manager. The manager no-ops if the token
    // is stale (a superseded StrictMode cleanup-stop). Omitted (user-initiated / quit teardown) →
    // unconditional kill (unchanged behavior). See terminalManager.stop() for the full semantics.
    terminalManager.stop(terminalId, openToken)
    // Story 5.4 — do NOT forget the launch here. This handler fires on EVERY EmbeddedTerminal
    // unmount, INCLUDING the transient unmount React StrictMode performs in dev (mount → cleanup
    // → mount). Forgetting here would drop the launch's correlation tracking AND (pre-5.4) its
    // spawn-override on that transient stop, so the surviving mount re-spawned the default
    // `$SHELL` instead of `claude` — the dev blank/wrong-terminal bug. A launch's correlation
    // tracking is dropped only when its claude exits FOR REAL (the terminalManager onExit →
    // launchService.forget), and the spawn-override (the Reopen recipe) is kept regardless.
  })
}

// Story 3.2 (FR-11) — the RAW `claude` spawn config (F3, FROZEN DECISION).
//
// STORY 5.5 UPDATE: the descendant-walk rationale below NO LONGER constrains the spawn — the
// correlation now matches by SUBTREE ANCESTRY off the PTY leader (pidCorrelation.ts `isAncestorOf`),
// which works whatever the spawn shape (in practice `bash -l -c claude` execs the claude ELF, so
// the PTY leader IS claude and the tracked session is a deep `npm exec claude` descendant — both
// are under the leader). We KEEP `$SHELL -l -c claude` purely for the LOGIN-SHELL PATH/rc benefit
// (the second bullet below); the "claude must stay a child" reasoning is now moot.
//
// FROZEN DECISION (F3 fork resolved with live evidence): we spawn `claude` via a LOGIN SHELL
// that runs claude AS A CHILD — `$SHELL -l -c 'claude'` — NOT the direct spawn and NOT
// `exec claude`. Rationale grounded in the Story-0.4 LIVE evidence (oq-6 finding §E3): the
// validated correlation walk (`resolveClaudeDescendant`, reused AS-IS) resolves claude as a
// CHILD of the node-pty shell leader (the proven live ancestry `claude(664817) → bash(189223)`).
//   - A DIRECT spawn (`file: 'claude'`) would make claude the PTY LEADER (term.pid == claude), so
//     `resolveClaudeDescendant(term.pid)` finds NO claude CHILD → CLAUDE_NOT_RESOLVED forever
//     (the as-is descendant walk only inspects children). It would also break on a minimal
//     KDE-launched-app PATH where bare `claude` is not resolvable.
//   - `exec claude` REPLACES the shell with claude (same defeat: claude becomes the leader).
//   - The LOGIN SHELL (`-l`) resolves PATH/rc reliably (KDE app env can have a minimal PATH), and
//     running `claude` (no exec) keeps it a CHILD — EXACTLY the shape the validated walk expects,
//     keeping the layer thin (one shell, then claude). AR-7 "raw / minimal shell layering" is
//     honored: a single login shell whose only job is to launch claude.
// The env is the sanitized buildPtyEnv() (drops undefined keys + strips the smoke vars). [Source:
// F3; AR-7; oq-6-pid-correlation-finding.md §E3 (claude → bash child ancestry, walk validated)]
function rawClaudeSpawn(): { file: string; args: string[]; env: Record<string, string> } {
  return { file: SHELL, args: ['-l', '-c', 'claude'], env: buildPtyEnv() }
}

// Story 3.2 (FR-11) — register the launch IPC ONCE (mirrors registerTerminalIpc / registerPtyIpc;
// Review-F1 single-registration). Constructs the app-global launch service (reusing the terminal
// manager + the launched-set + the production /proc readers). Channels are CH.* consts only.
// Cross-process args are UNTRUSTED → parse-and-throw at the boundary (zod-boundaries.md IPC-arg
// row); NEVER log the picked path value (it leaks the operator's filesystem layout).
function registerLaunchIpc(): void {
  // The launch service spawns through the SAME terminal manager (reuse) + the production
  // pidCorrelation readers (Linux /proc). It POPULATES the app-global launched-set on a landed
  // Tgid join. A null terminal manager (a race vs app-ready) is guarded at the handler.
  if (terminalManager === null) {
    // Defensive: registerLaunchIpc is called AFTER registerTerminalIpc in the ready block, so
    // this never trips in practice; surface it as a code rather than spawn a half-wired service.
    console.error('[c9watch][launch] code=launch_ipc_before_terminal_manager')
  }
  launchService = createLaunchService({
    // The launch SPAWN rides the existing terminal:open handler; the launch service only reads
    // the spawned shell leader pid for the correlation walk (pidOf). The terminal manager is
    // non-null by construction order (registerTerminalIpc ran first); pidOf is null-safe.
    terminalManager: {
      pidOf: (terminalId) => terminalManager?.pidOf(terminalId) ?? null
    },
    launchedSet,
    spawn: rawClaudeSpawn(),
    // Story 5.5 — the ONLY `/proc` seam the correlation needs now: status (for the session's Tgid
    // + the PPid ancestry walk up to the PTY leader). The pre-5.5 comm/children readers are gone.
    readStatus: readStatusFromProc,
    // Opaque, unique per launch (NOT a session id, NOT a pid — F6). crypto UUID is plenty unique.
    newTerminalId: () => `launch-${randomUUID()}`,
    // Story 3.4 (FR-16) — push the terminalId ↔ sessionId binding to the OWNING window when a
    // launch's Tgid join lands. Resolve the owner from `terminalOwners` (the same map the
    // dead-terminal onExit uses); VALIDATE AT SOURCE (LaunchCorrelatedSchema) before send so a
    // malformed binding never crosses the seam (main→renderer delta; zod-boundaries.md). Re-check
    // the destroyed window per send (a late event after close is a no-op, mirroring the wc.send
    // guards above). never-log-the-value: PATH + CODE only on a parse miss (Guardrail #6).
    onCorrelated: (binding) => {
      const wc = terminalOwners.get(binding.terminalId)
      if (!wc || wc.isDestroyed()) return
      const r = LaunchCorrelatedSchema.safeParse(binding)
      if (!r.success) {
        const issue = r.error.issues[0]
        console.error(
          `[c9watch][launch] dropped launch:correlated path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.launchCorrelated, r.data)
    },
    // never-log-the-value: a code= ONLY, never a path/pty/session value (Guardrail #6).
    log: (message) => console.warn(message)
  })

  // session:pick-directory — open the NATIVE KDE directory chooser in MAIN and return the chosen
  // path, or null on cancel (UX-DR23). The renderer NEVER opens a dialog itself. Modal-to-window
  // (pass the owning BrowserWindow) on KDE. This is an invoke (returns the value directly).
  ipcMain.handle(CH.sessionPickDirectory, async (event) => {
    // Story 5.4 — TEST-ONLY seam (mirrors the C9_SMOKE env gate): when C9_TEST_PICK_DIR is set,
    // bypass the native KDE dialog (which Playwright cannot drive) and return that path. This
    // exists SOLELY so the launch-path e2e can exercise `+ New session → claude` end-to-end on the
    // built app. Inert in normal use (the env var is never set in production). Never logged.
    const testPickDir = process.env.C9_TEST_PICK_DIR
    if (testPickDir !== undefined && testPickDir !== '') return testPickDir
    const owner = BrowserWindow.fromWebContents(event.sender)
    // showOpenDialog accepts an optional parent window; pass it so the dialog is modal-to-window.
    const result = owner
      ? await dialog.showOpenDialog(owner, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    // Cancel ⇒ canceled:true (or empty filePaths) ⇒ null ⇒ the renderer no-ops (no launch).
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  // session:launch — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary (a
  // blank/non-string cwd rejects the invoke). NEVER log the cwd value — the throw IS the signal.
  // On a valid cwd, the launch service spawns raw `claude` (via the reused terminal manager) and
  // returns the opaque terminalId the renderer's EmbeddedTerminal opens against. The terminal is
  // typeable IMMEDIATELY; the Tgid correlation reconciles asynchronously on feed deltas (UX-DR19).
  ipcMain.handle(CH.sessionLaunch, (_event, raw: unknown) => {
    if (launchService === null) throw new Error('launch service not initialized')
    const { cwd } = SessionLaunchSchema.parse(raw)
    const { terminalId } = launchService.launch({ cwd })
    return { terminalId }
  })
}

// Story 4.2 (FR-14) — register the quit-guard IPC ONCE (mirrors registerSettingsIpc /
// registerTerminalIpc single-registration at app-ready — Review-F1). Channels are CH.* consts
// only — never a string literal (no-literal-channels). The three renderer→main invokes are
// payload-less typed wrappers; they carry no cross-process args to parse. The main→renderer
// guard-show push is validated AT SOURCE in handleBeforeQuit (not here). isQuitting / pendingGuard
// live in the app-global quitGuardState; the before-quit handler reads/sets them atomically.
function registerQuitIpc(): void {
  // app:request-quit — renderer asks main to begin a true quit. Routes through app.quit() so
  // it flows through the ONE before-quit guard decision (the one chokepoint, FROZEN #3).
  // The renderer NEVER calls app.quit() directly (it can't — sandboxed). Returns void.
  ipcMain.handle(CH.appRequestQuit, () => {
    app.quit()
  })

  // quit:confirm — "Quit anyway" was clicked. Main proceeds: sets isQuitting, teardown, quit.
  // The re-entrant before-quit (triggered by the quit) sees isQuitting=true and short-circuits.
  ipcMain.handle(CH.quitConfirm, () => {
    handleQuitConfirm(quitGuardState, {
      teardownAllSessions,
      teardownDeps: {
        terminalManager,
        feeds: feeds.values(),
        clearTerminalOwners: () => terminalOwners.clear()
      },
      computeLiveLaunchedSessions,
      computeDeps: {
        reducers: reducers.values(),
        isLaunched: (id) => launchedSet.has(id)
      },
      pushGuard: () => {
        /* no-op: pushGuard is unused in the quitConfirm path */
      },
      proceedQuit: () => app.quit()
    })
  })

  // quit:cancel — the operator cancelled. No teardown; every PTY stays live (FROZEN #1).
  // The before-quit's e.preventDefault() already aborted this quit attempt.
  ipcMain.handle(CH.quitCancel, () => {
    handleQuitCancel(quitGuardState)
  })
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security posture (Story 0.1 AC-1 / Guardrail #5): NEVER weaken these.
      // node-pty runs in MAIN; the renderer stays sandboxed and talks via the
      // typed preload bridge only.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Story 4.2 (FR-14 / UX-DR25 / FROZEN #4 / Epic-4 DECISION #2) — minimize-to-taskbar.
  // A title-bar window-close MINIMIZES instead of quitting: `e.preventDefault()` + `minimize()`.
  // `isQuitting` (quitGuardState) flips true ONLY when a real quit PROCEEDS (guard passed /
  // nothing-live). On a real quit, this handler falls through (lets Electron close the window
  // normally so `window-all-closed` fires → `app.quit()` → before-quit sees isQuitting=true
  // and short-circuits). Sessions keep running; the tray badge stays live (badge.ts UNTOUCHED).
  //
  // ZERO `window.show()`/raise/focus anywhere (Epic-4 DECISION #2 — strictest no-self-raise).
  // Restore is 100% DE-native (the taskbar entry). A minimized window NEVER fires
  // `window-all-closed` (it is not closed), so the `window-all-closed → app.quit()` path
  // (below) still composes correctly: only a REAL quit close triggers it.
  //
  // [Source: epics.md Epic-4 DECISION #2 (line 190); UX-DR25 (line 111); EXPERIENCE.md:122-126]
  mainWindow.on('close', (e) => {
    if (!quitGuardState.isQuitting) {
      e.preventDefault()
      mainWindow.minimize()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Fire-and-forget: open externally; we deny the in-app window regardless. The
    // handler must return synchronously, so the promise is intentionally voided.
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    const wc = mainWindow.webContents
    ptys.get(wc)?.kill()
    ptys.delete(wc)
    // Story 1.1 — stop the watch feed cleanly (AbortController teardown), reaping
    // the watch child. Independent of the PTY teardown below.
    teardownWatchFeed(wc)
    // Story 3.1 / Story 4.1 — tear down every embedded terminal this window owned via the
    // shared teardownWindowTerminals helper (explicit MAIN stop: port.close() THEN pty.kill(),
    // inside terminalManager.stop). B-1/M-2 hard constraint: NEVER rely on an incidental
    // renderer unmount to kill PTYs (App.tsx ~199-203 M-2 latch WARNING). On a normal
    // app-quit, teardownAllSessions (before-quit) already ran and cleared terminalOwners →
    // this loop is a safe idempotent no-op. On a direct window close (4-2 will flip this to
    // minimize instead), it tears down this window's terminals cleanly.
    teardownWindowTerminals(wc)
  })

  // Story 1.1 — start the live c9watch feed for this window once it is ready to
  // show (the renderer can receive CH.watchEvents deltas by then). Registered per
  // window, torn down on close; smoke mode skips it.
  mainWindow.on('ready-to-show', () => {
    registerWatchFeed(mainWindow)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  // Load failures surface via the `did-fail-load` webContents event, so the load
  // promise is intentionally fire-and-forget (voided to satisfy no-floating-promises).
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app
  .whenReady()
  .then(() => {
    // Set app user model id for windows. CANONICAL appId = `com.c9watch.app` (Story 2.3 AC-6):
    // reconciled to match `electron-builder.yml` (`appId`) + the `.desktop` file's
    // `StartupWMClass`/filename so the tray + notification OS identity is consistent. This was
    // the outlier (`com.c9watch`) — it moves to the canonical value. [FROZEN #5; AR-10]
    electronApp.setAppUserModelId('com.c9watch.app')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Register PTY/smoke IPC ONCE (Review F1) — not per-window, so app.activate
    // re-creating a window cannot throw on duplicate ipcMain.handle nor stack
    // ipcMain.on listeners.
    registerPtyIpc()

    // Story 2.4 — build the ONE app-global settings store AFTER app-ready (electron-store
    // needs userData) and register its IPC ONCE (app-global, not per-window). Construction
    // fails closed on a corrupt persisted read (backs up + starts fresh — never crashes); a
    // total failure to even build the store degrades to an in-memory-only store so the app
    // still runs (never-crash). Smoke mode skips persistence (no electron-store on the gate
    // box path) — the in-memory default keeps the smoke harness untouched.
    try {
      settingsStore = SMOKE
        ? createSettingsStore()
        : createSettingsStore({ blobStore: createElectronSettingsBlobStore() })
    } catch (err) {
      console.error(
        '[c9watch][settings] code=settings_store_init_failed (using in-memory defaults):',
        err instanceof Error ? err.message : 'unknown'
      )
      settingsStore = createSettingsStore()
    }
    registerSettingsIpc()

    // Story 3.5 (SM-2) — build the ONE app-global telemetry store AFTER app-ready
    // (app.getPath('userData') needs ready) and register the telemetry IPC ONCE.
    // Construction fails closed on a corrupt persisted JSONL (backs up + starts fresh —
    // never crashes); a total failure degrades to an in-memory-only store so the app still
    // runs (never-crash, mirrors settingsStore construction above). Smoke mode skips
    // persistence (in-memory line store — keeps the smoke harness from writing userData).
    try {
      telemetryStore = SMOKE
        ? createTelemetryStore()
        : createTelemetryStore({
            lineStore: createFsTelemetryLineStore(app.getPath('userData'))
          })
    } catch (err) {
      console.error(
        '[c9watch][telemetry] code=telemetry_store_init_failed (using in-memory):',
        err instanceof Error ? err.message : 'unknown'
      )
      telemetryStore = createTelemetryStore()
    }
    registerTelemetryIpc()

    // Story 3.1 (FR-10) — build the terminal manager + register its lifecycle IPC ONCE
    // (app-global, not per-window; mirrors registerSettingsIpc). The MessagePort byte path
    // is wired per terminal:open. Smoke mode does not open embedded terminals (the smoke
    // drives the Story-0.1 single-PTY window.pty path via SmokeCockpit — unchanged), so this
    // registration is harmless there.
    registerTerminalIpc()

    // Story 3.2 (FR-11) — register the launch IPC ONCE (after the terminal manager exists, since
    // the launch service spawns through it). Mirrors registerTerminalIpc single-registration.
    registerLaunchIpc()

    // Story 4.2 (FR-14) — register the quit-guard IPC ONCE (app:request-quit, quit:confirm,
    // quit:cancel). Single-registration mirrors the established pattern above.
    registerQuitIpc()

    createWindow()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  // whenReady() rejecting is catastrophic + rare; surface it rather than letting
  // it float (no-floating-promises). [Story 0.3 Task 6 — type-checked lint]
  .catch((err) => {
    console.error('[c9watch] app failed to become ready', err)
    app.quit()
  })

// Story 4.2 (FR-14) — REFACTORED `before-quit`: the combined guard-then-teardown handler.
//
// Story 4.1 had an unconditional teardown here. Story 4.2 makes it CONDITIONAL (the guard gate):
//   - If a real quit is already in progress (isQuitting=true) → short-circuit and return.
//     Electron processes `before-quit` synchronously before the quit proceeds; the re-entrant
//     call (from quitConfirm's app.quit() or handleBeforeQuit's proceedQuit) sees isQuitting=true
//     and returns immediately so teardown is NOT called twice.
//   - If nothing live (total===0) → set isQuitting=true, run teardown, proceed.
//   - If ≥1 live session → e.preventDefault() + push the guard payload to the renderer.
//     teardownAllSessions is NOT called here (deferred to quitConfirm).
//
// the guard WRAPS teardown — a cancelled quit tears down NOTHING (FROZEN #1).
//
// ONE combined handler (NOT two listeners — a second `before-quit` listener that teardowns
// independently would kill PTYs even on cancel because Electron does NOT stop other
// `before-quit` listeners when one calls e.preventDefault() — FROZEN #1).
//
// B-1/M-2 HARD CONSTRAINT (unchanged from 4.1): teardown stops PTYs EXPLICITLY IN MAIN
// (terminalManager.destroyAll → port.close() THEN pty.kill()) — NEVER via an incidental
// renderer unmount. Order: STOP FIRST (here or in quitConfirm), then any renderer unmount.
//
// port.close() BEFORE pty.kill() (FROZEN #2) is INSIDE terminalManager.destroyAll() →
// teardown() — REUSE it, do NOT reimplement. [Source: story 4.2 Task 2; FROZEN #1/#2/#3]
app.on('before-quit', (e) => {
  // Short-circuit: a real quit is already in progress (quitConfirm or nothing-live path set
  // this). Return immediately so teardown is NOT called twice and the quit proceeds normally.
  if (quitGuardState.isQuitting) return

  // The main window's webContents — needed to push the guard payload to the renderer.
  // We use BrowserWindow.getAllWindows() (the single window) so this is not captured at
  // module scope (it only exists after createWindow()). A null/destroyed wc → no push; the
  // nothing-live path still runs teardown cleanly (the guard is a renderer-only concern).
  const mainWin = BrowserWindow.getAllWindows()[0]
  const wc = mainWin?.webContents

  const showed = handleBeforeQuit(quitGuardState, {
    teardownAllSessions,
    teardownDeps: {
      terminalManager,
      feeds: feeds.values(),
      clearTerminalOwners: () => terminalOwners.clear()
    },
    computeLiveLaunchedSessions,
    computeDeps: {
      reducers: reducers.values(),
      isLaunched: (id) => launchedSet.has(id)
    },
    pushGuard: (payload: QuitGuardPayload) => {
      if (!wc || wc.isDestroyed()) return
      // Validate AT SOURCE before send: main→renderer delta must be well-formed (zod-boundaries.md).
      const r = QuitGuardPayloadSchema.safeParse(payload)
      if (!r.success) {
        const issue = r.error.issues[0]
        // never-log-the-value: PATH + CODE only — QuitGuardPayload carries sessionName data.
        console.error(
          `[c9watch][quit] dropped quit:guard-show path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
        )
        return
      }
      wc.send(CH.quitGuardShow, r.data)
    },
    proceedQuit: () => app.quit()
  })

  // If the guard was shown (≥1 live session), prevent the quit and await the operator's decision.
  if (showed) {
    e.preventDefault()
  }
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
