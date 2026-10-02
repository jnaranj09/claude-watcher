import { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import type { SettingsStore } from '../persistence/settings'
import type { ApiLifecycle } from '../api/apiLifecycle'
import type { ThemeLifecycle } from '../themes/themeLifecycle'
import { chosenWallpaper } from '../themes/themeApplyTrigger'
import { installLinkGuards, type ExternalLinks } from '../links/externalLinks'
import type { QuitGuardState } from '../lifecycle/quitGuard'
import type { RendererSource } from '../ipc/trustedIpc'
import { PROFILE } from '../profile'
import type { WatchFeed } from './watchFeed'

/** What the main window reads from the app. Paths and the renderer source are resolved by
 *  index.ts; state it assigns after app-ready is read through GETTERS. */
export interface CreateWindowDeps {
  smoke: boolean
  /** The app icon (Linux sets it on the window). */
  icon: string
  /** The built preload script. */
  preloadPath: string
  rendererSource: RendererSource
  quitGuardState: QuitGuardState
  externalLinks: ExternalLinks
  ptys: Map<Electron.WebContents, IPty>
  getSettingsStore: () => SettingsStore | null
  getApiLifecycle: () => ApiLifecycle | null
  getThemeLifecycle: () => ThemeLifecycle | null
  registerWatchFeed: WatchFeed['registerWatchFeed']
  teardownWatchFeed: WatchFeed['teardownWatchFeed']
  teardownWindowTerminals: (wc: Electron.WebContents) => void
}

/** Builds `createWindow`; index.ts calls it at app-ready and from `activate`. */
export function makeCreateWindow(deps: CreateWindowDeps): () => void {
  const {
    smoke: SMOKE,
    icon,
    preloadPath,
    rendererSource: RENDERER_SOURCE,
    quitGuardState,
    externalLinks,
    ptys,
    getSettingsStore,
    getApiLifecycle,
    getThemeLifecycle,
    registerWatchFeed,
    teardownWatchFeed,
    teardownWindowTerminals
  } = deps

  return function createWindow(): void {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: preloadPath,
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
    // With hardware acceleration disabled (2026-08-03 to 2026-09-22; see the "GPU ON" block in
    // src/main/index.ts) it never fired at all on this KWin/Wayland host, so
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
      const settingsStore = getSettingsStore()
      if (settingsStore === null) return
      getApiLifecycle()?.apply(settingsStore.get())
    })

    // Custom themes — the FIRST apply of the persisted theme, here for the same reason as the API
    // above: the renderer must be running to receive the push. The renderer also asks for a reload
    // once its subscription is up (App.tsx), so a push that lands before the effect subscribed is
    // not lost. Runs in SMOKE too: the in-memory store's themeId is `default`, no disk is read.
    mainWindow.webContents.once('did-finish-load', () => {
      const settingsStore = getSettingsStore()
      if (settingsStore === null) return
      const s = settingsStore.get()
      getThemeLifecycle()?.apply(s.themeId, chosenWallpaper(s))
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
}
