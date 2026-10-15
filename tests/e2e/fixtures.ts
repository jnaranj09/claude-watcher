// The one e2e fixture: it owns how a spec launches the BUILT app, what it captures, and how the
// app is torn down, so a spec holds only its journey and its assertions.
//
// Every app runs on the e2e profile (`CLAUDE_WATCHER_PROFILE=e2e`, src/main/profile.ts): its own
// hook and API ports, and a fresh temp data folder per launch (`CLAUDE_WATCHER_E2E_DATA_DIR`), so
// it runs beside the installed app and never reads or writes the operator's data. The folder
// starts with alerts muted (a launched claude's turn end would otherwise pop a desktop
// notification), and is removed after the test.
//
// Teardown runs on pass AND fail, in this order: on failure keep the trace, main's log and a
// screenshot under the test's output dir; then reap the launched claudes (they sit in their own
// session); then SIGKILL the Electron process group. `app.close()` is never used: a title-bar
// close only minimizes this app, so it hangs ~120 s.
//
// The native KDE folder picker cannot be driven, so `C9_TEST_PICK_DIR` (a test-only seam in
// src/main/ipc/registerLaunchIpc.ts) makes `+ New session → Pick a folder…` return `pickDir`.

import { test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { E2E_DATA_DIR_ENV } from '../../src/main/profile'
import { killLaunchedClaudes } from './support/proc'

export { expect } from '@playwright/test'

/** The built entry point (`electron-vite build`; `npm run test:e2e` runs it first). */
export const BUILT_MAIN = path.resolve(__dirname, '../../out/main/index.js')

export interface AppEnv {
  env: NodeJS.ProcessEnv
  dataDir: string
  pickDir: string
}

/** Main's stdout and stderr, from the moment the fixture attached to them. */
export interface MainLog {
  lines: () => string[]
  text: () => string
}

// The settings file of the app's userData (the electron-store blob of
// src/main/persistence/electronSettingsBlobStore.ts). The smallest valid v1 blob; the rest
// defaults. Same keys `muteDriveAlerts` writes in tests/drive/driveApp.mjs.
const SETTINGS_FILE = 'c9watch-settings.json'
const MUTED_SETTINGS = {
  settings: { version: 1, terminalFontSize: 14, notificationsEnabled: false, soundEnabled: false }
}

function captureLog(proc: ChildProcess): MainLog {
  const chunks: string[] = []
  const add = (chunk: Buffer): void => {
    chunks.push(chunk.toString('utf8'))
  }
  proc.stdout?.on('data', add)
  proc.stderr?.on('data', add)
  const text = (): string => chunks.join('')
  return {
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((l) => l !== '')
  }
}

const hasExited = (proc: ChildProcess): boolean =>
  proc.exitCode !== null || proc.signalCode !== null

const logs = new WeakMap<ElectronApplication, MainLog>()

/** Launch the built app with `env` and capture its log. */
export async function launchApp(
  env: NodeJS.ProcessEnv
): Promise<{ app: ElectronApplication; log: MainLog }> {
  const defined: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) defined[k] = v
  const app = await electron.launch({ args: [BUILT_MAIN], env: defined })
  const log = captureLog(app.process())
  logs.set(app, log)
  return { app, log }
}

/** SIGKILL a process group and wait for its leader to close (no-op when already gone). */
export async function killGroup(proc: ChildProcess): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    if (hasExited(proc)) resolve()
    else proc.once('close', () => resolve())
  })
  try {
    process.kill(-proc.pid!, 'SIGKILL')
  } catch {
    /* the process group may already be gone */
  }
  await closed
}

/** The app's own window: the one that loaded the renderer. From Electron 44 `firstWindow()`
 *  resolves while the window is still on its empty initial document, before `loadFile`
 *  navigates it; an evaluate there dies with "Execution context was destroyed". */
async function rendererPage(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForURL(/\/renderer\/index\.html$/, { timeout: 15000 })
  return page
}

/** On a failed test, keep what explains it: the trace, main's log and a screenshot. An app that
 *  already exited (the quit spec quits it) has no trace or window left to keep. */
async function keepFailureArtifacts(
  app: ElectronApplication,
  log: MainLog,
  testInfo: TestInfo
): Promise<void> {
  const failed = testInfo.status !== testInfo.expectedStatus
  if (failed) await testInfo.attach('main.log', { body: log.text(), contentType: 'text/plain' })
  if (hasExited(app.process())) return
  const context = app.context()
  if (!failed) {
    await context.tracing.stop()
    return
  }
  await context.tracing.stop({ path: testInfo.outputPath('trace.zip') })
  const page = app.windows().find((w) => w.url().endsWith('/renderer/index.html'))
  if (page !== undefined) {
    const shot = await page.screenshot().catch(() => null)
    if (shot !== null) await testInfo.attach('screenshot', { body: shot, contentType: 'image/png' })
  }
}

/** `+ New session` → `Pick a folder…` (returns `pickDir`) → accept the name prompt's prefill.
 *  Nothing spawns until the name prompt is confirmed. */
async function launchSession(page: Page): Promise<void> {
  await page.locator('[data-testid="header-new-session"]').click({ timeout: 20000 })
  await page.locator('[data-testid="menu-pick-folder"]').click()
  await confirmSessionName(page)
}

/** Confirm the create-time name prompt (accepts the prefill, the cwd basename). Also needed
 *  after the dead pane's `New session → Pick a folder…`. */
export async function confirmSessionName(page: Page): Promise<void> {
  const confirm = page.locator('[data-testid="session-name-confirm"]')
  await confirm.waitFor({ state: 'visible', timeout: 20000 })
  await confirm.click()
}

export const test = base.extend<{
  appEnv: AppEnv
  app: ElectronApplication
  page: Page
  mainLog: MainLog
  launchSession: (page: Page) => Promise<void>
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured fixtures arg
  appEnv: async ({}, provide) => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'cw-e2e-data-'))
    const pickDir = mkdtempSync(path.join(tmpdir(), 'cw-e2e-pick-'))
    writeFileSync(path.join(dataDir, SETTINGS_FILE), JSON.stringify(MUTED_SETTINGS, null, '\t'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_WATCHER_PROFILE: 'e2e',
      [E2E_DATA_DIR_ENV]: dataDir,
      C9_TEST_PICK_DIR: pickDir
    }
    try {
      await provide({ env, dataDir, pickDir })
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(pickDir, { recursive: true, force: true })
    }
  },

  app: async ({ appEnv }, provide, testInfo) => {
    const { app, log } = await launchApp(appEnv.env)
    const proc = app.process()
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true })
      await provide(app)
    } finally {
      try {
        await keepFailureArtifacts(app, log, testInfo)
      } finally {
        if (proc.pid !== undefined) killLaunchedClaudes(proc.pid)
        await killGroup(proc)
      }
    }
  },

  page: async ({ app }, provide) => {
    await provide(await rendererPage(app))
  },

  mainLog: async ({ app }, provide) => {
    const log = logs.get(app)
    if (log === undefined) throw new Error('e2e: no log captured for this app')
    await provide(log)
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured fixtures arg
  launchSession: async ({}, provide) => {
    await provide(launchSession)
  }
})
