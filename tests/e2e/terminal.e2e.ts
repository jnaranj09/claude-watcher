// Story 5.1 — REAL Playwright-Electron e2e regression spec.
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
//   2. Round trip: a typed `echo <token> > <pickDir>/probe` must produce that file. The WebGL
//      renderer paints to canvas so there is no readable `.xterm-rows`; the file is what the
//      shell did with the keys. A screenshot is kept in the test's output dir.
//
// Navigation: App.tsx reads `parseTerminalHostCount(window.location.hash)` ONCE at
// render. We set the hash via `location.hash` then call `location.reload()` so the
// TerminalHost mounts on the fresh render pass. Launch and teardown live in ./fixtures.ts.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './fixtures'

// Exact error message substrings that identify the transport regression.
const PORT_BUG_SIGNATURES = ['port.start is not a function', 'port.postMessage is not a function']

const PROBE_TOKEN = 'cw-e2e-probe'

test.setTimeout(120000)

test('embedded terminal MessagePort round-trip — a typed command reaches the shell + no port.* errors', async ({
  page,
  appEnv
}, testInfo) => {
  const pageErrors: string[] = []

  // Collect all pageerrors from the moment the window opens.
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })

  // 1. Navigate to the plain-shell terminal host.
  //    App.tsx reads window.location.hash ONCE at render. We set hash then reload so
  //    TerminalHost mounts on the fresh render pass with the hash already set.
  await page.evaluate(() => {
    window.location.hash = '#terminals'
    window.location.reload()
  })
  // Wait for the page to finish loading after the programmatic reload.
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

  // 2. Wait for the embedded terminal element to appear. The app goes through
  //    smokeConfig() first, then renders the #terminals host.
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

  // 3. THE ROUND TRIP: type a command that writes a file, and wait for the file. That proves
  //    renderer → MessagePort → PTY → shell without reading the WebGL canvas. Typed once: keys
  //    typed before the terminal pairs its port are queued and sent when it pairs.
  const terminal = page.locator('[data-testid="embedded-terminal"]')
  const probe = join(appEnv.pickDir, 'probe')
  await terminal.click()
  await page.keyboard.type(`echo ${PROBE_TOKEN} > ${probe}`)
  await page.keyboard.press('Enter')
  await expect
    .poll(() => (existsSync(probe) ? readFileSync(probe, 'utf8') : null), { timeout: 10_000 })
    .toBe(`${PROBE_TOKEN}\n`)

  // 4. Capture a screenshot as an artifact.
  await page.screenshot({ path: testInfo.outputPath('terminal-e2e.png') })

  // 5. No port.* transport errors fired.
  //    These are the EXACT regression signatures from the original bug.
  const portBugErrors = pageErrors.filter((msg) =>
    PORT_BUG_SIGNATURES.some((sig) => msg.includes(sig))
  )
  expect(
    portBugErrors,
    `Transport regression detected — port.* errors fired: ${portBugErrors.join('; ')}`
  ).toHaveLength(0)

  // 6. The terminal element is present and visible.
  await expect(terminal).toBeVisible()

  // 7. Report non-fatal pageerrors for debugging.
  if (pageErrors.length > 0) {
    console.warn('[e2e] pageerrors observed during test (not port.* — not a failure):', pageErrors)
  }
})
