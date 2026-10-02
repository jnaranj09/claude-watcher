import { app, shell, BrowserWindow, ipcMain, clipboard, nativeTheme, Menu } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { electronApp, is } from '@electron-toolkit/utils'
import * as os from 'os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import icon from '../../resources/icon.png?asset'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type { PtyResizeRequest, SmokeConfig, SmokeReport } from '../shared/ipc/contract'
import type { TerminalManager } from './pty/terminalManager'
// Version gate — the spawn depends on `--session-id`, `-n` and `--settings`; a claude that
// does not know one of them dies instantly instead of degrading. Fails OPEN on an unreadable
// version (see claudeVersion.ts for why that inversion is deliberate).
import { createClaudeVersionGate } from './pty/claudeVersion'
import type { AttentionTracker } from './c9watch/attention'
// Story 2.4 — the app-global settings store (electron-store in MAIN, behind a DI seam) +
// its versioned-Zod payload schema. The store is constructed ONCE (settings are app-global,
// NOT per-window like the feed/tray) and registered on the typed CH.settingsGet/Set channels.
// The renderer reads/writes via window.settings.* — never electron-store directly (F4).
import { createSettingsStore, type SettingsStore } from './persistence/settings'
import { createElectronSettingsBlobStore } from './persistence/electronSettingsBlobStore'
import { SettingsPatchSchema, DEFAULT_SETTINGS } from '../shared/schemas/settings'
import { createWorkspacesStore, type WorkspacesStore } from './persistence/workspaces'
import { createWorkspacesIpcHandlers } from './persistence/workspacesIpc'
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
import { archiveTranscriptCheck, createTranscriptLookupFromFs } from './pty/claudeTranscript'
import { createTagsStore, type TagsStore } from './persistence/tags'
import { createElectronTagsBlobStore } from './persistence/electronTagsBlobStore'
import { createTagsIpcHandlers } from './persistence/tagsIpc'
// Rules — the main-owned rule list (Phase 2): the store + its IPC handler bodies + its Electron
// blob store (mirrors tags/templates), the per-window engine, the launch-time rules, the pure
// evaluation snapshot type, and the delta-pipeline order the engine depends on (spec §2.2).
import { createRulesStore, type RulesStore, type RulesStoreOptions } from './persistence/rules'
import { createElectronRulesBlobStore } from './persistence/electronRulesBlobStore'
import { createRulesIpcHandlers } from './persistence/rulesIpc'
import type { TagRuleRef } from './persistence/tags'
import type { RulesEngine } from './rules/rulesEngine'
import type { RulesSnapshot } from './rules/evaluateRules'
import type { LaunchService } from './pty/launchSession'
// Story 6.3 — FAST REMOVAL: the extracted stop/exit removal decision (unit-tested in
// launchRemoval.test.ts). Stop and PTY-exit resolve the exact spawn-time terminalId →
// sessionId binding, clear it, and route the bound session's removal through the owning
// window's reducer → the SAME handleDelta chokepoint (session.removed → card gone NOW,
// no SessionEnd hook / feed event needed). Past sessions: `archiveBoundSessions` is the same
// removal for the paths that fire NO onExit (quit, window close).
import { archiveBoundSessions } from './pty/launchRemoval'
import type { ShellCompanionRegistry } from './pty/shellCompanion'
import { createLaunchedSet, type LaunchedSet } from './pty/launchedSet'
import { createProcessSessionSourceFromFs } from './pty/claudeSessionFile'
import { createRunningElsewhereCheckFromFs } from './pty/runningElsewhere'
// Programmatic API — the localhost HTTP listener and everything behind it. Every decision in it
// lives in one of these modules and is unit-tested there; this file only WIRES them (nothing can
// import index.ts, so no logic may live here that a test would need to reach).
import { createApiServer, type ApiServer } from './api/apiServer'
import type { ApiSeam } from './api/apiSeam'
import { createApiTokenStore, type ApiTokenStore } from './api/apiToken'
import { createApiLifecycle, type ApiLifecycle } from './api/apiLifecycle'
import { buildOpenApiDocument } from './api/openapi'
import { createDocsRoutes, resolveSwaggerDistDir } from './api/docs'
import { apiCommands } from './api/commands'
import { API_SPAWN_TIMEOUT_MS } from './api/apiContract'
// Custom themes — the folder scanner (T5) and the apply lifecycle (T11), wired below.
import { createThemeScanner, type ThemeScanner } from './themes/themeScanner'
import { BUNDLED_THEME_IDS, bundledThemesDir } from './themes/bundledThemes'
import { createThemeLifecycle, type ThemeLifecycle } from './themes/themeLifecycle'
import { chosenWallpaper, themeNeedsReapply } from './themes/themeApplyTrigger'
import { openThemesFolder } from './themes/openThemesFolder'
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
import { buildPtyEnv } from './pty/ptyEnv'
import { createServerHealth } from './serverHealth'
import { ServerHealthSchema, type ServerHealth } from '../shared/schemas/serverHealth'
import { createStorageHealth } from './storageHealth'
import { StorageHealthSchema, type StorageHealth } from '../shared/schemas/storageHealth'
import { claimSingleInstance } from './lifecycle/singleInstance'
// Session-rebind — claude can change its own session id mid-run (a `/clear` keeps the pty and
// the terminal, but fires SessionEnd for the old id and posts every later hook under a new
// one). These two decisions keep the card through that switch. [hooks/sessionRebind.ts]
import { createOrphanRegistry } from './hooks/sessionRebind'
import { PROFILE } from './profile'
import { createTrustedIpc, isTrustedSender, rendererSource } from './ipc/trustedIpc'
import { registerTerminalIpc } from './ipc/registerTerminalIpc'
import {
  isExistingDirectory,
  readClaudeVersionRaw,
  registerLaunchIpc
} from './ipc/registerLaunchIpc'
import { createWatchFeed, type LaunchBoardSeam } from './window/watchFeed'

// Smoke mode (Story 0.1 AC-3): when C9_SMOKE=1, the renderer runs a scripted
// type -> read-back -> resize -> TUI sequence and reports a JSON verdict, which
// we persist to C9_SMOKE_OUT (or stdout) and then exit. This makes the packaged
// exit gate machine-verifiable in a headless/autonomous run.
const SMOKE = process.env.C9_SMOKE === '1'

// The ONE place main decides where its renderer comes from: `createWindow` loads it, and every IPC
// listener (registered through `ipc`, never `ipcMain` directly) answers only a top frame loaded
// from it (`ipc/trustedIpc.ts`, technical-taste §5b-22).
const RENDERER_SOURCE = rendererSource(
  is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
  join(__dirname, '../renderer/index.html')
)
const ipc = createTrustedIpc({
  ipcMain,
  isTrusted: (event) => isTrustedSender(event.senderFrame, RENDERER_SOURCE),
  log: (line) => console.warn(line)
})
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
// Card shell pane — the plain-shell companions of launched terminals (shellCompanion.ts). Built in
// registerLaunchIpc (it needs the launch service); read at call time by the terminal:open/stop
// handlers registered earlier, so it is nullable there.
let shellCompanions: ShellCompanionRegistry | null = null

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
const launchBoardSeams = new Map<Electron.WebContents, LaunchBoardSeam>()

// Programmatic API — the per-window seam + its event hub, EXACTLY the lifetime of the board seam
// above (set in registerWatchFeed, dropped in teardownWatchFeed). Session truth is per window; the
// LISTENER is app-global and reads the single window's seam (`BrowserWindow.getAllWindows()[0]`),
// answering `no_window` when there is none. The hub is held in its own map only so the teardown can
// clear its subscribers — nothing else reads it.
const apiSeams = new Map<Electron.WebContents, ApiSeam>()

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
      // Card shell pane — drop the companion entry (its own pty is stopped by this loop too).
      shellCompanions?.stopFor(terminalId)
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
  registerSmokeIpc(ipc, SMOKE, {
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
/** Does claude still have a session's conversation? UX-08 (Open refuses) and NEW-5 (an archive
 *  writes no record) — the archive side only trusts a no-path scan while the hooks are bound. */
const hasTranscript = createTranscriptLookupFromFs()
const archiveHasTranscript = archiveTranscriptCheck(hasTranscript, () =>
  serverHealth.hookListening()
)

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

// Story 6.4 — the native session engine, one per window: `registerWatchFeed` on ready-to-show,
// `teardownWatchFeed` on close (window/watchFeed.ts). The maps passed in are shared with the IPC
// handlers here; the maps only the feed uses live inside it.
const { registerWatchFeed, teardownWatchFeed } = createWatchFeed({
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
  getLaunchService: () => launchService,
  getTerminalManager: () => terminalManager,
  getShellCompanions: () => shellCompanions,
  getSettingsStore: () => settingsStore,
  getTagsStore: () => tagsStore,
  getPastSessionsStore: () => pastSessionsStore,
  requireWorkspacesStore,
  rulesSnapshot,
  apiLog
})

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
  ipc.handle(CH.settingsGet, () => {
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
  ipc.handle(CH.settingsSet, (_evt, raw: unknown) => {
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
  ipc.handle(CH.themesList, () => {
    if (themeScanner === null) throw new Error('theme scanner not initialized')
    return themeScanner.scan()
  })
  ipc.handle(CH.themeReload, () => {
    if (themeLifecycle === null || settingsStore === null)
      throw new Error('theme lifecycle not initialized')
    const s = settingsStore.get()
    return themeLifecycle.apply(s.themeId, chosenWallpaper(s))
  })
  // Answers at once, never awaiting the opener — see openThemesFolder.ts (Linux never settles it).
  ipc.handle(CH.themesOpenFolder, () => {
    if (themeScanner === null) throw new Error('theme scanner not initialized')
    openThemesFolder(themeScanner.dir(), {
      mkdir: (dir) => mkdirSync(dir, { recursive: true }),
      openPath: (dir) => shell.openPath(dir)
    })
  })
}

// Programmatic API — the token bridge, registered ONCE (mirrors registerSettingsIpc). Read-only
// for the renderer except Regenerate: the token is not in settings.json (the renderer reads that
// whole blob) but in its own 0600 file, so this is the only way the Settings panel can show it.
// NEITHER handler logs the token — it IS the secret.
function registerApiIpc(): void {
  ipc.handle(CH.apiTokenGet, () => {
    if (apiTokenStore === null) throw new Error('api token store not initialized')
    return { token: apiTokenStore.current() }
  })
  ipc.handle(CH.apiTokenRegenerate, () => {
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
  ipc.handle(CH.templatesList, () => handlers.list())
  ipc.handle(CH.templatesSave, (_evt, raw: unknown) => handlers.save(raw))
  ipc.handle(CH.templatesDelete, (_evt, raw: unknown) => handlers.remove(raw))
}

// Past sessions — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/pastSessionsIpc.ts (unit-tested); this only binds `list`/`forget` to CH.* channels.
// `session:archive`, `session:delete` and `past-sessions:open` get their bridges now but their
// main handlers are wired later — they need the launch service and the reducer.
function registerPastSessionsIpc(): void {
  const handlers = createPastSessionsIpcHandlers(requirePastSessionsStore())
  ipc.handle(CH.pastSessionsList, () => handlers.list())
  ipc.handle(CH.pastSessionsForget, (_evt, raw: unknown) => handlers.forget(raw))
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
  ipc.handle(CH.tagsList, () => handlers.list())
  ipc.handle(CH.tagsSave, (_evt, raw: unknown) => {
    const result = handlers.save(raw)
    pruneEverywhere()
    return result
  })
  ipc.handle(CH.tagsDelete, (_evt, raw: unknown) => {
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
  ipc.handle(CH.rulesList, () => handlers.list())
  ipc.handle(CH.rulesSave, (_evt, raw: unknown) => {
    const result = handlers.save(raw)
    for (const engine of ruleEngines.values()) engine.onRuleSaved(result.saved.id)
    return result
  })
  ipc.handle(CH.rulesDelete, (_evt, raw: unknown) => {
    const view = handlers.remove(raw)
    for (const engine of ruleEngines.values()) engine.onRulesRemoved()
    return view
  })
  ipc.handle(CH.rulesMove, (_evt, raw: unknown) => handlers.move(raw))
}

// Workspaces — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/workspacesIpc.ts (unit-tested); this only binds them to CH.* channels.
function registerWorkspacesIpc(): void {
  const handlers = createWorkspacesIpcHandlers(requireWorkspacesStore())
  ipc.handle(CH.workspacesList, () => handlers.list())
  ipc.handle(CH.workspacesSave, (_evt, raw: unknown) => handlers.save(raw))
  ipc.handle(CH.workspacesDelete, (_evt, raw: unknown) => handlers.remove(raw))
  ipc.handle(CH.workspacesSetActive, (_evt, raw: unknown) => handlers.setActive(raw))
}

// Phrase shortcuts — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
// persistence/shortcutsIpc.ts (unit-tested); this only binds them to CH.* channels. There is
// deliberately no channel for DELIVERING a phrase — a matched chord posts it on the terminal's
// existing MessagePort `{type:'input'}` frame.
function registerShortcutsIpc(): void {
  // Called AFTER the store is built, so the handlers are bound once instead of rebuilt on every
  // invoke. requireShortcutsStore() stays — it throws a clear error if ever mis-ordered.
  const handlers = createShortcutsIpcHandlers(requireShortcutsStore())
  ipc.handle(CH.shortcutsList, () => handlers.list())
  ipc.handle(CH.shortcutsSave, (_evt, raw: unknown) => handlers.save(raw))
  ipc.handle(CH.shortcutsDelete, (_evt, raw: unknown) => handlers.remove(raw))
}

// Story 3.5 (SM-2) — register the telemetry-acknowledge IPC ONCE (mirrors registerSettingsIpc:
// single-registration, app-global, parse-and-throw on the arg). Channels are CH.* consts only —
// never a string literal (no-literal-channels). The arg is UNTRUSTED cross-process input →
// TelemetryAcknowledgeSchema.parse(raw) throws a typed error on a bad arg (zod-boundaries.md
// IPC-arg row). MAIN computes the duration (it owns tracker.enteredColumnAt). Never logs the
// value — log path+code only (Guardrail #6; the arg carries sessionId which is an opaque UUID
// but the rule is uniform). The invoke returns void. [story 3.5 Task 3.3 / FROZEN-3]
function registerTelemetryIpc(): void {
  ipc.handle(CH.telemetryAcknowledge, (evt, raw: unknown) => {
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

/**
 * Block the launch when claude is verifiably too old. The in-app callers throw the
 * `claude_version` CODE (`requireClaudeVersion` / `runInAppLaunch`), which the name prompt, Past
 * sessions and the dead pane map to copy where the operator is looking — main shows no native box
 * (spec 2026-09-29 §2.4). R25: the API path (`claudeVersionAllowsApiLaunch`) answers its own 503
 * `claude_version` and reuses a refusal for 30 s instead of re-probing the shell on every retry.
 * The decision lives in `createClaudeVersionGate` (claudeVersion.ts, unit-tested).
 */
const claudeVersionGate = createClaudeVersionGate({
  readRaw: () => readClaudeVersionRaw(SHELL),
  now: Date.now,
  log: (m) => console.warn(m)
})
function claudeVersionAllowsLaunch(): boolean {
  return claudeVersionGate.allowsInteractiveLaunch()
}
function claudeVersionAllowsApiLaunch(): boolean {
  return claudeVersionGate.allowsApiLaunch()
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
  ipc.handle(CH.serverHealthGet, () => serverHealth.get())
  ipc.handle(CH.storageHealthGet, () => storageHealth.get())
}

function registerLinksIpc(): void {
  ipc.handle(CH.linkOpenExternal, (_evt, raw: unknown) => {
    const { url } = LinkOpenExternalSchema.parse(raw)
    externalLinks.open(url)
  })
}

function registerClipboardIpc(): void {
  // clipboard:read-text — read the OS clipboard text and return it directly. No arg to
  // parse; the read is safe (no cross-process input). Returns '' if the clipboard has no
  // text (e.g. image-only clipboard), which the renderer interprets as "Paste disabled".
  ipc.handle(CH.clipboardReadText, () => clipboard.readText()) // a Promise since Electron 44

  // clipboard:write-text — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS
  // boundary (a malformed write arg rejects the invoke). NEVER log the text value —
  // the throw IS the signal; user clipboard content must not enter the log stream
  // (Guardrail #6; .claude/rules/zod-boundaries.md IPC-arg row).
  // Electron 44 made the main clipboard async (W3C-shaped): await the write so a refused write
  // rejects the invoke instead of floating.
  ipc.handle(CH.clipboardWriteText, async (_evt, raw: unknown) => {
    const { text } = ClipboardWriteTextSchema.parse(raw)
    await clipboard.writeText(text)
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
  ipc.handle(CH.appRequestQuit, () => {
    app.quit()
  })

  // quit:confirm — "Quit anyway" was clicked. Main proceeds: sets isQuitting, teardown, quit.
  // The re-entrant before-quit (triggered by the quit) sees isQuitting=true and short-circuits.
  ipc.handle(CH.quitConfirm, () => {
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
  ipc.handle(CH.quitCancel, () => {
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
  if (RENDERER_SOURCE.kind === 'dev') {
    void mainWindow.loadURL(RENDERER_SOURCE.url)
  } else {
    void mainWindow.loadFile(RENDERER_SOURCE.path)
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
        ? createPastSessionsStore({ workspaceExists, hasTranscript: archiveHasTranscript })
        : createPastSessionsStore({
            blobStore: createElectronPastSessionsBlobStore(),
            workspaceExists,
            hasTranscript: archiveHasTranscript,
            report: storageHealth.reporterFor('past_sessions')
          })
    } catch {
      // Code ONLY — never the error: a SyntaxError message quotes file content, and a record
      // carries operator names and cwds.
      console.error(
        '[claude-watcher][past-sessions] code=past_sessions_store_init_failed (in-memory)'
      )
      storageHealth.report('past_sessions', 'read_failed')
      pastSessionsStore = createPastSessionsStore({
        workspaceExists,
        hasTranscript: archiveHasTranscript
      })
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
    terminalManager = registerTerminalIpc({
      ipc,
      shell: SHELL,
      terminalOwners,
      launchBoardSeams,
      reducers,
      focusedTerminals,
      orphanRegistry,
      getTerminalManager: () => terminalManager,
      getLaunchService: () => launchService,
      getShellCompanions: () => shellCompanions,
      requireWorkspacesStore,
      rulesSnapshot
    })

    // Story 3.2 (FR-11) — register the launch IPC ONCE (after the terminal manager exists, since
    // the launch service spawns through it). Mirrors registerTerminalIpc single-registration.
    const launch = registerLaunchIpc({
      ipc,
      shell: SHELL,
      serverHealth,
      terminalOwners,
      launchBoardSeams,
      launchedSet,
      runningElsewhere,
      hasTranscript,
      claudeVersionAllowsLaunch,
      isSessionLive,
      getTerminalManager: () => terminalManager,
      getPastSessionsStore: () => pastSessionsStore,
      getTagsStore: () => tagsStore,
      requireWorkspacesStore,
      requireTemplatesStore,
      requirePastSessionsStore,
      requireTagsStore
    })
    launchService = launch.launchService
    shellCompanions = launch.shellCompanions

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
