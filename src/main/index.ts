import { app, shell, BrowserWindow, ipcMain, MessageChannelMain, dialog, clipboard } from 'electron'
import type { MessagePortMain } from 'electron'
import { join } from 'path'
import { writeFileSync, accessSync, constants as fsConstants } from 'fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
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
  TerminalPortRendererMessage,
  ReducerWatchEventsPayload
} from '../shared/ipc/contract'
// Story 3.1 (FR-10) — the embedded-terminal transport: the MAIN-side terminal manager (one
// node-pty per terminal behind the ptyFactory DI seam + the validated, flow-controlled
// MessagePort byte path) + its cross-process IPC-arg schemas (parse-and-throw at the boundary).
import { createTerminalManager, type PortLike, type TerminalManager } from './pty/terminalManager'
import { resolveClaudeBin, composeClaudeCommand, prependToPath, shellQuote } from './pty/claudeBin'
// Version gate — the spawn depends on `--session-id`, `-n` and `--settings`; a claude that
// does not know one of them dies instantly instead of degrading. Fails OPEN on an unreadable
// version (see claudeVersion.ts for why that inversion is deliberate).
import { gateClaudeVersion, tooOldMessage } from './pty/claudeVersion'
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
// The session reducer — the authoritative Map<id,Session> + typed session deltas.
// Story 6.4: the c9watch CLI feed is RETIRED; sessions are born at spawn
// (upsertLaunched, Story 6.2) and transitioned/removed by hooks + stop/exit
// (applyHookStatus, Stories 6.3/hook-ingest). The dir name `c9watch/` is historical.
import { createReducer } from './c9watch/reducer'
// Story 1.2 — the column-transition tracker: consumes each reducer delta + the
// reduced map, emits attention.raised on a needs-you ENTRY edge (first observation
// suppressed), stamps time-entered-column, debounces flaps.
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
// Story 6.3 — FAST REMOVAL: the extracted stop/exit removal decision (unit-tested in
// launchRemoval.test.ts). Stop and PTY-exit resolve the exact spawn-time terminalId →
// sessionId binding, clear it, and route the bound session's removal through the owning
// window's reducer → the SAME handleDelta chokepoint (session.removed → card gone NOW,
// no SessionEnd hook / feed event needed).
import { removeBoundSession, stopTerminalAndRemoveBound } from './pty/launchRemoval'
// Story 6.2 — the extracted "should this open MINT?" decision (unit-tested in
// launchMint.test.ts, mirroring the launchRemoval extraction): mint ONLY when an ACTUAL
// pty spawn is about to happen — a re-attach to a LIVE terminal must never mint a second
// uuid / ghost card / binding overwrite.
import { mintForOpen } from './pty/launchMint'
// Session-naming — the extracted, unit-tested launch-card synthesis (see launchSynthesis.ts).
import { buildLaunchedSession } from './pty/launchSynthesis'
import { createLaunchedSet, type LaunchedSet } from './pty/launchedSet'
import { readStatusFromProc } from './pty/pidCorrelation'
import {
  SessionLaunchSchema,
  SessionRenameSchema,
  SessionSeenSchema,
  LaunchCorrelatedSchema
} from '../shared/schemas/launch'
// Story 6.2 — the reducer-storage Session type (parse-once contract): the spawn-time
// launch synthesis CONSTRUCTS a valid Session from main-owned values (minted uuid, picked
// cwd, pty pid) — it never re-runs SessionSchema over internal data.
import type { Session } from '../shared/schemas/session'
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
// Terminal clipboard feature — the Zod arg schema for CH.clipboardWriteText (renderer→main).
// Parse-and-throw at the boundary; NEVER log the text value (user content — Guardrail #6).
import { ClipboardWriteTextSchema } from '../shared/schemas/clipboard'
// Hook-status feature — real-time session status from Claude Code lifecycle hooks.
// The hook server binds a localhost HTTP listener; hook events flow through the SAME
// handleDelta chokepoint as c9watch deltas (same enrich/column/tray treatment).
// ZERO FOOTPRINT: the hook block is handed to claude as `--settings <file>` from the app's
// OWN data dir. The app writes NOTHING into the operator's projects — no
// `.claude/settings.local.json`, no `~/.claude/settings.json` — and the hooks scope to
// exactly the sessions it spawns. (This replaced the retired registerHooks merger.)
import { createHookServer, type HookServer } from './hooks/hookServer'
import { hookStatus } from './hooks/hookStatus'
import { ensureHookSettingsFile } from './hooks/hookSettingsFile'
// Session-rebind — claude can change its own session id mid-run (a `/clear` keeps the pty and
// the terminal, but fires SessionEnd for the old id and posts every later hook under a new
// one). These two decisions keep the card through that switch. [hooks/sessionRebind.ts]
import { createOrphanRegistry, sessionEndKeepsCard } from './hooks/sessionRebind'
// Name-sync — the per-window store of names waiting to be pushed to claude on its next
// UserPromptSubmit hook POST (the only way to rename an already-running session).
import { createPendingTitles } from './hooks/pendingTitles'
// Name-sync — the read-back decision (claude is the authority on its own name). Pure + here
// rather than inline, so it is testable: nothing can import index.ts.
import { titleReadBackRename } from './hooks/titleReadBack'

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
// INDEPENDENT of both the PTY spike registry (`ptys`) and the per-window session-engine
// registries (`reducers`/`trackers`) — a session delta must NEVER touch the PTY ports
// (the engine and terminal transports are separate). Constructed in registerTerminalIpc
// (after app-ready).
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

// Session-rebind — live launched ptys whose bound session id went quiet (claude changed its own
// id mid-run). APP-GLOBAL, keyed by terminalId, exactly like the terminal manager + launch
// service it reasons about (a terminal is window-independent). Per-run only, never persisted.
const orphanRegistry = createOrphanRegistry()

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

// Story 6.2/6.3 — per-window LAUNCH BOARD seam. The (app-global) terminal:open/stop handlers
// and the manager onExit callback must reach the OWNING window's reducer + handleDelta
// chokepoint — both are per-window closures inside registerWatchFeed, so this map routes to
// them (same lifetime: set in registerWatchFeed, deleted in teardownWatchFeed; mirrors
// `trackers`/`reducers`). The deltas take the SAME path as every c9watch/hook delta
// (tracker → tray → enrich → ship gate). Absent entry (smoke mode / a race before the feed
// wires) → the spawn/stop still works; only the board effect is skipped (never-crash — the
// terminal is never blocked on the board).
interface LaunchBoardSeam {
  /** Story 6.2 — synthesize/refresh the instant card at spawn (upsertLaunched → handleDelta). */
  upsertLaunched(session: Session): void
  /** Story 6.3 — immediate stop/exit removal (applyHookStatus removed → handleDelta). */
  removeLaunched(sessionId: string): void
  /** Session-naming A2 — retitle an existing session (renameSession → handleDelta). Unknown id
   *  is a quiet no-op inside the reducer, so this never needs a caller-side existence check. */
  renameLaunched(sessionId: string, name: string): void
  /** Deterministic-attention — the operator viewed this session (markSeen → handleDelta).
   *  Only a YourTurn session demotes; everything else is a quiet reducer no-op. */
  seenLaunched(sessionId: string): void
}
const launchBoardSeams = new Map<Electron.WebContents, LaunchBoardSeam>()

// Story 4.2 (FR-14) — mutable quit-guard state (owned at app scope; one app, one guard).
// Initialized here so the before-quit handler, quitConfirm, and quitCancel all share ONE state.
// isQuitting flips true ONLY when a real quit proceeds (guard passed / nothing-live).
// pendingGuard is true while the operator is viewing the Quit-guard modal.
const quitGuardState: QuitGuardState = { isQuitting: false, pendingGuard: false }

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
  // Hook-status feature — extract the onDelta body into a named handleDelta so that
  // hook deltas can route through the SAME chokepoint (same enrich/column/tray/attention
  // treatment). The spec requires this extraction: hook events call
  // reducer.applyHookStatus(...).forEach(handleDelta) — same path, no new channel.
  function handleDelta(delta: ReducerWatchEventsPayload): void {
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

  launchBoardSeams.set(wc, {
    upsertLaunched: (session) => {
      reducer.upsertLaunched(session).forEach(handleDelta)
    },
    // Story 6.3 — the fast stop/exit removal rides the HOOK-REMOVAL reducer path (REUSE,
    // not a new reducer API): applyHookStatus(id, removed) deletes the session + emits
    // `session.removed`, and the delta takes the SAME handleDelta chokepoint (tracker →
    // tray → ship gate; the launched-set membership is never revoked, so the removed delta
    // passes the gate and the card vanishes). Idempotent: an already-removed / never-
    // synthesized id emits [] SILENTLY (the reducer's removed-path treats unknown-id as
    // the applyStop-style already-gone no-op), so the belt-and-suspenders SessionEnd hook
    // arriving later is quiet.
    removeLaunched: (sessionId) => {
      reducer.applyHookStatus(sessionId, { kind: 'removed' }).forEach(handleDelta)
    },
    // Session-naming A2 — the rename takes the SAME handleDelta chokepoint as every other delta
    // (tracker → tray → enrich → ship gate), so the retitled card reaches the renderer as an
    // ordinary `session.updated`. The tracker does NOT re-stamp `enteredColumnAt` here because the
    // status is unchanged (attention.ts stamps on a COLUMN change only) — the board keeps its
    // order, which is the behavior confirmed during A1 planning.
    renameLaunched: (sessionId, name) => {
      reducer.renameSession(sessionId, name).forEach(handleDelta)
      // Name-sync — the card is renamed above; claude is renamed by ANSWERING its next
      // `UserPromptSubmit` POST with this name (the app cannot rename a running session any
      // other way). Recorded here, pushed once by the hook server, then cleared. Until the
      // operator submits their next prompt the two names disagree — an accepted limit.
      pendingTitles.set(sessionId, name)
    },
    seenLaunched: (sessionId) => {
      reducer.markSeen(sessionId).forEach(handleDelta)
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
    if (launchService === null || terminalManager === null) return false
    const orphan = orphanRegistry.claim(cwd, Date.now(), terminalManager)
    if (orphan === null) return false
    const stored = reducer.snapshotMap().get(orphan.sessionId)
    if (stored === undefined) {
      // The card left by another path (stop/exit) — the orphan record is stale, drop it.
      orphanRegistry.clear(orphan.terminalId)
      return false
    }
    // Main-owned data reshaped by main (parse-once boundary: never re-run through SessionSchema).
    launchedSet.add(newSessionId)
    reducer.upsertLaunched({ ...stored, id: newSessionId }).forEach(handleDelta)
    launchService.rebind(orphan.terminalId, newSessionId)
    sendLaunchCorrelated(wc, orphan.terminalId, newSessionId)
    reducer.applyHookStatus(orphan.sessionId, { kind: 'removed' }).forEach(handleDelta)
    orphanRegistry.clear(orphan.terminalId)
    // PATH + CODE only — never the cwd (leaks the filesystem layout) or any hook field.
    console.warn('[c9watch][hooks] path=(hook) code=hook_session_id_rebound')
    return true
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
      if (change === null) return // unrecognized event — ignore

      // Session-rebind PART 1 — removal is STOP/EXIT-driven (CLAUDE.md); this hook is only
      // belt-and-suspenders. A SessionEnd for a session whose pty is STILL ALIVE is therefore
      // not a removal at all — it is claude changing its own session id mid-run. Keep the card
      // and remember the terminal so the new id can adopt it below.
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

      // Session-rebind PART 2 — an UNKNOWN id posting a status may be that same pty under its
      // new id. Adopt only under sessionRebind.ts's narrow proof; anything looser would put an
      // external session on the board (Story 3.3 ship gate). A miss falls through to the
      // unchanged `hook_unknown_id` no-op below.
      if (change.kind === 'status' && !reducer.snapshotMap().has(evt.session_id)) {
        adoptOrphanedCard(evt.cwd ?? '', evt.session_id)
      }

      // A removed card can have no pending rename to push — drop it so a rename that raced a
      // stop/exit is never delivered to a session that is gone.
      if (change.kind === 'removed') pendingTitles.forget(evt.session_id)

      reducer.applyHookStatus(evt.session_id, change).forEach(handleDelta)
    },
    // Name-sync WRITE — read-and-clear, so the name is pushed to claude exactly ONCE. Pushing
    // it every prompt would fight claude's collision rule and re-suffix the name forever
    // (see pendingTitles.ts).
    takePendingTitle: (sessionId) => pendingTitles.take(sessionId),
    log: (err) => console.warn(`[c9watch][hooks] dropped hook path=${err.path} code=${err.code}`)
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

/** Story 6.4 — the one guarded re-emit of the cold-load-complete signal (see above). */
const ENGINE_STARTED_RESEND_MS = 1_000

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
  // Story 3.5 (SM-2) — remove the per-window tracker reference (same lifetime as the feed).
  // The telemetry IPC handler will see no tracker for a destroyed window → graceful no-op.
  trackers.delete(wc)
  // Story 4.2 (FR-14) — remove the per-window reducer reference (ARCH-FORK-1 option A).
  // Same lifetime as the feed; mirrors the trackers.delete above.
  reducers.delete(wc)
  // Story 6.2/6.3 — remove the per-window launch board seam (same lifetime as the feed).
  // A terminal:open/stop racing a window close finds no seam → graceful no-op.
  launchBoardSeams.delete(wc)
  // Hook-status feature — close the per-window hook listener so a window close→reopen
  // ('activate') or dev HMR reload does not leak the listener and hit EADDRINUSE on the
  // next bind. Idempotent; close() never throws.
  const hookServer = hookServers.get(wc)
  if (hookServer) {
    hookServers.delete(wc)
    hookServer.close()
  }
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
      // Session-rebind — a dead pty can never be adopted, so drop any orphan record for it.
      // `claim` already gates on liveness, so this is hygiene (bounded memory), not correctness.
      orphanRegistry.clear(terminalId)
      // Dead-pane push FIRST (validate at source), THEN the Story-6.3 card removal below —
      // the renderer receives CH.terminalExit (the pane flips dead) before `session.removed`
      // (the card vanishes). A malformed exit never crosses the seam.
      if (wc && !wc.isDestroyed()) {
        const r = TerminalExitSchema.safeParse({ terminalId, exitCode })
        if (!r.success) {
          const issue = r.error.issues[0]
          console.error(
            `[c9watch][term] dropped terminal:exit path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
          )
        } else {
          wc.send(CH.terminalExit, r.data)
        }
      }
      // Story 6.3 — FAST REMOVAL (the double-ctrl+c case): a launched claude that exits for
      // real removes its board card IMMEDIATELY — no SessionEnd hook / feed event needed.
      // Resolve the exact spawn-time binding, clear it (a later Reopen mints a fresh id +
      // binding anyway), and route the removal through the owning window's board seam →
      // reducer.applyHookStatus(removed) → the SAME handleDelta chokepoint. Runs even when
      // the owning window is gone (the unbind keeps the binding lifecycle coherent; the seam
      // lookup is then a graceful no-op). Idempotent: no binding (plain shell / spawn-fail
      // dust / already removed) → no-op; a late SessionEnd for the removed id emits [].
      if (launchService !== null) {
        removeBoundSession(terminalId, launchService, (sessionId) => {
          if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId)
        })
      }
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
    // Story 3.2 (FR-11) / Story 6.2 — if this terminalId is an app LAUNCH (the renderer opened
    // the EmbeddedTerminal against a launch-minted id) AND an ACTUAL pty spawn is about to
    // happen, MINT the session identity at consume time via the extracted `mintForOpen`
    // decision (launchMint.ts — unit-tested; fault-injection-proof): `mintSpawn` mints a
    // fresh `--session-id` uuid, composes the claude spawn for the picked cwd, records the
    // exact terminalId → sessionId binding, and adds the id to the launched-set. A re-open
    // of a LIVE terminal re-attaches (Story 5.6 — no spawn) and must NOT mint/rebind; a
    // Reopen of a DEAD terminal is a real spawn and gets a FRESH id (a consumed --session-id
    // is never re-used). A non-launch terminalId (the Story-3.1 host path) mints null → the
    // unchanged shell spawn.
    const minted = mintForOpen(terminalId, terminalManager, launchService)
    // Open the terminal (manager wires port1 ↔ pty + flow control). Initial dims are the
    // renderer's first fit() over CH.terminalResize; spawn at a sane default until then. A spawn
    // failure degrades to the manager's onExit → CH.terminalExit (dead pane), never a hang.
    // Story 5.6 — pass openToken so the manager can (a) update the stored token on re-attach, and
    // (b) let a stale cleanup-stop (carrying the old token) self-identify as a no-op.
    terminalManager.open(terminalId, adaptMessagePort(port1), 80, 24, minted?.spawn, openToken)
    // Transfer port2 to the renderer, ECHOING the renderer's per-open `openToken` (Story 5.4)
    // alongside the terminalId so the renderer can pair THIS port to THIS open. The token
    // disambiguates a re-open of the SAME terminalId (a StrictMode dev double-mount, or Reopen):
    // without it the renderer's one-shot listener could pair the STALE (already-closed) port from
    // the prior open and ignore the live one → a blank terminal. The renderer listens on
    // CH.terminalOpen for the `{ terminalId, openToken }` payload + `ports[0]`.
    if (!wc.isDestroyed()) wc.postMessage(CH.terminalOpen, { terminalId, openToken }, [port2])
    // Story 6.2 — the INSTANT CARD + EXACT BINDING, synchronously at spawn (same tick):
    if (minted !== null) {
      // pidOf is null iff the spawn FAILED (the manager already degraded to the dead-terminal
      // push and the terminal never entered its map) — synthesize no card for a spawn that
      // never lived (the launched-set/binding dust from the mint is harmless: no delta ever
      // carries that id, and a removal of a never-present id emits nothing).
      const ptyPid = terminalManager.pidOf(terminalId)
      if (ptyPid !== null) {
        // (b) Synthesize the launched Session into THIS window's reducer via upsertLaunched →
        // the SAME handleDelta chokepoint as every c9watch/hook delta. The Session is
        // CONSTRUCTED from main-owned values (the minted uuid, the picked cwd, the pty pid) —
        // internal data, NOT external input, so it is NOT re-run through SessionSchema
        // (parse-once boundary). `Connecting` classifies into the `working` column; hooks own
        // every later transition (UserPromptSubmit → Working, Stop → WaitingForInput, …).
        // Session-naming: the synthesis itself lives in the extracted, unit-tested
        // `buildLaunchedSession` (launchSynthesis.ts) — index.ts is not importable by any test,
        // so inlining it left the operator's name reaching the board through an uncovered
        // expression. Keep this a one-line call; put any synthesis logic in that module.
        launchBoardSeams.get(wc)?.upsertLaunched(buildLaunchedSession(minted, ptyPid))
        // (d) Push the exact terminalId ↔ sessionId binding to the owning window IMMEDIATELY —
        // the Starting-banner join is instant (no ancestry walk, no c9watch discovery wait).
        // Validate AT SOURCE before send (main→renderer delta; zod-boundaries.md), exactly as
        // the ancestry-correlation push does; PATH + CODE only on a miss (Guardrail #6). The
        // renderer's boardStore.addCorrelation is idempotent, and mintSpawn marked the launch
        // already-joined so the ancestry walk can never fire a second push for this pair.
        sendLaunchCorrelated(wc, terminalId, minted.sessionId)
      }
    }
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
    //
    // Story 6.3 — FAST REMOVAL: when THIS stop actually tears the pty down (NOT a stale-token
    // StrictMode no-op, NOT an already-dead terminal — the helper's live-before/after gate),
    // the bound launched session is removed from the owning window's reducer on the same tick:
    // binding resolved + cleared, then applyHookStatus(removed) → handleDelta →
    // `session.removed` → the card vanishes NOW, with no dependency on any external event.
    // An explicit stop fires NO manager onExit, so this handler is the removal's ONLY trigger.
    stopTerminalAndRemoveBound(
      terminalId,
      openToken,
      terminalManager,
      launchService,
      (sessionId) => {
        const wc = terminalOwners.get(terminalId)
        if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId)
      }
    )
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
//
// STORY 6.2 UPDATE: now a FACTORY over the freshly-minted session id. The launch service calls
// it once per ACTUAL pty spawn so the composed command pins claude to the app-minted identity:
// `$SHELL -l -c "claude --session-id '<uuid>'"`. The uuid is single-quoted for the shell (it is
// a crypto randomUUID — hex + dashes — so quoting is belt-and-suspenders, but the command string
// passes through a shell and MUST NOT rely on that). The `$SHELL -l -c` wrapper is unchanged
// (the login-shell PATH/rc benefit). The env is computed per spawn (fresh buildPtyEnv).
//
// CACHYOS/ARCH + KDE FIX: the "login-shell PATH/rc benefit" claimed above does NOT hold on
// Arch. A KDE-menu-launched app inherits the graphical-session PATH (no `~/.local/bin`), and
// `bash -l -c` sources `~/.bash_profile` → `~/.bashrc`, whose stock Arch first line is
// `[[ $- != *i* ]] && return` — `-c` is non-interactive, so it returns BEFORE the
// `export PATH="$HOME/.local/bin:$PATH"` below it. Bare `claude` was therefore not found,
// bash exited 127, the pty died instantly, and the board showed "Terminal exited." with no
// reason. (It worked under `npm run dev` only because that inherits an INTERACTIVE PATH.)
// So main resolves the binary to an ABSOLUTE path itself (claudeBin.ts) instead of trusting
// the shell, and prepends its directory to the child PATH so claude's own subprocesses get
// the same lookup the operator has in a terminal. The `$SHELL -l -c` wrapper is UNCHANGED —
// it is load-bearing for pid correlation (claude must be a CHILD of the pty leader, F3).
function rawClaudeSpawn(
  sessionId: string,
  displayName: string
): {
  file: string
  args: string[]
  env: Record<string, string>
} {
  const env = buildPtyEnv()
  const claude = resolveClaudeBin({
    isExecutable: (p) => {
      try {
        accessSync(p, fsConstants.X_OK)
        return true
      } catch {
        return false // missing / not executable / unreadable dir — never throws out
      }
    },
    path: env.PATH,
    home: os.homedir(),
    override: env.CLAUDE_WATCHER_CLAUDE_BIN
  })

  // Log the PROVENANCE CODE only — never the resolved path (it leaks the operator's
  // filesystem layout; zod-boundaries.md never-log-the-value). `unresolved` is the code to
  // look for when a launch dies instantly again.
  console.log(`[c9watch][launch] claude_bin source=${claude.source}`)

  const childPath = prependToPath(claude.dir, env.PATH)
  if (childPath !== undefined) env.PATH = childPath

  return {
    file: SHELL,
    // Composed in claudeBin.ts, NOT inlined here: nothing can import index.ts, so the quoting
    // of the operator-typed name would otherwise be untestable. Name-sync adds `-n <name>` so
    // claude runs under the operator's name instead of generating its own title, and
    // `--settings <file>` carries the hook block WITHOUT touching the operator's project.
    args: [
      '-l',
      '-c',
      composeClaudeCommand(claude.command, sessionId, displayName, hookSettingsPathForSpawn())
    ],
    env
  }
}

// Push an exact terminalId ↔ sessionId binding to a window (the Starting-banner join). Validated
// AT SOURCE before send (main→renderer delta; zod-boundaries.md), PATH + CODE only on a miss
// (Guardrail #6). The renderer's boardStore.addCorrelation is idempotent, so a repeat push for an
// unchanged pair is free. Two call sites: the spawn-time mint (Story 6.2) and the session-rebind
// adoption (a live terminal re-pointed at claude's new session id).
function sendLaunchCorrelated(
  wc: Electron.WebContents,
  terminalId: string,
  sessionId: string
): void {
  const r = LaunchCorrelatedSchema.safeParse({ terminalId, sessionId })
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[c9watch][launch] dropped launch:correlated path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  if (!wc.isDestroyed()) wc.send(CH.launchCorrelated, r.data)
}

// Claude version gate — read the installed version the SAME way the spawn resolves it.
//
// The spawn runs `$SHELL -l -c "<claude> ..."`, and `resolveClaudeBin` may legitimately hand
// back a bare `claude` that only resolves on the login shell's PATH. Probing through anything
// else would report "missing" for an install that works fine, so the probe uses the same shell.
//
// CACHING: only an `ok` verdict is cached. A blocked or unreadable result is re-probed on the
// next launch, so upgrading claude un-blocks the app WITHOUT restarting it. The probe costs
// ~67ms on this machine — cheap enough per launch, but not worth paying once it has passed.
//
// NEVER-LOG-THE-VALUE: the resolved command is never logged, only a `code=`.
let cachedVersionOk = false
function readClaudeVersionRaw(): string | null {
  try {
    const claude = resolveClaudeBin({
      isExecutable: (p) => {
        try {
          accessSync(p, fsConstants.X_OK)
          return true
        } catch {
          return false
        }
      },
      path: process.env.PATH,
      home: os.homedir(),
      override: process.env.CLAUDE_WATCHER_CLAUDE_BIN
    })
    return execFileSync(SHELL, ['-l', '-c', `${shellQuote(claude.command)} --version`], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    // Missing binary, non-zero exit, timeout — all "unknown", which ALLOWS the launch.
    console.warn('[c9watch][version] code=claude_version_unreadable')
    return null
  }
}

/**
 * Block the launch when claude is verifiably too old. Returns true when the launch may proceed.
 *
 * The renderer SWALLOWS a rejected launch invoke (`catch { code=launch_failed }`), so throwing
 * alone would close the dialog and show the operator nothing at all — a silent no-op, which is
 * worse than the confusing terminal error this gate exists to replace. Main therefore surfaces
 * the reason itself with a native error box, then the caller throws so nothing spawns. Doing it
 * here avoids a new IPC channel (which the seam rule would otherwise require in 4-file lockstep).
 */
function claudeVersionAllowsLaunch(): boolean {
  if (cachedVersionOk) return true

  const gate = gateClaudeVersion(readClaudeVersionRaw())
  if (gate.kind === 'ok') {
    cachedVersionOk = true
    return true
  }
  if (gate.kind === 'unknown') {
    // FAIL-OPEN: a version we cannot read must not brick a working install. See claudeVersion.ts.
    console.warn('[c9watch][version] code=claude_version_unknown_allowing_launch')
    return true
  }

  console.warn('[c9watch][version] code=claude_version_too_old')
  dialog.showErrorBox('Update claude', tooOldMessage(gate.version, gate.min))
  return false
}

// Hook delivery — the app's OWN settings file, handed to claude with `--settings`.
//
// ZERO FOOTPRINT: this writes into `app.getPath('userData')`, never into the operator's
// project. It replaced a merger that wrote the hook block into the launched project's
// `.claude/settings.local.json`, which left a permanent trace in every directory the app was
// ever launched in — one a plain `claude` in that folder then kept firing forever.
//
// Ordering: resolved at spawn-composition time, which is inside the `claude` spawn itself, so
// the file is on disk before claude reads it.
//
// NEVER-CRASH: a failed write must not fail the launch. `ensureHookSettingsFile` swallows its
// own IO errors and returns null; the try/catch is belt-and-braces for an unexpected throw.
// Either way the flag is omitted and the session spawns WITHOUT status reporting — degraded,
// not dead. NEVER-LOG-THE-VALUE: the path is never logged, only a `code=`.
function hookSettingsPathForSpawn(): string | null {
  try {
    return ensureHookSettingsFile({
      dir: app.getPath('userData'),
      log: (msg) => console.warn(msg)
    })
  } catch {
    console.warn('[c9watch][hookSettings] code=hook_settings_unavailable')
    return null
  }
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
    // Story 6.2 — the spawn FACTORY (not a static config): composes the raw-claude command for
    // each freshly-minted session id at actual-spawn time (mintSpawn).
    spawn: rawClaudeSpawn,
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
    // Both fields are UNTRUSTED cross-process input. `name` comes back already TRIMMED and
    // length-bounded (SessionNameSchema); a blank/whitespace-only/over-long name rejects the
    // invoke here and NOTHING spawns. Never log either value on the throw path — a cwd leaks
    // the filesystem layout and a name is operator content (zod-boundaries.md).
    const { cwd, name } = SessionLaunchSchema.parse(raw)
    // Version gate — refuse to spawn against a claude too old for the flags the spawn depends
    // on (`--session-id`, `-n`, `--settings`). An unknown flag kills the session instantly with
    // an error that looks nothing like "your claude is old", so this fails EARLY and says why.
    // Unknown/unreadable versions are allowed through (claudeVersion.ts explains the inversion).
    if (!claudeVersionAllowsLaunch()) {
      throw new Error('claude version below the supported minimum')
    }
    // NOTE: nothing is written into `cwd`. Hooks ride `--settings` from the app's own data dir,
    // resolved at spawn-composition time (see hookSettingsPathForSpawn). The launch path used
    // to merge a hook block into this project's `.claude/settings.local.json` — it no longer
    // touches the operator's project at all.
    const { terminalId } = launchService.launch({ cwd, name })
    return { terminalId }
  })

  // session:rename — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary: a
  // blank id, or a blank/whitespace-only/over-long/control-char name, rejects the invoke and
  // NOTHING is renamed. NEVER log either value on the throw path — the name is operator content
  // (zod-boundaries.md IPC-arg row); the throw IS the signal.
  //
  // Routed by `event.sender` to the OWNING window's seam, exactly like the launch board seam
  // above: session truth is per-window (one reducer per WebContents), so a rename must land in
  // the reducer that owns that board — never broadcast to every window.
  //
  // An unknown id is NOT an error here: the reducer logs `rename_unknown_id` and emits nothing
  // (a rename racing a stop/exit that already removed the card). Returns void — the retitled card
  // arrives as a normal `session.updated` delta.
  ipcMain.handle(CH.sessionRename, (event, raw: unknown) => {
    const { id, name } = SessionRenameSchema.parse(raw)
    launchBoardSeams.get(event.sender)?.renameLaunched(id, name)
  })

  // session:seen — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Routed by
  // event.sender to the owning window's seam (session truth is per-window). The reducer's
  // markSeen guard makes a stale seen harmless — only YourTurn demotes. Returns void; the
  // demoted card arrives as a normal `session.updated` delta.
  ipcMain.handle(CH.sessionSeen, (event, raw: unknown) => {
    const { id } = SessionSeenSchema.parse(raw)
    launchBoardSeams.get(event.sender)?.seenLaunched(id)
  })
}

// Terminal clipboard feature — register the clipboard text bridge ONCE (mirrors
// registerSettingsIpc / registerTerminalIpc single-registration; Review-F1). Power stays in
// MAIN (Electron `clipboard` module; sandboxed renderer NEVER touches the OS clipboard
// directly — security posture). Channels are CH.* consts — never a string literal.
// The write arg is UNTRUSTED cross-process input → parse-and-throw-typed
// (zod-boundaries.md IPC-arg row). NEVER log the clipboard text value (user content;
// Guardrail #6 — the throw IS the signal). The read handler has no arg.
function registerClipboardIpc(): void {
  // clipboard:read-text — read the OS clipboard text and return it directly. No arg to
  // parse; the read is safe (no cross-process input). Returns '' if the clipboard has no
  // text (e.g. image-only clipboard), which the renderer interprets as "Paste disabled".
  ipcMain.handle(CH.clipboardReadText, () => clipboard.readText())

  // clipboard:write-text — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS
  // boundary (a malformed write arg rejects the invoke). NEVER log the text value —
  // the throw IS the signal; user clipboard content must not enter the log stream
  // (Guardrail #6; .claude/rules/zod-boundaries.md IPC-arg row).
  ipcMain.handle(CH.clipboardWriteText, (_evt, raw: unknown) => {
    const { text } = ClipboardWriteTextSchema.parse(raw)
    clipboard.writeText(text)
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
      raiseWindow: () => {
        /* no-op: the window is already up — the operator just clicked the modal's button */
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

  // Fallback show (2026-08-03). `ready-to-show` fires off the renderer's FIRST PAINTED FRAME.
  // With hardware acceleration disabled it never fired at all on this KWin/Wayland host, so
  // `show()` was never called and the app ran headless: process alive, window never mapped, no
  // error anywhere. `did-finish-load` fires off the DOM/load lifecycle instead, so it is
  // independent of whether a frame ever reached the compositor. `show()` is idempotent, and
  // whichever event lands first wins — the normal path is unchanged.
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
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

  // CAPTURED BEFORE destruction: by the time `'closed'` fires the BrowserWindow is destroyed
  // and even the `webContents` GETTER throws `Object has been destroyed` (Electron surfaces it
  // as the main-process error popup on every real quit — the tray-Quit bug). The registries
  // below key by the WebContents OBJECT reference, which stays valid as a Map key after
  // destruction, so capturing at registration time is both safe and sufficient.
  const closedWc = mainWindow.webContents
  mainWindow.on('closed', () => {
    const wc = closedWc
    ptys.get(wc)?.kill()
    ptys.delete(wc)
    // Drop this window's session-engine registries + close its hook listener.
    // Independent of the PTY teardown below.
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

  // Story 6.4 — start the native session engine for this window once it is ready to
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

// ── GPU OFF (2026-08-03 incident) ────────────────────────────────────────────────────────────
//
// This app renders on the CPU. Not a preference — the GPU path was killing live terminals.
//
// Evidence (kernel log, 2026-08-03 13:22:27, and the same signature on 2026-07-31):
//   amdgpu 0000:05:00.0: [gfxhub] page fault (src_id:0 ring:24 vmid:7 pasid:86)
//   amdgpu 0000:05:00.0:  Process claude-watcher pid 8544 thread claude-wat:cs0 pid 8580
//   amdgpu: Faulty UTCL2 client ID: SQC (data)   PERMISSION_FAULTS: 0x3
//   amdgpu: ring gfx_0.0.0 timeout → Starting gfx_0.0.0 ring reset → reset succeeded
// A shader in OUR GPU process read memory it was not allowed to read, the graphics ring hung,
// and the driver reset it. Every live WebGL context died at once, so every open terminal went
// blank while its PTY was perfectly healthy. `coredumpctl` shows NO coredump — the app never
// crashed; only the GPU context did. The host is a hybrid laptop and the faulting device is the
// AMD integrated GPU (05:00.0), not the NVIDIA dGPU.
//
// The real defect is below us (a userspace app must not be able to page-fault the GPU — mesa
// 26.1.6 / kernel 7.1.5-cachyos). What WE control is whether we keep handing it shader work.
// `EmbeddedTerminal`'s onContextLoss recovery is still there and still tested, but recovery is
// not prevention: every NEW terminal armed a fresh WebGL context, so the fault kept coming back.
//
// disableHardwareAcceleration() alone is not enough: with the GPU off, Chromium falls back to
// SwiftShader for WebGL, so `new WebglAddon()` would still SUCCEED and xterm would render
// through a SOFTWARE GL stack — slower than xterm's own canvas/dom renderer, and for no gain.
// `disable-software-rasterizer` removes that fallback, so WebGL is genuinely absent, the
// existing try/catch in EmbeddedTerminal takes the canvas branch, and the renderer is honest
// about what it is. Both calls MUST happen before the `ready` event. [.claude/rules/terminal.md]
//
// GOTCHA (2026-08-03, cost an afternoon): turning the GPU off makes `ready-to-show` never fire
// on this KWin/Wayland host, because that event rides the renderer's first PAINTED FRAME. The
// window was created but never shown — the app looked like it "failed to start" while the
// process sat there healthy and silent. The `did-finish-load` fallback next to the
// `ready-to-show` handler in createWindow() is what keeps the window appearing. Do not remove
// it while these switches are here. The packaged smoke gate does NOT cover this: it drives the
// renderer's data model, never the compositor, so it passed green while the window was invisible.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-software-rasterizer')

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app
  .whenReady()
  .then(() => {
    // Set app user model id for windows. CANONICAL appId = `com.claudewatcher.app` (Story 2.3
    // AC-6): must match `electron-builder.yml` (`appId`) + the `.desktop` file's
    // `StartupWMClass`/filename so the tray + notification OS identity is consistent. [FROZEN #5;
    // AR-10]
    electronApp.setAppUserModelId('com.claudewatcher.app')

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

    // Terminal clipboard feature — register the clipboard text bridge ONCE (clipboard:read-text,
    // clipboard:write-text). Power stays in MAIN; renderer reaches it via window.clipboard.*.
    registerClipboardIpc()

    // NOTE: there is NO hook registration step — not here, not per-launch. The hook block is
    // handed to each spawned `claude` via `--settings` from the app's own data dir
    // (hookSettingsPathForSpawn). The app writes into no project and no user settings file.
    //
    // It does NOT clean up after the retired merger either: blocks that merger left in a
    // project's `.claude/settings.local.json` are the OPERATOR's to remove. They are harmless
    // — a stale block on the same URL is deduped against the flag, so one prompt still yields
    // exactly one POST (probe-verified). Deleting an operator's settings entries unasked would
    // be a worse footprint than the one this change removes.

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
      clearTerminalOwners: () => terminalOwners.clear()
    },
    computeLiveLaunchedSessions,
    computeDeps: {
      reducers: reducers.values(),
      isLaunched: (id) => launchedSet.has(id)
    },
    // The guard modal is only useful if the operator can SEE it. A title-bar close MINIMIZES
    // this app (the `close` handler above), so the usual route to the tray Quit leaves the
    // window down — and the pushed modal was landing in a window nobody was looking at, making
    // Quit look like a no-op. Restore + show + focus before the push.
    //
    // This is the ONE operator-initiated exception to no-self-raise (Epic-4 DECISION #2 /
    // FROZEN #4): the rule bans raising on session ATTENTION, and nothing here reacts to a
    // session. It answers the operator's own Quit click. Do NOT copy this to a delta path.
    //
    // never-crash: a raise failure must not cost the operator the guard, so the push proceeds
    // regardless. Log a code ONLY (no window/session values).
    raiseWindow: () => {
      if (!mainWin || mainWin.isDestroyed()) return
      try {
        if (mainWin.isMinimized()) mainWin.restore()
        mainWin.show()
        mainWin.focus()
      } catch {
        console.warn('[c9watch][quit] code=quit_guard_raise_failed')
      }
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
