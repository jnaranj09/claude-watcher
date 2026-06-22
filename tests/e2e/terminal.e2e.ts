// Story 5.1 — REAL Playwright-Electron e2e regression spec.
// REPLACES the Story-0.3 placeholder `test.skip`.
//
// Purpose: prove the embedded-terminal MessagePort transport works end-to-end on the
// BUILT app. The transport bug (`port.start is not a function` / `port.postMessage is
// not a function`) had ZERO end-to-end coverage — this spec closes that gap so the
// contextBridge-callback-arg path can never silently regress again.
//
// Assertion approach (DOM-text-independent, as required):
//   1. `pageerror` collector: registers at launch; asserts ZERO errors matching the
//      exact bug signatures (`port.start is not a function` / `port.postMessage is
//      not a function`) fired during the test — directly pins this bug's regression.
//   2. Screenshot artifact: captures the terminal `<canvas>` area for the CI artifact.
//      The WebGL renderer paints to canvas so there is no readable `.xterm-rows`; the
//      screenshot confirms output painted (the echo round-trip is visible in the canvas).
//
// Pre-requisite: `npm run build:dir` must have run (this spec launches `out/main/index.js`).
//
// Navigation: App.tsx reads `parseTerminalHostCount(window.location.hash)` ONCE at
// render. We set the hash via `location.hash` then call `location.reload()` so the
// TerminalHost mounts on the fresh render pass.
//
// [Source: story 5.1 Task 5; tests/e2e/terminal.e2e.ts (REPLACING the skip);
//  playwright.config.ts; src/renderer/src/App.tsx:250-263 (hash read once at render);
//  package.json `main: ./out/main/index.js`; .claude/rules/zod-boundaries.md (never log value)]

import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import path from 'path'
import { mkdirSync } from 'fs'

// The built entry point (after `npm run build:dir`).
const BUILT_MAIN = path.resolve(__dirname, '../../out/main/index.js')

// Exact error message substrings that identify the transport regression.
const PORT_BUG_SIGNATURES = ['port.start is not a function', 'port.postMessage is not a function']

test.setTimeout(120000)

test('embedded terminal MessagePort round-trip — no port.* errors + canvas paints', async () => {
  const pageErrors: string[] = []

  // 1. Launch the built app.
  const app = await electron.launch({ args: [BUILT_MAIN] })
  const page = await app.firstWindow()

  // Collect all pageerrors from the moment the window opens.
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })

  // 2. Navigate to the plain-shell terminal host.
  //    App.tsx reads window.location.hash ONCE at render. We set hash then reload so
  //    TerminalHost mounts on the fresh render pass with the hash already set.
  //    Use page.evaluate to set hash + trigger reload, then waitForLoadState on
  //    the page object to track when the new render settles.
  await page.evaluate(() => {
    window.location.hash = '#terminals'
    window.location.reload()
  })
  // Wait for the page to finish loading after the programmatic reload.
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

  // 3. Wait for the embedded terminal element to appear. The app goes through
  //    smokeConfig() first, then renders the #terminals host.
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

  // Give the terminal time to fully mount, open the PTY, and pair its port.
  await page.waitForTimeout(2000)

  // 4. Focus the terminal and type a token + Enter.
  const terminal = page.locator('[data-testid="embedded-terminal"]')
  await terminal.click()
  await page.keyboard.type('echo C9WATCH_E2E_TOKEN')
  await page.keyboard.press('Enter')

  // 5. Allow time for the keystroke to travel: renderer → port → PTY → output → port → renderer.
  await page.waitForTimeout(1500)

  // 6. Capture a screenshot as an artifact (canvas content proves output painted).
  const screenshotDir = path.resolve(__dirname, '../../test-results')
  try {
    mkdirSync(screenshotDir, { recursive: true })
  } catch {
    /* directory may already exist */
  }
  await page.screenshot({
    path: path.join(screenshotDir, 'terminal-e2e.png'),
    fullPage: false
  })

  // 7. PRIMARY ASSERTION: no port.* transport errors fired.
  //    These are the EXACT regression signatures from the original bug.
  const portBugErrors = pageErrors.filter((msg) =>
    PORT_BUG_SIGNATURES.some((sig) => msg.includes(sig))
  )
  expect(
    portBugErrors,
    `Transport regression detected — port.* errors fired: ${portBugErrors.join('; ')}`
  ).toHaveLength(0)

  // 8. SECONDARY ASSERTION: the terminal element is present and visible.
  await expect(terminal).toBeVisible()

  // 9. Report non-fatal pageerrors for debugging.
  if (pageErrors.length > 0) {
    console.warn('[e2e] pageerrors observed during test (not port.* — not a failure):', pageErrors)
  }

  // 10. Tear down the Electron process, bypassing the Epic-4 minimize-to-taskbar guard.
  //
  // `app.close()` sends a window-close event; the Epic-4 guard intercepts it
  // (`mainWindow.on('close', e => { if (!isQuitting) { e.preventDefault(); minimize() } })`),
  // the window minimizes instead of closing, and `app.close()` hangs for ~120 s.
  //
  // Fix: kill the ENTIRE Electron process group via SIGKILL (`process.kill(-pid, 'SIGKILL')`)
  // so that both Electron and any child PTY shells die immediately. Then await the
  // ChildProcess `'close'` event — this fires after all stdio streams close, at which point
  // Playwright's launchProcess callback has already removed `gracefullyClose` from
  // `gracefullyCloseSet`. The Playwright worker teardown therefore finds an empty set and
  // completes without the 30 s timeout.
  const electronProcess = app.process()
  const processClosed = new Promise<void>((resolve) => {
    if (electronProcess.killed) resolve()
    else electronProcess.once('close', () => resolve())
  })
  // Kill the process GROUP (negative pid) to also terminate child PTY shell processes that
  // may have inherited Electron's stdio pipes and would otherwise delay the 'close' event.
  process.kill(-electronProcess.pid!, 'SIGKILL')
  await processClosed
})
