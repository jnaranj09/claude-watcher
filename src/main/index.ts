import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  dialog,
  clipboard,
  nativeTheme,
  Menu
} from 'electron'
import type { MessagePortMain } from 'electron'
import { join } from 'path'
import { writeFileSync, accessSync, constants as fsConstants } from 'fs'
import { statSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { electronApp, is } from '@electron-toolkit/utils'
import * as os from 'os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import icon from '../../resources/icon.png?asset'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type {
  PtyResizeRequest,
  SmokeConfig,
  SmokeReport,
  TerminalPortMainMessage,
  TerminalPortRendererMessage,
  ReducerWatchEventsPayload,
  PastSessionOpenResult
} from '../shared/ipc/contract'
// Story 3.1 (FR-10) — the embedded-terminal transport: the MAIN-side terminal manager (one
// node-pty per terminal behind the ptyFactory DI seam + the validated, flow-controlled
// MessagePort byte path) + its cross-process IPC-arg schemas (parse-and-throw at the boundary).
import { createTerminalManager, type PortLike, type TerminalManager } from './pty/terminalManager'
import {
  resolveClaudeBin,
  composeClaudeCommand,
  prependToPath,
  shellQuote,
  QUESTION_FORMAT_PROMPT
} from './pty/claudeBin'
// Version gate — the spawn depends on `--session-id`, `-n` and `--settings`; a claude that
// does not know one of them dies instantly instead of degrading. Fails OPEN on an unreadable
// version (see claudeVersion.ts for why that inversion is deliberate).
import { createClaudeVersionGate } from './pty/claudeVersion'
import {
  TerminalOpenSchema,
  TerminalResizeSchema,
  TerminalStopSchema,
  TerminalExitSchema
} from '../shared/schemas/terminal'
// Story 1.4 fix — validate-at-source for the watch:status connection-state push.
// Story 2.2 — validate-at-source for the FR-9 attention:activate push.
import { WatchStatusSchema, ViewFocusedTerminalSchema } from '../shared/schemas/watchDelta'
// Story 2.2 — the KDE attention notifier (Electron Notification → libnotify), behind a DI
// seam. Fires 1:1 off the tracker's attention.raised; informational only (NO self-raise).
import { createAttentionNotifier } from './kde/notifications'
// Attention reminders (spec 2026-09-10) — re-notify a session still blocked on you.
import { createAttentionReminders, type AttentionReminders } from './kde/attentionReminders'
// F1 (final-review fix wave) — the extracted, independently-tested `remind` callback body.
import { createReminderSink } from './kde/reminderSink'
import { createNotificationActivate } from './kde/notificationActivate'
import { isViewingSession } from './kde/viewedSession'
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
import { shouldEmitRaise, shouldShipToBoard } from './c9watch/shipGate'
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
import { SettingsPatchSchema, DEFAULT_SETTINGS } from '../shared/schemas/settings'
import { createWorkspacesStore, type WorkspacesStore } from './persistence/workspaces'
import {
  createWorkspacesIpcHandlers,
  parseSessionWorkspaceMove,
  pickDirectoryDefaultPath
} from './persistence/workspacesIpc'
import { createElectronWorkspacesBlobStore } from './persistence/electronWorkspacesBlobStore'
import {
  createTemplatesStore,
  type TemplateRuleRef,
  type TemplatesStore
} from './persistence/templates'
import { createElectronTemplatesBlobStore } from './persistence/electronTemplatesBlobStore'
import { createTemplatesIpcHandlers } from './persistence/templatesIpc'
import { createShortcutsStore, type ShortcutsStore } from './persistence/shortcuts'
import { createElectronShortcutsBlobStore } from './persistence/electronShortcutsBlobStore'
import { createShortcutsIpcHandlers } from './persistence/shortcutsIpc'
// Past sessions — the main-owned archive of ended app-launched sessions (its own file; a
// corrupt history can never reset settings/templates/workspaces).
import { createPastSessionsStore, type PastSessionsStore } from './persistence/pastSessions'
import { createLivePastSessions } from './persistence/livePastSessions'
import { createElectronPastSessionsBlobStore } from './persistence/electronPastSessionsBlobStore'
import { createPastSessionsIpcHandlers } from './persistence/pastSessionsIpc'
// Past sessions (D-3) — the PURE, unit-tested reason → history decision (archive writes the
// record via buildPastSessionRecord; delete removes any earlier one; a null store no-ops).
import { applyRemovalReason } from './persistence/pastSessionRecord'
import { createTagsStore, type TagsStore } from './persistence/tags'
import { createElectronTagsBlobStore } from './persistence/electronTagsBlobStore'
import { keepVisibleTags } from '../shared/tags/tagScope'
import { createTagsIpcHandlers, parseSessionSetTags, staleTagEdits } from './persistence/tagsIpc'
import type { Tag } from '../shared/schemas/tag'
// Rules — the main-owned rule list (Phase 2): the store + its IPC handler bodies + its Electron
// blob store (mirrors tags/templates), the per-window engine, the launch-time rules, the pure
// evaluation snapshot type, and the delta-pipeline order the engine depends on (spec §2.2).
import { createRulesStore, type RulesStore, type RulesStoreOptions } from './persistence/rules'
import { createElectronRulesBlobStore } from './persistence/electronRulesBlobStore'
import { createRulesIpcHandlers } from './persistence/rulesIpc'
import type { TagRuleRef } from './persistence/tags'
import { createRulesEngine, type RulesEngine } from './rules/rulesEngine'
import { launchTags } from './rules/launchTags'
import type { RulesSnapshot } from './rules/evaluateRules'
import { runDeltaPipeline } from './rules/deltaPipeline'
import { resolveTemplateLaunch } from './pty/launchFromTemplate'
import type { ClaudeLaunchFlags } from './pty/launchSession'
// Story 3.2 (FR-11) — the in-app LAUNCH flow built ON TOP of the Story-3.1 terminal: the raw
// `claude` launch service (reuses the terminal manager + ptyFactory; reuses pidCorrelation.ts
// for the Tgid join) + the per-run launched-set it POPULATES. The picked dir + launch request
// are UNTRUSTED cross-process input → Zod parse-and-throw at the boundary (never log the path).
import {
  createLaunchService,
  FOLDER_MISSING_MESSAGE,
  isFolderMissing,
  type LaunchService
} from './pty/launchSession'
// Story 6.3 — FAST REMOVAL: the extracted stop/exit removal decision (unit-tested in
// launchRemoval.test.ts). Stop and PTY-exit resolve the exact spawn-time terminalId →
// sessionId binding, clear it, and route the bound session's removal through the owning
// window's reducer → the SAME handleDelta chokepoint (session.removed → card gone NOW,
// no SessionEnd hook / feed event needed). Past sessions: `archiveBoundSessions` is the same
// removal for the paths that fire NO onExit (quit, window close).
import {
  archiveBoundSessions,
  deleteTerminalSession,
  removeBoundSession,
  stopTerminalAndRemoveBound,
  type RemovalReason
} from './pty/launchRemoval'
// Story 6.2 — the extracted "should this open MINT?" decision (unit-tested in
// launchMint.test.ts, mirroring the launchRemoval extraction): mint ONLY when an ACTUAL
// pty spawn is about to happen — a re-attach to a LIVE terminal must never mint a second
// uuid / ghost card / binding overwrite.
import { mintForOpen } from './pty/launchMint'
// Session-naming — the extracted, unit-tested launch-card synthesis (see launchSynthesis.ts).
import { buildLaunchedSession } from './pty/launchSynthesis'
import { createLaunchedSet, type LaunchedSet } from './pty/launchedSet'
// Past sessions (D-1) — the extracted "can this record be reopened?" decision
// (unit-tested in pastSessionOpen.test.ts, mirroring the launchMint/launchRemoval extraction).
import {
  openPastSession,
  resumeTerminalSession,
  type PastSessionOpenDeps
} from './pty/pastSessionOpen'
import { readStatusFromProc } from './pty/pidCorrelation'
import { createProcessSessionSourceFromFs } from './pty/claudeSessionFile'
import { createRunningElsewhereCheckFromFs } from './pty/runningElsewhere'
import {
  SessionLaunchSchema,
  SessionRenameSchema,
  SessionSeenSchema,
  LaunchCorrelatedSchema,
  LaunchRequestedSchema,
  SessionArchiveSchema,
  SessionDeleteSchema
} from '../shared/schemas/launch'
// Programmatic API — the localhost HTTP listener and everything behind it. Every decision in it
// lives in one of these modules and is unit-tested there; this file only WIRES them (nothing can
// import index.ts, so no logic may live here that a test would need to reach).
import { createApiServer, type ApiServer } from './api/apiServer'
import { createApiEventHub, type ApiEventHub, type ApiSeam } from './api/apiSeam'
import { createApiTokenStore, type ApiTokenStore } from './api/apiToken'
import { createApiLifecycle, type ApiLifecycle } from './api/apiLifecycle'
import { buildOpenApiDocument } from './api/openapi'
import { createDocsRoutes, resolveSwaggerDistDir } from './api/docs'
import { apiCommands } from './api/commands'
import { projectApiSession } from './api/apiSession'
import { API_SPAWN_TIMEOUT_MS } from './api/apiContract'
import type { ApiSession } from '../shared/schemas/api'
// Custom themes — the folder scanner (T5) and the apply lifecycle (T11), wired below.
import { createThemeScanner, type ThemeScanner } from './themes/themeScanner'
import { BUNDLED_THEME_IDS, bundledThemesDir } from './themes/bundledThemes'
import { createThemeLifecycle, type ThemeLifecycle } from './themes/themeLifecycle'
import { chosenWallpaper, themeNeedsReapply } from './themes/themeApplyTrigger'
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
// External links — every clicked link (terminal, window.open, a navigation) goes through ONE gate
// that opens http(s) in the OS default browser and refuses everything else.
import { LinkOpenExternalSchema } from '../shared/schemas/link'
import { createExternalLinks, installLinkGuards } from './links/externalLinks'
import { applicationMenuTemplate, installDevToolsToggle } from './appMenu/appMenu'
import { containSmokeReport, registerSmokeIpc } from './smoke/smokeIpc'
// Hook-status feature — real-time session status from Claude Code lifecycle hooks.
// The hook server binds a localhost HTTP listener; hook events flow through the SAME
// handleDelta chokepoint as c9watch deltas (same enrich/column/tray treatment).
// ZERO FOOTPRINT: the hook block is handed to claude as `--settings <file>` from the app's
// OWN data dir. The app writes NOTHING into the operator's projects — no
// `.claude/settings.local.json`, no `~/.claude/settings.json` — and the hooks scope to
// exactly the sessions it spawns. (This replaced the retired registerHooks merger.)
import { createHookServer, type HookServer } from './hooks/hookServer'
import { buildPtyEnv } from './pty/ptyEnv'
import { isInterruptKey } from './pty/interruptKey'
import { approvalStatusChange } from './pty/approvalKey'
import { hookStatus } from './hooks/hookStatus'
import { createTranscriptWatcher, type TranscriptWatcher } from './hooks/transcriptWatcher'
import { forgetSession, trackHookEvent, type SessionTrackingDeps } from './hooks/sessionTracking'
import { ensureHookSettingsFile, hookSettingsPathIfListening } from './hooks/hookSettingsFile'
import { createServerHealth } from './serverHealth'
import { ServerHealthSchema, type ServerHealth } from '../shared/schemas/serverHealth'
import { createStorageHealth } from './storageHealth'
import { StorageHealthSchema, type StorageHealth } from '../shared/schemas/storageHealth'
import { claimSingleInstance } from './lifecycle/singleInstance'
// Session-rebind — claude can change its own session id mid-run (a `/clear` keeps the pty and
// the terminal, but fires SessionEnd for the old id and posts every later hook under a new
// one). These two decisions keep the card through that switch. [hooks/sessionRebind.ts]
import {
  claimByProcess,
  createOrphanRegistry,
  isAdoptableSessionId,
  sessionEndKeepsCard
} from './hooks/sessionRebind'
// Name-sync — the per-window store of names waiting to be pushed to claude on its next
// UserPromptSubmit hook POST (the only way to rename an already-running session).
import { createPendingTitles } from './hooks/pendingTitles'
import { renameLaunched as renameLaunchedCard } from './hooks/renameLaunched'
// Name-sync — the read-back decision (claude is the authority on its own name). Pure + here
// rather than inline, so it is testable: nothing can import index.ts.
import { titleReadBackRename } from './hooks/titleReadBack'
import { PROFILE } from './profile'

// Smoke mode (Story 0.1 AC-3): when C9_SMOKE=1, the renderer runs a scripted
// type -> read-back -> resize -> TUI sequence and reports a JSON verdict, which
// we persist to C9_SMOKE_OUT (or stdout) and then exit. This makes the packaged
// exit gate machine-verifiable in a headless/autonomous run.
const SMOKE = process.env.C9_SMOKE === '1'
const SMOKE_OUT = process.env.C9_SMOKE_OUT || ''

// The run profile (`./profile.ts`): `npm run dev` keeps its data in its OWN userData dir and
// binds its own ports, so it runs beside the installed app without sharing a byte of state.
// userData must be moved BEFORE app-ready — every store below is built after it.
if (PROFILE.name !== 'default') {
  app.setPath('userData', join(app.getPath('appData'), PROFILE.userDataDirName))
  console.log(`[claude-watcher][profile] name=${PROFILE.name} hookPort=${PROFILE.hookPort}`)
}
const PROFILE_SETTINGS_DEFAULTS = { ...DEFAULT_SETTINGS, apiPort: PROFILE.apiPort }

// One app per profile (UX-04, `lifecycle/singleInstance.ts`). Taken AFTER the profile moved
// userData, because the lock lives there. A second launch quits at once — before app-ready,
// before any store or listener exists — and the first instance raises its window instead.
const IS_PRIMARY_INSTANCE = claimSingleInstance({
  smoke: SMOKE,
  requestLock: () => app.requestSingleInstanceLock(),
  onSecondInstance: (handler) => {
    app.on('second-instance', handler)
  },
  raise: () => raiseMainWindow(),
  log: (line) => console.log(line)
})
if (!IS_PRIMARY_INSTANCE) app.exit(0)

// Server health (UX-05, SEC-6, R11) — whether the hook ingest and the API really bound. Every
// change is pushed to the window (banner + Settings), validated AT SOURCE.
const serverHealth = createServerHealth({
  hookPort: PROFILE.hookPort,
  onChange: (health) => pushServerHealth(health)
})

function pushServerHealth(health: ServerHealth): void {
  const r = ServerHealthSchema.safeParse(health)
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[claude-watcher][health] dropped server-health path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(CH.serverHealth, r.data)
  }
}

// Storage health (UX-06, UX-07) — store files that could not be read or written this run. Every
// store reports into it; every new problem is pushed to the window (the notice), validated AT
// SOURCE. Store name + code only, never a path.
const storageHealth = createStorageHealth({
  onChange: (health) => pushStorageHealth(health)
})

function pushStorageHealth(health: StorageHealth): void {
  const r = StorageHealthSchema.safeParse(health)
  if (!r.success) {
    const issue = r.error.issues[0]
    console.error(
      `[claude-watcher][health] dropped storage-health path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
    )
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(CH.storageHealth, r.data)
  }
}

// Restore + show + focus the one window. Operator-initiated ONLY (a second launch of the app);
// never call it from a session event — the no-self-raise rule (Epic-4 DECISION #2) stands.
function raiseMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  try {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } catch {
    console.warn('[claude-watcher][instance] code=raise_failed')
  }
}

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
const orphanRegistry = createOrphanRegistry({
  // A live, cwd-matching orphan refused by the window ALONE is the one refusal that leaves a
  // healthy terminal with a frozen card (the exact proof below normally prevents it). CODE only.
  onWindowRefusal: () =>
    console.warn('[c9watch][hooks] path=(hook) code=hook_rebind_window_expired')
})
// Session-rebind PART 2b — claude's own per-process records (`~/.claude/sessions/<pid>.json`),
// the exact "this pty now runs id B" proof. Read only when an unknown id posts a status hook.
const processSessions = createProcessSessionSourceFromFs()
// UX-14 — Open/Resume refuse an id a live claude outside the app already runs (fails open).
const runningElsewhere = createRunningElsewhereCheckFromFs()

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

// UX-13 — the terminal each window's renderer shows in its focused view (null on the board),
// pushed over CH.viewFocusedTerminal. Read by `isViewingSession` so the alert for the session the
// operator is typing in is skipped. Deleted in teardownWatchFeed.
const focusedTerminals = new Map<Electron.WebContents, string | null>()

// Rules — one engine per window (spec §2.6, settled in the Phase 2 plan): the reducer is per
// window, so the engine lives exactly as long as the sessions it tags. Created in
// registerWatchFeed, disposed in teardownWatchFeed (mirrors reminderSchedulers).
const ruleEngines = new Map<Electron.WebContents, RulesEngine>()

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
const launchBoardSeams = new Map<Electron.WebContents, LaunchBoardSeam>()

// Programmatic API — the per-window seam + its event hub, EXACTLY the lifetime of the board seam
// above (set in registerWatchFeed, dropped in teardownWatchFeed). Session truth is per window; the
// LISTENER is app-global and reads the single window's seam (`BrowserWindow.getAllWindows()[0]`),
// answering `no_window` when there is none. The hub is held in its own map only so the teardown can
// clear its subscribers — nothing else reads it.
const apiSeams = new Map<Electron.WebContents, ApiSeam>()
const apiHubs = new Map<Electron.WebContents, ApiEventHub>()

// Programmatic API — the bearer token store (its own 0600 file in userData) and the listener's
// lifecycle. Both built after app-ready; null until then. The lifecycle is the ONLY thing that
// starts or stops the listener — settings drive it (`apply`), quit ends it (`stop`).
let apiTokenStore: ApiTokenStore | null = null
let apiLifecycle: ApiLifecycle | null = null

// Custom themes — the folder scanner and the apply lifecycle, built after app-ready (userData).
let themeScanner: ThemeScanner | null = null

/** Liquid Glass and Paper ship READ-ONLY inside the app and win an id clash (spec 2026-09-25):
 *  <resourcesPath>/themes packaged, the repo's docs/themes/examples otherwise. One place, so the
 *  app's scanner and the smoke's probe read the same root. */
function bundledThemes(): { dir: string; ids: typeof BUNDLED_THEME_IDS } {
  return {
    dir: bundledThemesDir({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      mainDir: __dirname
    }),
    ids: BUNDLED_THEME_IDS
  }
}
let themeLifecycle: ThemeLifecycle | null = null

/** The ONE log sink every API piece writes to — the context, the server, the docs routes, the
 *  token store and the lifecycle. Each of those formats its own `[claude-watcher][api] code=…`
 *  line and never passes a value, so there is nothing to redact here. */
function apiLog(message: string): void {
  console.warn(message)
}

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
      sessionIdFor: (terminalId) => launchService?.sessionIdFor(terminalId) ?? null
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
    enabled: () => (settingsStore?.get() ?? DEFAULT_SETTINGS).notificationsEnabled,
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
    getSettings: () => settingsStore?.get() ?? DEFAULT_SETTINGS,
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
        launchService?.correlateAgainst(reducer.snapshotMap().values())
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
    applyRemovalReason(reason, sessionId, stored, pastSessionsStore, Date.now())
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
          : keepVisibleTags(stored.tagIds, workspaceId, (id) => tagsStore?.get(id) ?? null)
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
    if (launchService === null || terminalManager === null) return false
    // PART 2b first — the EXACT proof: claude's own record says which launched pty now runs
    // this id. Needs no orphan record, so it also rescues a card whose SessionEnd came late,
    // never came, or came longer than the heuristic's window ago.
    const byProcess = claimByProcess(
      newSessionId,
      launchService.bindings(),
      terminalManager,
      processSessions
    )
    if (byProcess !== null) {
      return adoptCard(byProcess.terminalId, byProcess.sessionId, newSessionId, 'pid')
    }
    // Fallback — the cwd + single-match + alive + window heuristic (a claude without records).
    const orphan = orphanRegistry.claim(cwd, Date.now(), terminalManager)
    if (orphan === null) return false
    return adoptCard(orphan.terminalId, orphan.sessionId, newSessionId, 'cwd')
  }

  /** Re-key a live launched terminal's card from `oldSessionId` to `newSessionId`. Shared by
   *  both proofs; `proof` only labels the log line. */
  function adoptCard(
    terminalId: string,
    oldSessionId: string,
    newSessionId: string,
    proof: 'pid' | 'cwd'
  ): boolean {
    if (launchService === null) return false
    if (!isAdoptableSessionId(newSessionId)) {
      // SEC-1 — a forged id must not become a card id (it later reaches `claude --resume`).
      // Code only: the id is caller-controlled.
      console.warn('[c9watch][hooks] path=(hook) code=hook_rebind_bad_id')
      return false
    }
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

// Story 4.1 (FR-13) — stop every terminal this window owned (explicit-MAIN teardown).
// Called from the `on('closed')` per-window path AND shared with teardownAllSessions
// (via the clearTerminalOwners dep) so there is ONE teardown contract: always explicit
// in MAIN, never incidental via a renderer unmount (B-1/M-2 hard constraint).
// Idempotent: after teardownAllSessions runs (on `before-quit`) the terminalOwners map
// is already clear, so this loop is a safe no-op on a normal app-quit close.
//
// Past sessions (D-3) — the window's live sessions are ARCHIVED first: `stop()` fires no onExit,
// so nothing else would. That needs this window's board seam, which `teardownWatchFeed` drops —
// so the `closed` handler runs THIS before teardownWatchFeed.
function teardownWindowTerminals(wc: Electron.WebContents): void {
  archiveLiveSessions(wc)
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

/** Past sessions (D-3) — archive every live launched session, or only the ones `only` owns, for
 *  the paths that end sessions WITHOUT an onExit (quit: `teardownAllSessions`; window close:
 *  `teardownWindowTerminals`). Each one leaves through its window's `removeLaunched(…, 'archive')`,
 *  the SAME chokepoint as a pty exit. The decision is `archiveBoundSessions` (launchRemoval.ts,
 *  unit-tested): idempotent, and it never throws (a failure logs a code; the quit goes on). */
function archiveLiveSessions(only?: Electron.WebContents): void {
  archiveBoundSessions(
    launchService,
    (terminalId, sessionId) => {
      const wc = terminalOwners.get(terminalId)
      if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, 'archive')
    },
    (message) => console.warn(message),
    only === undefined ? undefined : (terminalId) => terminalOwners.get(terminalId) === only
  )
}

// Build the child env for the PTY (Review F7): drop undefined-valued keys (the
// process.env type lies about this) and strip the test/harness vars (C9_SMOKE* and the
// Story-5.4 C9_TEST_PICK_DIR picker seam) so they do not leak into the spawned shell or
// anything it launches (e.g. claude).
function registerPtyIpc(): void {
  // Renderer asks for the PTY once the terminal element is mounted & sized.
  const ptyStart = (evt: Electron.IpcMainEvent): void => {
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
  }

  const ptyInput = (evt: Electron.IpcMainEvent, data: string): void => {
    ptys.get(evt.sender)?.write(data)
  }

  // Resize ordering (Guardrail #8): the renderer computes cols/rows, then the
  // PTY is resized. We resize the pty here on receipt; the renderer fits after.
  const ptyResize = (evt: Electron.IpcMainEvent, size: PtyResizeRequest): void => {
    const term = ptys.get(evt.sender)
    if (term && size && size.cols > 0 && size.rows > 0) {
      try {
        term.resize(size.cols, size.rows)
      } catch (e) {
        console.error('[c9watch][pty] resize error', e)
      }
    }
  }

  // Smoke harness wiring (AC-3). Renderer asks whether smoke mode is on, and
  // posts its verdict here; main persists it and exits.
  const config = (): SmokeConfig => ({
    enabled: SMOKE,
    electron: process.versions.electron,
    abi: process.versions.modules,
    node: process.versions.node
  })

  const smokeReport = async (evt: Electron.IpcMainEvent, report: SmokeReport): Promise<void> => {
    const term = ptys.get(evt.sender)
    // Programmatic API — the packaged-docs check. The listener was forced up on an ephemeral
    // port at app-ready (SMOKE), so a 200 from these routes proves the docs serve from INSIDE
    // the packaged asar, not just in dev.
    //
    // THREE routes, because they fail for three different reasons: `/openapi.json` builds the
    // document, `/docs` only proves `swagger-ui-dist` RESOLVES (it answers 200 the moment
    // `swaggerDistDir !== null` and reads nothing), and the ASSET is the only one that opens a
    // packaged file — the case the electron-builder `files` negations could trim without
    // anything else noticing.
    const port = apiLifecycle?.port() ?? null
    let api: { docs: number; openapi: number; asset: number; pass: boolean } = {
      docs: 0,
      openapi: 0,
      asset: 0,
      pass: false
    }
    if (port !== null) {
      // TIMEBOXED. This runs inside the verdict path: the handler writes the verdict file and
      // then app.exit()s, and the runner's failure mode for a missing verdict file is exit 3.
      // A hung fetch would turn a passing smoke into "no verdict file written" — so a timeout
      // is a FAILED CHECK (status 0 → pass false), never a hang.
      const status = async (path: string): Promise<number> => {
        try {
          return (
            await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })
          ).status
        } catch {
          return 0
        }
      }
      const docs = await status('/docs')
      const openapi = await status('/openapi.json')
      // One of the three allow-listed names — the bundle, the biggest of them. A 404 here is a
      // packaged read that failed (`code=docs_read_failed`), not a routing miss.
      const asset = await status('/docs/swagger-ui-bundle.js')
      api = { docs, openapi, asset, pass: docs === 200 && openapi === 200 && asset === 200 }
    }
    // Bundled themes (spec 2026-09-25) — the packaged read. `scan()` must list every bundled id
    // clean and `load('liquid-glass')` must compose (CSS + a ~1 MB wallpaper) from
    // <resourcesPath>/themes — the only check that opens a theme file inside a real package.
    // A PROBE scanner over an EMPTY user folder, not the app's own: the smoke runs on the default
    // profile, and an operator's hand copy in <userData>/themes would pass the check with a
    // package that carries no theme at all (seen on the first run).
    let themes = { listed: [] as string[], liquidGlass: false, pass: false }
    try {
      const probeDir = mkdtempSync(join(os.tmpdir(), 'claude-watcher-smoke-themes-'))
      try {
        const probe = createThemeScanner({ dir: probeDir, bundled: bundledThemes(), log: () => {} })
        const listed = probe
          .scan()
          .filter((t) => t.error === undefined)
          .map((t) => t.id)
        const liquidGlass = probe.load('liquid-glass').ok
        themes = {
          listed,
          liquidGlass,
          pass: liquidGlass && BUNDLED_THEME_IDS.every((id) => listed.includes(id))
        }
      } finally {
        rmSync(probeDir, { recursive: true, force: true })
      }
    } catch {
      console.error('[claude-watcher][themes] code=smoke_probe_failed')
    }
    const full = {
      ...report,
      main: {
        electron: process.versions.electron,
        abi: process.versions.modules,
        node: process.versions.node,
        ptyPid: term?.pid ?? null,
        api,
        themes
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
  }

  // SEC-8: outside smoke only `smokeConfig` exists (App.tsx asks it on every start).
  registerSmokeIpc(ipcMain, SMOKE, {
    config,
    ptyStart,
    ptyInput,
    ptyResize,
    // A rejected report must not vanish: log a code and exit non-zero (the runner reads a fail).
    report: (evt, report: SmokeReport) =>
      void containSmokeReport(() => smokeReport(evt, report), {
        log: (m) => console.error(m),
        exit: (code) => {
          // The same hard fallback smokeReport's own exit uses (Wayland teardown can linger).
          app.exit(code)
          setTimeout(() => process.exit(code), 250)
        }
      })
  })
}

// Story 2.4 — the ONE app-global settings store. Settings are app-global (NOT window-scoped
// like the feed/tray), so this is a single instance for the whole app, constructed AFTER
// app-ready (electron-store needs userData). A null until then; registerSettingsIpc reads it.
let settingsStore: SettingsStore | null = null

// Workspaces — same lifecycle as settingsStore (needs app-ready for electron-store). Built
// BEFORE templatesStore (see the construction block below): the launch path reads the
// workspaces store.
let workspacesStore: WorkspacesStore | null = null
function requireWorkspacesStore(): WorkspacesStore {
  if (workspacesStore === null) throw new Error('workspaces_store_not_initialized')
  return workspacesStore
}

/** Workspaces — the live-session guard (spec W-6). A workspace with ANY card in ANY window
 *  cannot be deleted. Reads every window's reducer snapshot; keyed on the stable session id. */
function hasLiveSessions(workspaceId: string): boolean {
  for (const seam of launchBoardSeams.values()) {
    if (seam.hasSessionsInWorkspace(workspaceId)) return true
  }
  return false
}

/** Past sessions — a live card in ANY window blocks a second Open of the same id. */
function isSessionLive(sessionId: string): boolean {
  for (const seam of launchBoardSeams.values()) if (seam.hasSession(sessionId)) return true
  return false
}

/** Workspaces — the scoped-config cascade. Runs ONLY after a delete was allowed and committed.
 *  Late-bound on purpose: the workspaces store is constructed before templates, shortcuts, tags
 *  and rules exist. */
function cascade(workspaceId: string): void {
  templatesStore?.removeByWorkspace(workspaceId)
  shortcutsStore?.removeByWorkspace(workspaceId)
  tagsStore?.removeByWorkspace(workspaceId)
  rulesStore?.removeByWorkspace(workspaceId)
  pastSessionsStore?.removeByWorkspace(workspaceId) // D-9 — records are tied by workspace id
  // A deleted workspace had no live cards (W-6), so this cancels nothing today; it keeps the
  // timers honest if that guard ever loosens.
  for (const engine of ruleEngines.values()) engine.onRulesRemoved()
}

// Session templates — same lifecycle as settingsStore (needs app-ready for electron-store).
let templatesStore: TemplatesStore | null = null
function requireTemplatesStore(): TemplatesStore {
  if (templatesStore === null) throw new Error('templates store not initialized')
  return templatesStore
}

// Past sessions — same lifecycle as templatesStore (needs app-ready for electron-store).
let pastSessionsStore: PastSessionsStore | null = null
// UX-01 — every card on the board also has a `live` record in the history file, so a crash
// still leaves it in Past sessions. App-global like the store (records are keyed by session id).
const livePastSessions = createLivePastSessions({
  store: () => pastSessionsStore,
  now: () => Date.now()
})
function requirePastSessionsStore(): PastSessionsStore {
  if (pastSessionsStore === null) throw new Error('past_sessions_store_not_initialized')
  return pastSessionsStore
}

// Phrase shortcuts — same lifecycle as templatesStore (needs app-ready for electron-store).
let shortcutsStore: ShortcutsStore | null = null
function requireShortcutsStore(): ShortcutsStore {
  if (shortcutsStore === null) throw new Error('shortcuts store not initialized')
  return shortcutsStore
}

// Tags — same lifecycle as templatesStore (needs app-ready for electron-store).
let tagsStore: TagsStore | null = null
function requireTagsStore(): TagsStore {
  if (tagsStore === null) throw new Error('tags store not initialized')
  return tagsStore
}

// Rules — same lifecycle as the tags store (needs app-ready for electron-store).
let rulesStore: RulesStore | null = null
function requireRulesStore(): RulesStore {
  if (rulesStore === null) throw new Error('rules store not initialized')
  return rulesStore
}

/** The rules as the engines and the launch path read them: run order + the broken ids (T-23).
 *  Empty before the store exists (smoke mode, a race against app-ready) — then no rule can fire. */
function rulesSnapshot(): RulesSnapshot {
  if (rulesStore === null) return { rules: [], brokenIds: new Set() }
  const view = rulesStore.view()
  return { rules: view.rules, brokenIds: new Set(view.brokenIds) }
}

/** The catalogs a rule may point at, bound LATE (the repo's DI style — the stores never import
 *  each other). */
function ruleLookups(): Pick<RulesStoreOptions, 'lookupTag' | 'lookupTemplate'> {
  return {
    lookupTag: (id) => tagsStore?.get(id) ?? null,
    lookupTemplate: (id) => templatesStore?.get(id) ?? null
  }
}

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
    const before = settingsStore.get()
    const next = settingsStore.set(patch)
    // Programmatic API — the listener FOLLOWS the setting: start when it is switched on, stop when
    // it is switched off, restart when the port moves. `apply` is idempotent, so the patches that
    // changed only the font size start and stop nothing (a needless restart would drop every open
    // SSE stream out from under its client). It never throws — a failed bind is logged by code and
    // leaves the lifecycle stopped, so the settings write still returns.
    apiLifecycle?.apply(next)
    // Custom themes — persist FIRST (the setting is the operator's choice), then apply. The
    // outcome reaches the renderer as the pushed bundle, whose id says whether the chosen theme
    // or Default landed. Only a changed theme or a changed pick for it applies: a font-size patch
    // must not re-read the disk.
    if (themeNeedsReapply(before, next)) themeLifecycle?.apply(next.themeId, chosenWallpaper(next))
    return next
  })
}

// Custom themes — register ONCE. `themes:list` rescans on every call (D-3: no watcher);
// `theme:reload` re-applies the CHOSEN id; `themes:open-folder` opens the folder after a
// `mkdir -p` so there is always something to open. Handler bodies are one line each; the logic
// lives in themes/themeScanner.ts + themes/themeLifecycle.ts (unit-tested).
function registerThemesIpc(): void {
  ipcMain.handle(CH.themesList, () => {
    if (themeScanner === null) throw new Error('theme scanner not initialized')
    return themeScanner.scan()
  })
  ipcMain.handle(CH.themeReload, () => {
    if (themeLifecycle === null || settingsStore === null)
      throw new Error('theme lifecycle not initialized')
    const s = settingsStore.get()
    return themeLifecycle.apply(s.themeId, chosenWallpaper(s))
  })
  ipcMain.handle(CH.themesOpenFolder, async () => {
    if (themeScanner === null) throw new Error('theme scanner not initialized')
    const dir = themeScanner.dir()
    try {
      // Mirrors themeScanner.scan()'s handling of this same call: `mkdirSync` can throw
      // (ENOTDIR/EACCES/a race on the folder), and an uncontained throw here would reach the
      // renderer as the rejected invoke() promise — whose `.message` QUOTES THE ABSOLUTE PATH.
      // Log a code only, never the errno message, and never let the raw error cross the IPC
      // boundary.
      mkdirSync(dir, { recursive: true })
    } catch {
      console.warn('[claude-watcher][themes] code=themes_open_folder_mkdir_failed')
      return
    }
    // `openPath` resolves to '' on success or a message that quotes the path: log a code only.
    const problem = await shell.openPath(dir)
    if (problem !== '') console.warn('[claude-watcher][themes] code=themes_open_folder_failed')
  })
}

// Programmatic API — the token bridge, registered ONCE (mirrors registerSettingsIpc). Read-only
// for the renderer except Regenerate: the token is not in settings.json (the renderer reads that
// whole blob) but in its own 0600 file, so this is the only way the Settings panel can show it.
// NEITHER handler logs the token — it IS the secret.
function registerApiIpc(): void {
  ipcMain.handle(CH.apiTokenGet, () => {
    if (apiTokenStore === null) throw new Error('api token store not initialized')
    return { token: apiTokenStore.current() }
  })
  ipcMain.handle(CH.apiTokenRegenerate, () => {
    if (apiTokenStore === null) throw new Error('api token store not initialized')
    // A regenerate is a REVOCATION. When the write fails the store throws `token_write_failed` and
    // keeps the previous token; that throw PROPAGATES to the renderer (which maps the code to
    // operator copy) rather than being swallowed — handing back a token that exists only in this
    // process would tell the operator a revocation happened that the next start undoes.
    return { token: apiTokenStore.regenerate() }
  })
}

// Session templates — register ONCE (mirrors registerSettingsIpc). Handler bodies live in
// persistence/templatesIpc.ts (unit-tested); this only binds them to CH.* channels.
function registerTemplatesIpc(): void {
  // Called AFTER the store is built, so the handlers can be bound once instead of rebuilt on
  // every invoke. requireTemplatesStore() stays — it throws a clear error if ever mis-ordered.
  const handlers = createTemplatesIpcHandlers(requireTemplatesStore())
  ipcMain.handle(CH.templatesList, () => handlers.list())
  ipcMain.handle(CH.templatesSave, (_evt, raw: unknown) => handlers.save(raw))
  ipcMain.handle(CH.templatesDelete, (_evt, raw: unknown) => handlers.remove(raw))
}

// Past sessions — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/pastSessionsIpc.ts (unit-tested); this only binds `list`/`forget` to CH.* channels.
// `session:archive`, `session:delete` and `past-sessions:open` get their bridges now but their
// main handlers are wired later — they need the launch service and the reducer.
function registerPastSessionsIpc(): void {
  const handlers = createPastSessionsIpcHandlers(requirePastSessionsStore())
  ipcMain.handle(CH.pastSessionsList, () => handlers.list())
  ipcMain.handle(CH.pastSessionsForget, (_evt, raw: unknown) => handlers.forget(raw))
  // CH.pastSessionOpen is bound in registerLaunchIpc (it needs the launch service) — Task 9.
}

// Tags — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/tagsIpc.ts (unit-tested). After a catalog change, every window strips the tags its
// cards can no longer see — a deleted tag leaves each card with a `session.updated` without it
// (spec §1.4).
function registerTagsIpc(): void {
  const store = requireTagsStore()
  const handlers = createTagsIpcHandlers(store)
  const pruneEverywhere = (): void => {
    for (const seam of launchBoardSeams.values()) seam.pruneTags((id) => store.get(id))
  }
  ipcMain.handle(CH.tagsList, () => handlers.list())
  ipcMain.handle(CH.tagsSave, (_evt, raw: unknown) => {
    const result = handlers.save(raw)
    pruneEverywhere()
    return result
  })
  ipcMain.handle(CH.tagsDelete, (_evt, raw: unknown) => {
    const tags = handlers.remove(raw)
    pruneEverywhere()
    return tags
  })
}

// Rules — register ONCE (mirrors registerTagsIpc). Handler bodies live in persistence/rulesIpc.ts
// (unit-tested). A change reaches every window's engine: a saved rule re-arms its timers from NOW
// (T-13 — nothing fires at save), a deleted one cancels them. A move changes no timer.
function registerRulesIpc(): void {
  const handlers = createRulesIpcHandlers(requireRulesStore())
  ipcMain.handle(CH.rulesList, () => handlers.list())
  ipcMain.handle(CH.rulesSave, (_evt, raw: unknown) => {
    const result = handlers.save(raw)
    for (const engine of ruleEngines.values()) engine.onRuleSaved(result.saved.id)
    return result
  })
  ipcMain.handle(CH.rulesDelete, (_evt, raw: unknown) => {
    const view = handlers.remove(raw)
    for (const engine of ruleEngines.values()) engine.onRulesRemoved()
    return view
  })
  ipcMain.handle(CH.rulesMove, (_evt, raw: unknown) => handlers.move(raw))
}

// Workspaces — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/workspacesIpc.ts (unit-tested); this only binds them to CH.* channels.
function registerWorkspacesIpc(): void {
  const handlers = createWorkspacesIpcHandlers(requireWorkspacesStore())
  ipcMain.handle(CH.workspacesList, () => handlers.list())
  ipcMain.handle(CH.workspacesSave, (_evt, raw: unknown) => handlers.save(raw))
  ipcMain.handle(CH.workspacesDelete, (_evt, raw: unknown) => handlers.remove(raw))
  ipcMain.handle(CH.workspacesSetActive, (_evt, raw: unknown) => handlers.setActive(raw))
}

// Phrase shortcuts — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/shortcutsIpc.ts (unit-tested); this only binds them to CH.* channels. There is
// deliberately no channel for DELIVERING a phrase — a matched chord posts it on the terminal's
// existing MessagePort `{type:'input'}` frame.
function registerShortcutsIpc(): void {
  // Called AFTER the store is built, so the handlers are bound once instead of rebuilt on every
  // invoke. requireShortcutsStore() stays — it throws a clear error if ever mis-ordered.
  const handlers = createShortcutsIpcHandlers(requireShortcutsStore())
  ipcMain.handle(CH.shortcutsList, () => handlers.list())
  ipcMain.handle(CH.shortcutsSave, (_evt, raw: unknown) => handlers.save(raw))
  ipcMain.handle(CH.shortcutsDelete, (_evt, raw: unknown) => handlers.remove(raw))
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
    // ESCAPE = INTERRUPT. Probe-verified on claude 2.1.250: interrupting a turn fires NO
    // hook of any kind, and when interrupted early it leaves no transcript trace either —
    // claude just cancels and restores the prompt. So the keystroke the app is already
    // forwarding is the ONLY evidence the session went idle, and without it the card keeps
    // saying `Working` until the operator next uses the session.
    //
    // After an interrupt claude sits at its prompt waiting, and the operator is the one who
    // pressed the key — so this is idle-by-truth: the calm column, no notification. Guarded
    // on an ACTUAL status change so a stray Escape (dismissing an autocomplete menu) cannot
    // emit a pointless delta. Never logs `data` — that is what the operator is typing.
    onInput: (terminalId, data) => {
      // Only single-key chunks matter (Escape, or an answer to a permission prompt); a paste
      // or typed text is never looked up.
      if (data.length !== 1) return
      // Only an app-LAUNCHED terminal has a bound session; a plain shell has none, and an
      // Escape there is just an Escape.
      const sessionId = launchService?.sessionIdFor(terminalId) ?? null
      if (sessionId === null) return
      const wc = terminalOwners.get(terminalId)
      if (wc === undefined) return
      if (!isInterruptKey(data)) {
        launchBoardSeams.get(wc)?.keyLaunched(sessionId, data)
        return
      }
      // The key was SEEN on the pty. What the board then does about it is logged by
      // demoteOnInterrupt (`interrupt_key` when it demotes) — two facts, two lines.
      console.log(`[c9watch][pty] code=interrupt_key_seen session=${sessionId}`)
      launchBoardSeams.get(wc)?.interruptLaunched(sessionId)
    },
    onExit: (terminalId, exitCode, signal) => {
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
        // UX-10 — the signal (when one ended it) so the dead pane can name it. State only.
        const r = TerminalExitSchema.safeParse(
          signal === undefined ? { terminalId, exitCode } : { terminalId, exitCode, signal }
        )
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
        // Ctrl+C twice / `/exit` / a crash — all ARCHIVE (D-3): the pty is really gone, and the
        // card's history is worth keeping unless the operator explicitly deletes it.
        removeBoundSession(terminalId, launchService, (sessionId) => {
          if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, 'archive')
        })
      }
    },
    // never-log-the-value: a code= ONLY, never a pty/session value (Guardrail #6).
    log: (message) => console.warn(message)
  })

  // view:focused-terminal (UX-13) — the renderer reports which terminal its focused view shows
  // (null on the board). View-state only; read by `isViewingSession` to skip the alert for the
  // session the operator is typing in. A malformed push is dropped, logged by PATH + CODE.
  ipcMain.on(CH.viewFocusedTerminal, (event, raw: unknown) => {
    const parsed = ViewFocusedTerminalSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      console.error(
        `[claude-watcher][view] dropped view:focused-terminal path=${issue?.path.join('.') ?? ''} code=${issue?.code ?? ''}`
      )
      return
    }
    // Only a window with a live feed; a late push after teardown must not re-add its entry.
    if (reducers.has(event.sender)) focusedTerminals.set(event.sender, parsed.data.terminalId)
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
        // Workspaces — stamp main's OWN active-workspace pointer at synthesis time (never
        // derived in the extracted module, which must stay importable without Electron).
        // Programmatic API — a launch that names its workspace (a template's own scope) lands
        // there; every other launch keeps landing in main's active workspace.
        const workspaceId = minted.workspaceId ?? requireWorkspacesStore().activeId()
        launchBoardSeams.get(wc)?.upsertLaunched(
          buildLaunchedSession(
            minted,
            ptyPid,
            workspaceId,
            // Rules (spec §2.1, T-21) — the launch rules run HERE, at spawn, so the card is
            // born tagged: one delta, no flash. Never on "first seen" — /clear re-upserts
            // under a new id and must not run them again.
            // Past sessions — a resume is born with the record's surviving tags; the launch
            // rules run for NEW launches only (a resume is not one).
            minted.resume !== null
              ? minted.resume.tagIds
              : launchTags(rulesSnapshot(), minted, workspaceId)
          )
        )
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
        // An unmount-stop that really kills the pty is ARCHIVE too (D-3) — CH.terminalStop is
        // not the operator's Delete; that is the explicit CH.sessionDelete exit below.
        const wc = terminalOwners.get(terminalId)
        if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, 'archive')
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
  displayName: string,
  flags: ClaudeLaunchFlags,
  initialPrompt: string | null,
  resume: boolean
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
    // claude runs under the operator's name instead of generating its own title,
    // `--settings <file>` carries the hook block WITHOUT touching the operator's project, and
    // `--append-system-prompt` injects the deterministic-attention question-format nudge
    // (DA-4; probe-verified GO).
    args: [
      '-l',
      '-c',
      composeClaudeCommand({
        claudeCommand: claude.command,
        sessionId,
        displayName,
        hookSettingsPath: hookSettingsPathForSpawn(),
        appendSystemPrompt: QUESTION_FORMAT_PROMPT,
        model: flags.model,
        permissionMode: flags.permissionMode,
        effort: flags.effort,
        // The programmatic API threads the template's filled-in prompt through here (it rode
        // the durable launch recipe from `launchService.launch`); the in-app launch flows carry
        // none, so for them the composed command stays byte-identical to before.
        initialPrompt,
        // Past sessions (D-1) — a resume composes `claude --resume <id>` instead (claudeBin.ts
        // keeps `-n` (R3) and drops the template flags and the positional prompt for that form).
        resume
      })
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
// CACHING: only an `ok` verdict is cached for good. A blocked or unreadable result is re-probed on
// the next IN-APP launch, so upgrading claude un-blocks the app WITHOUT restarting it; an API
// create reuses it for 30 s (R25 — see createClaudeVersionGate). The probe costs ~67ms on this
// machine — cheap enough per launch, but not worth paying once it has passed.
//
// NEVER-LOG-THE-VALUE: the resolved command is never logged, only a `code=`.
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

/** UX-11 — the launch preflight's folder check. Never throws; never logs the path. */
function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false // missing / unreadable / unmounted
  }
}

/**
 * UX-11 — run an IN-APP launch, explaining a missing folder with a native error box (the renderer
 * swallows a rejected launch invoke — the version gate's reasoning), then rethrowing so the invoke
 * still rejects and nothing is opened. Any other failure passes through untouched.
 */
function launchExplainingFolder<T>(run: () => T): T {
  try {
    return run()
  } catch (err) {
    if (isFolderMissing(err)) {
      console.warn('[claude-watcher][launch] code=folder_missing')
      dialog.showErrorBox('Folder not found', FOLDER_MISSING_MESSAGE)
    }
    throw err
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
 *
 * R25: the API path (`claudeVersionAllowsApiLaunch`) NEVER shows that box — the caller gets its
 * own 503 `claude_version` — and reuses a refusal for 30 s instead of re-probing the shell on
 * every retry. The decision lives in `createClaudeVersionGate` (claudeVersion.ts, unit-tested).
 */
const claudeVersionGate = createClaudeVersionGate({
  readRaw: readClaudeVersionRaw,
  now: Date.now,
  showTooOld: (message) => dialog.showErrorBox('Update claude', message),
  log: (m) => console.warn(m)
})
function claudeVersionAllowsLaunch(): boolean {
  return claudeVersionGate.allowsInteractiveLaunch()
}
function claudeVersionAllowsApiLaunch(): boolean {
  return claudeVersionGate.allowsApiLaunch()
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
//
// SEC-6: no `--settings` at all unless THIS process's hook server is bound — a port someone else
// holds would otherwise receive every prompt of the session. The banner (UX-05) says why.
function hookSettingsPathForSpawn(): string | null {
  return hookSettingsPathIfListening({
    listening: () => serverHealth.hookListening(),
    ensure: () =>
      ensureHookSettingsFile({
        dir: app.getPath('userData'),
        log: (msg) => console.warn(msg)
      }),
    written: (ok) => serverHealth.hookSettingsWritten(ok),
    log: (msg) => console.warn(msg)
  })
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
    // UX-11 — refuse a missing folder before anything is registered (no card, no record).
    isDirectory: isExistingDirectory,
    // Story 6.2 — the spawn FACTORY (not a static config): composes the raw-claude command for
    // each freshly-minted session id at actual-spawn time (mintSpawn).
    spawn: rawClaudeSpawn,
    // R3 — a resume's `-n` is the card's LATEST name: its past-sessions record (live or archived)
    // follows every rename, the recipe's name is frozen at Open.
    resumeName: (sessionId) => pastSessionsStore?.get(sessionId)?.name ?? null,
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
  ipcMain.handle(CH.sessionPickDirectory, async (event, raw: unknown) => {
    // Story 5.4 — TEST-ONLY seam (mirrors the C9_SMOKE env gate): when C9_TEST_PICK_DIR is set,
    // bypass the native KDE dialog (which Playwright cannot drive) and return that path. This
    // exists SOLELY so the launch-path e2e can exercise `+ New session → claude` end-to-end on the
    // built app. Inert in normal use (the env var is never set in production). Never logged.
    const testPickDir = process.env.C9_TEST_PICK_DIR
    if (testPickDir !== undefined && testPickDir !== '') return testPickDir
    const owner = BrowserWindow.fromWebContents(event.sender)
    // Workspaces — open the picker at a workspace's default folder when it has one: the one the
    // Workspaces dialog is editing (R26, by id), else the active one. Read from MAIN's own store
    // (the renderer never sends a path) and NEVER logged. A malformed arg rejects the invoke.
    const defaultPath = pickDirectoryDefaultPath(requireWorkspacesStore(), raw)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      ...(defaultPath !== null ? { defaultPath } : {})
    }
    // showOpenDialog accepts an optional parent window; pass it so the dialog is modal-to-window.
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
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
    const service = launchService
    const { terminalId } = launchExplainingFolder(() => service.launch({ cwd, name }))
    // Workspaces — report the workspace MAIN stamped on this launch's card so the renderer can
    // register the terminal's workspace before any session delta arrives.
    return { terminalId, workspaceId: requireWorkspacesStore().activeId() }
  })

  // session:launch-from-template — resolve the template FIRST (untrusted arg → main-owned
  // cwd/model/permissionMode via resolveTemplateLaunch; throws template_not_found on an unknown
  // id), then run the SAME version gate as session:launch before anything spawns.
  ipcMain.handle(CH.sessionLaunchFromTemplate, (_event, raw: unknown) => {
    if (launchService === null) throw new Error('launch service not initialized')
    const req = resolveTemplateLaunch(requireTemplatesStore(), raw)
    if (!claudeVersionAllowsLaunch()) {
      throw new Error('claude version below the supported minimum')
    }
    const service = launchService
    const { terminalId } = launchExplainingFolder(() => service.launch(req))
    // Workspaces — same reasoning as session:launch above.
    return { terminalId, workspaceId: requireWorkspacesStore().activeId() }
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

  // Past sessions (D-3) — the two explicit exits. Same stop as `terminal:stop` (the manager's
  // token-less kill), then the bound card leaves with the REASON. Keyed by terminalId: the
  // renderer holds it from the first frame. This routes the removal to the owning window's seam.
  function removeOwnedSession(
    terminalId: string,
    reason: RemovalReason
  ): (sessionId: string) => void {
    return (sessionId) => {
      const wc = terminalOwners.get(terminalId)
      if (wc !== undefined) launchBoardSeams.get(wc)?.removeLaunched(sessionId, reason)
    }
  }
  // session:archive — UNTRUSTED cross-process input; parse-and-throw at THIS boundary (a blank
  // terminalId rejects the invoke). Explicit "Archive"/Stop from the board: stop the pty, archive
  // the card.
  ipcMain.handle(CH.sessionArchive, (_event, raw: unknown) => {
    const { terminalId } = SessionArchiveSchema.parse(raw)
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    stopTerminalAndRemoveBound(
      terminalId,
      undefined,
      terminalManager,
      launchService,
      removeOwnedSession(terminalId, 'archive')
    )
  })
  // session:delete — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Explicit
  // Delete: stop the pty, drop the card AND any history record for it. The decision is
  // `deleteTerminalSession` (launchRemoval.ts, unit-tested): on a pane whose claude already
  // EXITED there is no binding and the renderer's `sessionId` is null (its card is gone), so the
  // record that exit archived is found through the launch override's `lastSessionId`. The
  // renderer's id is only a hint, removed too (idempotent).
  ipcMain.handle(CH.sessionDelete, (_event, raw: unknown) => {
    const { terminalId, sessionId } = SessionDeleteSchema.parse(raw)
    if (terminalManager === null) throw new Error('terminal manager not initialized')
    deleteTerminalSession(
      terminalId,
      sessionId,
      terminalManager,
      launchService,
      removeOwnedSession(terminalId, 'delete'),
      (id) => {
        pastSessionsStore?.remove(id)
      }
    )
  })

  // past-sessions:open — UNTRUSTED arg (parse-and-throw inside openPastSession). The decision is
  // the extracted module; this binds the real seams. A refusal THROWS its code (the templates
  // precedent: `template_not_found`), which the dialog maps to copy. The same version gate as
  // session:launch runs first: `--resume` is no older than the flags the gate already covers.
  // The real seams behind an Open — shared by the Past sessions dialog and the dead pane's Resume.
  const pastSessionOpenDeps = (service: LaunchService): PastSessionOpenDeps => ({
    get: (id) => requirePastSessionsStore().get(id),
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false // missing / unreadable — never throws, never logs the path
      }
    },
    isLive: isSessionLive,
    transcriptExists: (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false // missing / unreadable — never throws, never logs the path
      }
    },
    runningElsewhere: (id) => runningElsewhere.isRunningElsewhere(id),
    tagExists: (id) => tagsStore !== null && tagsStore.get(id) !== null,
    launch: (req) => service.launch(req)
  })

  ipcMain.handle(CH.pastSessionOpen, (_event, raw: unknown): PastSessionOpenResult => {
    if (launchService === null) throw new Error('launch service not initialized')
    if (!claudeVersionAllowsLaunch()) throw new Error('claude version below the supported minimum')
    const out = openPastSession(raw, pastSessionOpenDeps(launchService))
    if (!out.ok) throw new Error(out.code)
    return { terminalId: out.terminalId, workspaceId: out.workspaceId, name: out.name }
  })

  // past-sessions:resume-terminal (UX-10) — the dead pane's Resume. UNTRUSTED arg (parse-and-throw
  // inside resumeTerminalSession). Only the terminal id crosses: the session id is the launch
  // override's `lastSessionId` (main's own record, moved by /clear), then the same Open checks and
  // the same version gate. A refusal THROWS its code; the pane maps it to copy.
  ipcMain.handle(CH.pastSessionResumeTerminal, (_event, raw: unknown): PastSessionOpenResult => {
    if (launchService === null) throw new Error('launch service not initialized')
    if (!claudeVersionAllowsLaunch()) throw new Error('claude version below the supported minimum')
    const service = launchService
    const out = resumeTerminalSession(raw, {
      ...pastSessionOpenDeps(service),
      lastSessionIdFor: (terminalId) =>
        service.peekSpawnOverride(terminalId)?.lastSessionId ?? null,
      isTerminalLive: (terminalId) => terminalManager?.has(terminalId) ?? false
    })
    if (!out.ok) throw new Error(out.code)
    return { terminalId: out.terminalId, workspaceId: out.workspaceId, name: out.name }
  })

  // session:set-workspace — UNTRUSTED cross-process input; parse-and-throw at THIS boundary.
  // The WORKSPACE is validated against main's own store: moving a card into a workspace that
  // does not exist would strand it where no view can show it, so that fails closed with a code
  // instead of being applied. An unknown SESSION id is not an error (the reducer logs
  // set_workspace_unknown_id and emits nothing — a move racing a stop that already removed it).
  ipcMain.handle(CH.sessionSetWorkspace, (event, raw: unknown) => {
    // Both gates live in persistence/workspacesIpc.ts (unit-testable in node, unlike this file);
    // index.ts only binds the CH.* channel and routes to the sender's seam.
    const { sessionId, workspaceId } = parseSessionWorkspaceMove(requireWorkspacesStore(), raw)
    launchBoardSeams.get(event.sender)?.setWorkspaceLaunched(sessionId, workspaceId)
  })

  // session:set-tags — UNTRUSTED cross-process input; parse-and-throw at THIS boundary. Every id
  // must exist and be visible to the card's workspace (tagsIpc.ts parseSessionSetTags — unit-
  // testable, unlike this file). Routed by event.sender to the owning window's seam (session truth
  // is per-window). Returns void; the tagged card arrives as a normal `session.updated` delta.
  ipcMain.handle(CH.sessionSetTags, (event, raw: unknown) => {
    const seam = launchBoardSeams.get(event.sender)
    const { sessionId, tagIds } = parseSessionSetTags(requireTagsStore(), raw, (id) =>
      seam?.workspaceOf(id)
    )
    seam?.setTagsLaunched(sessionId, tagIds)
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
// External links — the ONE opener. `shell.openExternal` is the cross-platform call (xdg-open on
// Linux, `open` on macOS, ShellExecute on Windows); the gate in front of it allows http(s) only.
const externalLinks = createExternalLinks({ openExternal: (url) => shell.openExternal(url) })

// External links — the terminal's Ctrl/Cmd+click lands here. Parse-and-throw on a bad arg; the
// scheme check and every log line (code only, never the URL) live in externalLinks.
// Server and storage health — the renderer asks once on mount; every later change is a push.
function registerServerHealthIpc(): void {
  ipcMain.handle(CH.serverHealthGet, () => serverHealth.get())
  ipcMain.handle(CH.storageHealthGet, () => storageHealth.get())
}

function registerLinksIpc(): void {
  ipcMain.handle(CH.linkOpenExternal, (_evt, raw: unknown) => {
    const { url } = LinkOpenExternalSchema.parse(raw)
    externalLinks.open(url)
  })
}

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
        // Past sessions (D-3) — "Quit anyway" archives every live session before the kill.
        archiveLiveSessions: () => archiveLiveSessions(),
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

  // A dev-profile window says so in its title, so it is never mistaken for the installed app.
  if (PROFILE.titleSuffix !== '') {
    mainWindow.on('page-title-updated', (e, title) => {
      e.preventDefault()
      mainWindow.setTitle(title + PROFILE.titleSuffix)
    })
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Fallback show (2026-08-03). `ready-to-show` fires off the renderer's FIRST PAINTED FRAME.
  // With hardware acceleration disabled (2026-08-03 to 2026-09-22; see the GPU block below
  // createWindow()) it never fired at all on this KWin/Wayland host, so
  // `show()` was never called and the app ran headless: process alive, window never mapped, no
  // error anywhere. `did-finish-load` fires off the DOM/load lifecycle instead, so it is
  // independent of whether a frame ever reached the compositor. `show()` is idempotent, and
  // whichever event lands first wins — the normal path is unchanged.
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  })

  // Programmatic API — the FIRST apply of the persisted setting: here, not on app-ready.
  //
  // `POST /v1/sessions` needs the RENDERER. Main registers the launch recipe and pushes
  // `launch:requested`; the renderer opening that terminal is what spawns the pty and mints the
  // session id the caller is waiting on. The renderer subscribes to that push from an effect that
  // runs after its startup smoke check resolves, so a listener bound at app-ready would open a
  // window in which a create answers 504 `spawn_timeout` while the app is perfectly healthy.
  // `did-finish-load` is the cheapest signal that the renderer's own code is running.
  //
  // It does NOT close the window entirely: the per-window API seam is built by registerWatchFeed
  // on `ready-to-show`, which may land after this. A create in that gap answers `no_window` (503,
  // retryable) — an honest, actionable answer, unlike a silent 504.
  //
  // `apply` is idempotent, so the `activate` path re-creating a window re-applies to no effect,
  // and a null settings store (it is built before createWindow runs) simply skips the start.
  //
  // SMOKE owns the listener itself (app-ready applies `{ apiEnabled: true, apiPort: 0 }` so the
  // verdict can fetch `/docs` and `/openapi.json` from inside the asar). The smoke settings store
  // is in-memory with `apiEnabled: false`, so applying it HERE would stop that listener before the
  // report is taken — verified: the packaged run logged `code=listening port=39545` and then
  // `code=stopped`, and the verdict came back `api: { docs: 0, openapi: 0 }`.
  mainWindow.webContents.once('did-finish-load', () => {
    if (SMOKE) return
    if (settingsStore === null) return
    apiLifecycle?.apply(settingsStore.get())
  })

  // Custom themes — the FIRST apply of the persisted theme, here for the same reason as the API
  // above: the renderer must be running to receive the push. The renderer also asks for a reload
  // once its subscription is up (App.tsx), so a push that lands before the effect subscribed is
  // not lost. Runs in SMOKE too: the in-memory store's themeId is `default`, no disk is read.
  mainWindow.webContents.once('did-finish-load', () => {
    if (settingsStore === null) return
    const s = settingsStore.get()
    themeLifecycle?.apply(s.themeId, chosenWallpaper(s))
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

  // The app never opens a second window and never navigates away from its own page: a
  // `window.open` or a navigation to an http(s) URL goes to the OS default browser, anything
  // else is refused (src/main/links/externalLinks.ts).
  installLinkGuards(mainWindow.webContents, externalLinks)

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
    // Story 3.1 / Story 4.1 — tear down every embedded terminal this window owned via the
    // shared teardownWindowTerminals helper (explicit MAIN stop: port.close() THEN pty.kill(),
    // inside terminalManager.stop). B-1/M-2 hard constraint: NEVER rely on an incidental
    // renderer unmount to kill PTYs (App.tsx ~199-203 M-2 latch WARNING). On a normal
    // app-quit, teardownAllSessions (before-quit) already ran and cleared terminalOwners →
    // this loop is a safe idempotent no-op. On a direct window close (4-2 will flip this to
    // minimize instead), it tears down this window's terminals cleanly.
    //
    // BEFORE teardownWatchFeed (Past sessions, D-3): it first ARCHIVES this window's live
    // sessions through the window's board seam, and teardownWatchFeed is what drops that seam.
    // The stops themselves fire no onExit, so they never reach the feed torn down below.
    teardownWindowTerminals(wc)
    // Drop this window's session-engine registries + close its hook listener.
    teardownWatchFeed(wc)
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

// ── GPU ON (re-enabled 2026-09-22) ─────────────────────────────────────────────────────────────
//
// Hardware acceleration is ON. From 2026-08-03 to 2026-09-22 this block called
// `app.disableHardwareAcceleration()` + `disable-software-rasterizer`, because an `amdgpu` shader
// page fault inside our own GPU process hung the graphics ring, and the ring reset killed every
// live WebGL context at once — every open terminal went blank while its PTY stayed healthy
// (2026-07-31 and 2026-08-03; faulting device: the AMD integrated GPU, 05:00.0).
//
// Why it is back: the host is now pinned to the NVIDIA dGPU, and the GPU process renders there —
// checked 2026-09-22 from the GPU process's open files (`/dev/nvidia0` + renderD128, the NVIDIA
// node) with the driver working (615.71, kernel 6.18.52). Do not trust `getGPUInfo()`'s
// `active` flag for this: it named the AMD card while the NVIDIA one did the rendering.
// The software compositor also had a visible cost: a backdrop blur there reads only inside its
// own box, so the sharp page showed through near every edge of a glass panel.
//
// If the terminals start blanking again, read the kernel log first
// (`journalctl -k | grep -E "amdgpu|NVRM"`): a GPU fault named `claude-watcher` means the GPU
// process landed on a card that faults, and the switches above are the known workaround.
// EmbeddedTerminal's onContextLoss recovery (dispose → re-fit → full redraw) is the net.
// [.claude/rules/terminal.md]

// Chromium draws some widgets ITSELF — the `<select>` popup list above all — from the NATIVE
// theme, not from the page, and on Linux that popup reads the DESKTOP's GTK theme: on a light
// desktop it came up white with a blue highlight, floating over a dark dialog, no matter what the
// page's own CSS said. `themeSource = 'dark'` is what tells Chromium to draw its own surfaces
// dark (and makes `prefers-color-scheme: dark` true in the renderer). Set before `ready`, so the
// first window never paints a light popup.
// Changed 2026-09-20 — this comment used to also cite a fixed `:root { color-scheme: dark }` in
// main.css as "necessary but not sufficient". That declaration is GONE: custom themes
// (`src/main/themes/`) can be light, so a color-scheme fixed to `dark` would pin a light theme's
// page to dark scrollbars/form controls. `hooks/useApplyTheme.ts` now sets
// `documentElement.style.colorScheme` from the APPLIED theme's own `colorScheme` on every apply
// instead. This line is now ONLY the pre-window default — `nativeTheme.themeSource` is re-set the
// same way, by `themeLifecycle`, from the applied theme's `colorScheme` on every apply (start,
// theme change, and Reload themes).
nativeTheme.themeSource = 'dark'

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app
  .whenReady()
  .then(() => {
    // A second instance is already exiting (UX-04): build nothing, bind nothing.
    if (!IS_PRIMARY_INSTANCE) return
    // Set app user model id for windows. CANONICAL appId = `com.claudewatcher.app` (Story 2.3
    // AC-6): must match `electron-builder.yml` (`appId`) + the `.desktop` file's
    // `StartupWMClass`/filename so the tray + notification OS identity is consistent. [FROZEN #5;
    // AR-10]
    electronApp.setAppUserModelId('com.claudewatcher.app')

    // No default menu: its accelerators (Ctrl+R reload, …) ate keys claude needs, and a reload
    // left the board without a snapshot (UX-16 / R2). F12 toggles DevTools in dev only.
    const menuTemplate = applicationMenuTemplate(process.platform)
    Menu.setApplicationMenu(menuTemplate === null ? null : Menu.buildFromTemplate(menuTemplate))
    if (is.dev) {
      app.on('browser-window-created', (_, window) => {
        installDevToolsToggle(window.webContents)
      })
    }

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
        : createSettingsStore({
            blobStore: createElectronSettingsBlobStore(),
            defaults: PROFILE_SETTINGS_DEFAULTS,
            report: storageHealth.reporterFor('settings')
          })
    } catch {
      // Code ONLY — never the error. A JSON SyntaxError message QUOTES the offending file
      // content, which can carry an operator path (zod-boundaries.md never-log-the-value).
      console.error('[c9watch][settings] code=settings_store_init_failed (using in-memory)')
      storageHealth.report('settings', 'read_failed')
      settingsStore = createSettingsStore({ defaults: PROFILE_SETTINGS_DEFAULTS })
    }
    registerSettingsIpc()

    // Custom themes — the scanner over <userData>/themes plus the bundled, read-only themes, and the
    // apply lifecycle. The push goes to
    // every window (a single window today); `nativeTheme.themeSource` follows the bundle.
    themeScanner = createThemeScanner({
      dir: join(app.getPath('userData'), 'themes'),
      bundled: bundledThemes()
    })
    themeLifecycle = createThemeLifecycle({
      load: (id, wallpaperId) => (themeScanner as ThemeScanner).load(id, wallpaperId),
      push: (bundle) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.webContents.isDestroyed()) win.webContents.send(CH.themeApplied, bundle)
        }
      },
      setNativeTheme: (scheme) => {
        nativeTheme.themeSource = scheme
      }
    })
    registerThemesIpc()

    try {
      workspacesStore = SMOKE
        ? createWorkspacesStore({ hasLiveSessions, cascade })
        : createWorkspacesStore({
            blobStore: createElectronWorkspacesBlobStore(),
            hasLiveSessions,
            cascade,
            report: storageHealth.reporterFor('workspaces')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a
      // workspaces blob carries operator names and a default cwd.
      console.error('[claude-watcher][workspaces] code=workspaces_store_init_failed (in-memory)')
      storageHealth.report('workspaces', 'read_failed')
      workspacesStore = createWorkspacesStore({ hasLiveSessions, cascade })
    }
    registerWorkspacesIpc()

    // Rules — T-17: a rule never silently loses the template it points at. rulesStore does not
    // exist yet at this point (constructed after tagsStore below), but this reads it LIVE (a
    // closure over the module-level `let`), so it is correct once app startup finishes wiring
    // every store — the same late-binding style as `hasLiveSessions`/`cascade` above.
    const ruleRefCount = (id: string): number => rulesStore?.countTemplateRefs(id) ?? 0
    // §1.4 — narrowing a used template's scope is refused (the same check tags run for T-16).
    const templateRuleRefs = (id: string): TemplateRuleRef[] => rulesStore?.refsToTemplate(id) ?? []
    try {
      templatesStore = SMOKE
        ? createTemplatesStore({ ruleRefCount, ruleRefs: templateRuleRefs })
        : createTemplatesStore({
            blobStore: createElectronTemplatesBlobStore(),
            ruleRefCount,
            ruleRefs: templateRuleRefs,
            report: storageHealth.reporterFor('templates')
          })
    } catch {
      // Code ONLY — never the error (see the settings catch above: a SyntaxError message
      // quotes file content, and a template blob carries operator cwds and names).
      console.error('[claude-watcher][templates] code=templates_store_init_failed (in-memory)')
      storageHealth.report('templates', 'read_failed')
      templatesStore = createTemplatesStore({ ruleRefCount, ruleRefs: templateRuleRefs })
    }
    registerTemplatesIpc()

    // Rules — T-16: a tag any rule references cannot be deleted; narrowing a used tag's scope
    // is refused. Same late-binding as ruleRefCount above.
    const ruleRefs = (id: string): TagRuleRef[] => rulesStore?.refsToTag(id) ?? []
    try {
      tagsStore = SMOKE
        ? createTagsStore({ ruleRefs })
        : createTagsStore({
            blobStore: createElectronTagsBlobStore(),
            ruleRefs,
            report: storageHealth.reporterFor('tags')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a tags blob
      // carries operator names.
      console.error('[claude-watcher][tags] code=tags_store_init_failed (in-memory)')
      storageHealth.report('tags', 'read_failed')
      tagsStore = createTagsStore({ ruleRefs })
    }
    registerTagsIpc()

    try {
      rulesStore = SMOKE
        ? createRulesStore(ruleLookups())
        : createRulesStore({
            ...ruleLookups(),
            blobStore: createElectronRulesBlobStore(),
            report: storageHealth.reporterFor('rules')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a rules blob
      // carries operator names and patterns.
      console.error('[claude-watcher][rules] code=rules_store_init_failed (in-memory)')
      storageHealth.report('rules', 'read_failed')
      rulesStore = createRulesStore(ruleLookups())
    }
    registerRulesIpc()

    try {
      shortcutsStore = SMOKE
        ? createShortcutsStore()
        : createShortcutsStore({
            blobStore: createElectronShortcutsBlobStore(),
            report: storageHealth.reporterFor('shortcuts')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a shortcuts
      // blob carries operator phrases.
      console.error('[claude-watcher][shortcuts] code=shortcuts_store_init_failed (in-memory)')
      storageHealth.report('shortcuts', 'read_failed')
      shortcutsStore = createShortcutsStore()
    }
    registerShortcutsIpc()

    // Past sessions — after the workspaces store: a record may only name a workspace that exists.
    const workspaceExists = (id: string): boolean => workspacesStore?.get(id) !== null
    try {
      pastSessionsStore = SMOKE
        ? createPastSessionsStore({ workspaceExists })
        : createPastSessionsStore({
            blobStore: createElectronPastSessionsBlobStore(),
            workspaceExists,
            report: storageHealth.reporterFor('past_sessions')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a record
      // carries operator names and cwds.
      console.error(
        '[claude-watcher][past-sessions] code=past_sessions_store_init_failed (in-memory)'
      )
      storageHealth.report('past_sessions', 'read_failed')
      pastSessionsStore = createPastSessionsStore({ workspaceExists })
    }
    registerPastSessionsIpc()

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
    registerLinksIpc()
    registerServerHealthIpc()

    // Programmatic API — build the token store + the listener's lifecycle, and register the token
    // IPC ONCE. NOTHING BINDS HERE: `apiLifecycle.apply` is the only thing that starts a listener,
    // and the first apply rides the main window's `did-finish-load` (createWindow) — see the
    // comment there for why it is not applied on this tick. The token file is not written until
    // something asks for the token (a bind, or the Settings panel), so an app with the API off
    // never mints one.
    apiTokenStore = createApiTokenStore({ dir: app.getPath('userData'), log: apiLog })
    // Resolved ONCE, not per request: `require.resolve` walks node_modules and `/docs` asks for its
    // three assets on every load. Null (a pruned/broken install) degrades `/docs` to a 503 and
    // leaves the rest of the API untouched.
    const swaggerDistDir = resolveSwaggerDistDir()
    apiLifecycle = createApiLifecycle({
      start: (port, onListening, onError) => {
        const store = apiTokenStore
        // The lifecycle CONTAINS a throwing `start` (logs `code=listen_failed`, stays stopped), so
        // this is a refusal to serve without a token, not a crash.
        if (store === null) throw new Error('api token store not initialized')
        // `/openapi.json` is PUBLIC, and building the document runs six `z.toJSONSchema`
        // conversions — work an unauthenticated caller could ask for in a loop. So it is built
        // once and held, keyed by the port that ends up in `servers[0].url`.
        //
        // INVALIDATION is the key, not a hand-written reset: the port is the REQUESTED one until
        // the bind reports and the BOUND one after (they differ whenever `apiPort` is 0), so the
        // first request arriving inside that window cannot pin a stale URL — the key changes and
        // the document is rebuilt exactly once more. A restart or a stop builds a NEW `start`
        // closure, and with it a new empty cache, so there is nothing else to invalidate.
        let openApiCache: { port: number; doc: Record<string, unknown> } | null = null
        const docs = createDocsRoutes({
          openapi: () => {
            const docPort = apiLifecycle?.port() ?? port
            if (openApiCache === null || openApiCache.port !== docPort) {
              openApiCache = {
                port: docPort,
                doc: buildOpenApiDocument(apiCommands, { port: docPort, version: app.getVersion() })
              }
            }
            return openApiCache.doc
          },
          swaggerDistDir,
          log: apiLog
        })
        const server: ApiServer = createApiServer({
          commands: apiCommands,
          context: {
            // Session truth is per WINDOW; the listener is app-global. It reads the single
            // window's seam, and a window that is gone (or was never ready) answers `no_window`
            // (503, retryable) instead of the API inventing a board of its own.
            seam: () => {
              const win = BrowserWindow.getAllWindows()[0]
              if (win === undefined || win.webContents.isDestroyed()) return null
              return apiSeams.get(win.webContents) ?? null
            },
            // NARROW on purpose (`Pick<…, 'get'>` / `'activeId' | 'get'`): the API reads the
            // operator's own config, it is never a second write path into it.
            templates: requireTemplatesStore(),
            workspaces: requireWorkspacesStore(),
            // The SAME version gate the in-app launch runs, so an API create cannot spawn a claude
            // the `+ New session` popover would refuse — but its API face: no desktop error box
            // (the caller gets 503 `claude_version`) and no shell probe per retry (R25).
            claudeVersionAllowsLaunch: claudeVersionAllowsApiLaunch,
            // UX-11 — `409 folder_missing` before the launch, never a 201 for a card that dies.
            isDirectory: isExistingDirectory,
            // SEC-6 — the same bind signal `hookSettingsPathForSpawn` reads: no bind, no create.
            hooksListening: () => serverHealth.hookListening(),
            now: Date.now,
            spawnTimeoutMs: API_SPAWN_TIMEOUT_MS,
            log: apiLog
          },
          // A GETTER, never the value: a Regenerate takes effect on the very next request, with no
          // restart and without dropping the open streams.
          token: () => store.current(),
          publicRoutes: docs,
          port,
          onListening,
          onError,
          log: apiLog
        })
        return server
      },
      log: apiLog,
      onState: (state) => serverHealth.setApi(state)
    })
    // SMOKE — force the listener up on an EPHEMERAL port so the packaged binary proves that
    // `/docs` and `/openapi.json` are reachable from inside the asar (the smoke-report handler
    // fetches both and the runner gates on them). Port 0 is main-owned smoke input, not a
    // settings write, so the settings schema's 1024 floor is not involved; the host is still
    // 127.0.0.1. The smoke settings store is in-memory with `apiEnabled: false`, so this explicit
    // apply is the only thing that binds here — and it is also why the first settings-driven
    // apply (createWindow's `did-finish-load`) is skipped in SMOKE: applying a disabled setting
    // would stop this listener before the verdict is taken.
    if (SMOKE) apiLifecycle.apply({ apiEnabled: true, apiPort: 0 })
    registerApiIpc()

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
      // Past sessions (D-3) — the nothing-live quit archives too (a bound session the guard's
      // count did not see still gets its record). Runs only when this quit goes ahead.
      archiveLiveSessions: () => archiveLiveSessions(),
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

// Programmatic API — close the listener when the quit is REAL, so the open SSE streams end with
// the app instead of being cut by the process going away.
//
// `will-quit`, NOT `before-quit`: before-quit has THREE exits — nothing-live (proceeds), the
// re-entrant call the Quit-guard's confirm makes (short-circuits at the top), and CANCEL (the
// operator stays in the app, and a cancelled quit must change nothing — FROZEN #1). Electron emits
// `will-quit` only once the quit is actually going ahead, which is exactly the condition, in one
// place, with no duplication. `stop()` is idempotent and never throws (a `close` that throws is
// contained and logged by code).
app.on('will-quit', () => {
  apiLifecycle?.stop()
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
