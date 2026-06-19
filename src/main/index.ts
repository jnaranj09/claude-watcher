import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as os from 'os'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import icon from '../../resources/icon.png?asset'
// Story 0.2 — channels go through the typed contract, never string literals.
import { CH } from '../shared/ipc/contract'
import type { PtyResizeRequest, SmokeReport } from '../shared/ipc/contract'
// Story 1.4 fix — validate-at-source for the watch:status connection-state push.
import { WatchStatusSchema } from '../shared/schemas/watchDelta'
// Story 1.4 — validate-at-source enrichment of the session.updated delta (extracted
// to its own module so it stays unit-testable without pulling electron/node-pty).
import { enrichDelta } from './c9watch/enrichDelta'
// Story 1.1 — the c9watch adapter: feed (spawn + NDJSON line-split + reconnect) +
// reducer (Zod-validate → Map<id,Session> + list seed/reconcile + epoch).
import { createReducer } from './c9watch/reducer'
import { createFeed, type Feed } from './c9watch/feed'
// Story 1.2 — the column-transition tracker: consumes each reducer delta + the
// reduced map, emits attention.raised on a needs-you ENTRY edge (cold-start
// suppressed / reconnect re-raised), stamps time-entered-column, debounces flaps.
import { createAttentionTracker } from './c9watch/attention'

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

// Story 1.1 — the live c9watch feed → reducer → renderer wiring. ONE feed per
// window; the feed pushes validated session deltas (frozen `session.updated`/
// `session.removed`, epoch-framed) over CH.watchEvents. The feed is INDEPENDENT of
// the PTY registry above — a watch reconnect must never touch PTY state.
const feeds = new Map<Electron.WebContents, Feed>()

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
  // Story 1.2 — one tracker per window (same lifetime as the reducer/feed). It reads
  // the reducer's already-validated deltas + map (parse-once; never re-parses) and
  // produces the entry-transition attention.raised events. Injected now() for
  // determinism (the default Date.now in production).
  const tracker = createAttentionTracker({ now: () => Date.now() })
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
      const outbound = enrichDelta(delta, tracker, reducer.snapshotMap())
      // A `session.updated` whose enrichment failed validate-at-source is DROPPED (the
      // enricher logged it by path+code) — we do not ship a half-formed delta. A
      // `session.removed` (no enrichment) and a passed `session.updated` send as-is —
      // epoch-framed on the SAME CH.watchEvents channel (const, never a string literal).
      if (outbound !== null) wc.send(CH.watchEvents, outbound)
      // Then any attention.raised for the SAME edge, framed with the SAME epoch.
      // Re-check the destroyed window per send: a late event after close is a no-op.
      for (const raised of raisedEvents) {
        if (!wc.isDestroyed()) wc.send(CH.watchEvents, { epoch: delta.epoch, event: raised })
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
  feed.start().catch((err) => {
    console.error(
      '[c9watch][feed] failed to start (board will stay empty):',
      err instanceof Error ? err.message : 'unknown'
    )
  })
}

// Stop + drop a window's feed. Idempotent. Called on window close (clean teardown
// via the feed's AbortController — no leaked watch child, no stacked listeners).
function teardownWatchFeed(wc: Electron.WebContents): void {
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

// Build the child env for the PTY (Review F7): drop undefined-valued keys (the
// process.env type lies about this) and strip the smoke-harness vars so they do
// not leak into the spawned shell or anything it launches.
function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'C9_SMOKE' || k === 'C9_SMOKE_OUT') continue
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
    // the watch child. Independent of the PTY teardown above.
    teardownWatchFeed(wc)
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
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.c9watch')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Register PTY/smoke IPC ONCE (Review F1) — not per-window, so app.activate
    // re-creating a window cannot throw on duplicate ipcMain.handle nor stack
    // ipcMain.on listeners.
    registerPtyIpc()

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

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
