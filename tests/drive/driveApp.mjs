// Drive the BUILT app from a script and look at it — the way to SEE a change in the real app
// (real pixels on a real window), not a test gate. Read .claude/rules/run-app.md first.
//
// Same seams as tests/e2e/native-engine.e2e.ts: Playwright's `_electron` launches
// out/main/index.js, C9_TEST_PICK_DIR stands in for the KDE folder picker, a REAL `claude` is
// spawned per session, and REAL hook POSTs to 127.0.0.1:29279 move the cards between columns.
// The app runs on the DRIVE profile (`CLAUDE_WATCHER_PROFILE=drive`, src/main/profile.ts): its own
// ports and data dir, so it runs beside the installed app and `npm run dev`.
//
//   import * as d from './tests/drive/driveApp.mjs'
//   await d.run(async ({ page, pickDir }) => {
//     const id = await d.launchSession(page)
//     await d.needsYou(pickDir, id)
//     await d.shot(page, 'needs-you', { region: 'header' })
//   })
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { startHeadlessDisplay } from '../headless/headlessDisplay.mjs'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
export const SHOT_DIR = path.join(ROOT, 'test-results/drive')
const HOOK_HOST = '127.0.0.1'
const HOOK_PORT = 29279 // DRIVE_PROFILE.hookPort in src/main/profile.ts

// The drive profile's settings file (DRIVE_PROFILE.userDataDirName in src/main/profile.ts; the
// electron-store blob of src/main/persistence/electronSettingsBlobStore.ts).
const DRIVE_SETTINGS = path.join(
  process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'),
  'claude-watcher-drive',
  'c9watch-settings.json'
)

/** Turn the drive app's desktop popups and sound off before it starts. Its sessions are real
 *  claudes whose turns end, and every "your turn" otherwise reached the operator's desktop as an
 *  "Electron" notification. A missing file gets the smallest valid v1 blob (the rest defaults);
 *  an unreadable one is left alone (the app resets it and alerts stay on for that run). */
function muteDriveAlerts() {
  let blob = { settings: { version: 1, terminalFontSize: 14 } }
  try {
    blob = JSON.parse(readFileSync(DRIVE_SETTINGS, 'utf8'))
  } catch (err) {
    if (err?.code !== 'ENOENT') return
  }
  if (typeof blob?.settings !== 'object' || blob.settings === null) return
  blob.settings.notificationsEnabled = false
  blob.settings.soundEnabled = false
  mkdirSync(path.dirname(DRIVE_SETTINGS), { recursive: true })
  writeFileSync(DRIVE_SETTINGS, JSON.stringify(blob, null, '\t'))
}

// ── hook port + hook POSTs ──────────────────────────────────────────────────────────────────

/** True when something already listens on the hook port (another drive run). */
export function portInUse() {
  return new Promise((resolve) => {
    const socket = net.connect({ port: HOOK_PORT, host: HOOK_HOST })
    const done = (result) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

/** POST one hook body exactly the way Claude Code does. Resolves with the HTTP status
 *  (200 = accepted past the Zod boundary, 400 = dropped). */
export function postHook(body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      {
        host: HOOK_HOST,
        port: HOOK_PORT,
        method: 'POST',
        path: '/',
        headers: { 'content-type': 'application/json', 'content-length': payload.length }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** A hook for one launched session — fills the fields every real hook body carries. */
export function hook(pickDir, sessionId, body) {
  return postHook({
    session_id: sessionId,
    transcript_path: path.join(pickDir, `${sessionId}.jsonl`),
    cwd: pickDir,
    ...body
  })
}

/** `Stop` → the needs-you column (a turn end is the operator's move, never idle). */
export const needsYou = (pickDir, sessionId) =>
  hook(pickDir, sessionId, {
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done.'
  })

/** `UserPromptSubmit` → the working column. */
export const working = (pickDir, sessionId) =>
  hook(pickDir, sessionId, { hook_event_name: 'UserPromptSubmit' })

// ── launch + teardown ───────────────────────────────────────────────────────────────────────

function ppidOf(pid) {
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s+(\d+)/m)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

function cmdlineOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

function descendants(rootPid) {
  const children = new Map()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const parent = ppidOf(Number(name))
    if (parent === null) continue
    children.set(parent, [...(children.get(parent) ?? []), Number(name)])
  }
  const out = []
  const stack = [...(children.get(rootPid) ?? [])]
  while (stack.length > 0) {
    const pid = stack.pop()
    out.push({ pid, cmdline: cmdlineOf(pid) })
    stack.push(...(children.get(pid) ?? []))
  }
  return out
}

/** The launched `claude`, not one of Electron's own helpers — those all carry the checkout path,
 *  and the checkout path itself contains "claude". */
const isLaunchedClaude = (cmdline) =>
  cmdline !== '' && !cmdline.includes(ROOT) && cmdline.includes('claude')

/**
 * Launch the built app. Throws when the hook port is taken: the app tolerates EADDRINUSE
 * silently, so it would bind nothing and every hook POST would land on the OTHER instance.
 * For pixel checks, crop and upscale a 1× shot (see .claude/rules/run-app.md) — a CDP
 * `deviceScaleFactor` override does NOT reach Playwright's Electron screenshots.
 */
export async function launchApp({ args = [] } = {}) {
  if (await portInUse()) {
    throw new Error(
      `${HOOK_HOST}:${HOOK_PORT} is taken — another drive run is still going (the drive profile's port)`
    )
  }
  muteDriveAlerts()
  const pickDir = mkdtempSync(path.join(tmpdir(), 'cw-drive-'))
  // A hidden display: the drive window never takes the operator's focus (CW_HEADED=1 to watch).
  const display = await startHeadlessDisplay()
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js'), ...args],
    env: display.env({ ...process.env, C9_TEST_PICK_DIR: pickDir, CLAUDE_WATCHER_PROFILE: 'drive' })
  })
  const pid = app.process().pid
  const page = await app.firstWindow()
  await page
    .locator('[data-testid="header-new-session"]')
    .waitFor({ state: 'visible', timeout: 20000 })

  /** SIGKILL the launched claudes, then the whole Electron process group. `app.close()` is
   *  NOT used: the minimize-to-taskbar guard makes it hang ~120 s. */
  async function teardown() {
    for (const d of descendants(pid)) {
      if (!isLaunchedClaude(d.cmdline)) continue
      try {
        process.kill(d.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    const closed = new Promise((resolve) => app.process().once('close', resolve))
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* group already gone */
    }
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))])
    display.stop()
  }

  return { app, page, pickDir, teardown }
}

/** Launch, run `scenario`, and ALWAYS tear down. On a failure: an `error.png` shot, the error
 *  on stderr, exit code 1. `args` are extra Electron switches (`--force-device-scale-factor=2`). */
export async function run(scenario, { args = [] } = {}) {
  const ctx = await launchApp({ args })
  let failed = false
  try {
    await scenario(ctx)
  } catch (e) {
    failed = true
    console.error('[drive] FAILED:', e instanceof Error ? e.message : e)
    await shot(ctx.page, 'error').catch(() => {})
  } finally {
    await ctx.teardown()
  }
  process.exit(failed ? 1 : 0)
}

// ── sessions ────────────────────────────────────────────────────────────────────────────────

/** The session ids of the cards the board shows (the ACTIVE workspace only). */
export const cardIds = (page) =>
  page
    .locator('[data-column] [data-session-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-session-id')))

/** `+ New session` → `Pick a folder…` → accept the name → back to the board. Returns the new
 *  card's session id. Waits 3 s at the end so claude's own startup hooks land before yours. */
export async function launchSession(page) {
  const before = new Set(await cardIds(page))
  await page.locator('[data-testid="header-new-session"]').click()
  await page.locator('[data-testid="menu-pick-folder"]').click()
  const confirm = page.locator('[data-testid="session-name-confirm"]')
  await confirm.waitFor({ state: 'visible', timeout: 20000 })
  await confirm.click()
  // Kept-alive terminals stay in the DOM, hidden — wait for a VISIBLE one, not the first match.
  await page
    .locator('[data-testid="embedded-terminal"] >> visible=true')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
  let id
  for (let i = 0; i < 40 && id === undefined; i++) {
    id = (await cardIds(page)).find((x) => !before.has(x))
    if (id === undefined) await page.waitForTimeout(250)
  }
  if (id === undefined) throw new Error('the launch produced no board card')
  await page.locator('[data-testid="focused-back"]').click()
  await page.waitForTimeout(3000)
  return id
}

// ── workspaces ──────────────────────────────────────────────────────────────────────────────

const switcher = (page) => page.locator('[data-testid="workspace-switcher"]')
// A menu still fading out (Popover exit motion) carries `data-leaving`: it is not the open menu.
// Matching it made openSwitcher skip its click right after a switch, and the next row never
// showed (a second switchWorkspace timed out).
const menu = (page) => page.locator('[role="menu"]:not([data-leaving])')

// Toggle with the button: Escape pressed while focus sits on the trigger never reaches the
// menu's own key handler, so it does not close it.
export async function openSwitcher(page) {
  if (!(await menu(page).isVisible())) await switcher(page).click()
  await menu(page).waitFor({ state: 'visible', timeout: 5000 })
}

export async function closeSwitcher(page) {
  if (await menu(page).isVisible()) await switcher(page).click()
  await menu(page).waitFor({ state: 'hidden', timeout: 5000 })
}

/** The active workspace's name (the switcher's aria-label starts with it). */
export async function activeWorkspace(page) {
  return ((await switcher(page).getAttribute('aria-label')) ?? '').split(',')[0]
}

/** Every workspace name, the active one first (the menu lists only the OTHER ones). */
export async function workspaceNames(page) {
  const active = await activeWorkspace(page)
  await openSwitcher(page)
  const others = await menu(page)
    .locator('[role="menuitem"][aria-label]')
    .evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').split(',')[0]))
  await closeSwitcher(page)
  return [active, ...others]
}

export async function switchWorkspace(page, name) {
  if ((await activeWorkspace(page)) === name) return // the menu does not list the active one
  await openSwitcher(page)
  await menu(page).locator(`[role="menuitem"][aria-label^="${name},"]`).click()
  await page.waitForFunction(
    (n) =>
      (
        document.querySelector('[data-testid="workspace-switcher"]')?.getAttribute('aria-label') ??
        ''
      ).startsWith(`${n},`),
    name,
    { timeout: 5000 }
  )
}

async function openManageWorkspaces(page) {
  await openSwitcher(page)
  await page.locator('[data-testid="workspace-manage"]').click()
  await page.locator('[data-testid="workspaces-overlay"]').waitFor({ state: 'visible' })
}

async function closeManageWorkspaces(page) {
  await page.locator('[data-testid="workspaces-close"]').click()
  await page.locator('[data-testid="workspaces-overlay"]').waitFor({ state: 'hidden' })
}

export async function createWorkspace(page, name, color = 'blue') {
  await openManageWorkspaces(page)
  await page.locator('[data-testid="workspace-new"]').click()
  await page.locator('[data-testid="workspace-name-input"]').fill(name)
  await page.locator(`[data-testid="workspace-color-${color}"]`).check({ force: true })
  await page.locator('[data-testid="workspace-submit"]').click()
  await page
    .locator('[data-testid^="workspace-select-"]', { hasText: name })
    .waitFor({ state: 'visible', timeout: 5000 })
  await closeManageWorkspaces(page)
}

/** Delete a workspace through the dialog (Delete → Confirm delete). Throws with the dialog's own
 *  error line when main refuses. */
export async function deleteWorkspace(page, name) {
  await openManageWorkspaces(page)
  const row = page.locator('[data-testid^="workspace-select-"]', { hasText: name })
  const id = ((await row.getAttribute('data-testid')) ?? '').replace('workspace-select-', '')
  await row.click()
  await page.locator(`[data-testid="workspace-delete-${id}"]`).click()
  await page.locator('[data-testid="workspace-delete-confirm"]').click()
  try {
    await row.waitFor({ state: 'detached', timeout: 5000 })
  } catch {
    const error = page.locator('[data-testid="workspace-error"]')
    const why = (await error.count()) > 0 ? await error.innerText() : 'no error line shown'
    throw new Error(`deleting workspace "${name}" did not complete: ${why}`)
  }
  await closeManageWorkspaces(page)
}

// ── screenshots ─────────────────────────────────────────────────────────────────────────────

/** Screenshot to test-results/drive/<name>.png (git-ignored). `region: 'header'` clips to the
 *  header plus an open menu below it; the default is the whole window. */
export async function shot(page, name, { region } = {}) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const file = path.join(SHOT_DIR, `${name}.png`)
  if (region === 'header') {
    await page.waitForTimeout(400) // let entry animations finish (the switcher tab slides 150 ms)
    const header = await page.locator('[data-testid="app-header"]').boundingBox()
    // Count first: `boundingBox()` on a missing element WAITS for it (30 s by default).
    const open = page.locator('[role="menu"]')
    const below = (await open.count()) > 0 ? await open.first().boundingBox() : null
    const width = await page.evaluate(() => window.innerWidth)
    const bottom = Math.max(header.y + header.height, below ? below.y + below.height : 0) + 8
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height: bottom } })
  } else {
    await page.screenshot({ path: file })
  }
  console.log('[drive] shot', path.relative(ROOT, file))
  return file
}
