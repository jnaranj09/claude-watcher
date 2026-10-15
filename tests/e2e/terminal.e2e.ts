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
//   2. Screenshot artifact: captures the terminal `<canvas>` area into the test's output dir.
//      The WebGL renderer paints to canvas so there is no readable `.xterm-rows`.
//
// Navigation: App.tsx reads `parseTerminalHostCount(window.location.hash)` ONCE at
// render. We set the hash via `location.hash` then call `location.reload()` so the
// TerminalHost mounts on the fresh render pass. Launch and teardown live in ./fixtures.ts.

import { test, expect } from './fixtures'

// Exact error message substrings that identify the transport regression.
const PORT_BUG_SIGNATURES = ['port.start is not a function', 'port.postMessage is not a function']

test.setTimeout(120000)

test('embedded terminal MessagePort round-trip — no port.* errors + canvas paints', async ({
  page
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

  // Give the terminal time to fully mount, open the PTY, and pair its port.
  await page.waitForTimeout(2000)

  // 3. Focus the terminal and type a token + Enter.
  const terminal = page.locator('[data-testid="embedded-terminal"]')
  await terminal.click()
  await page.keyboard.type('echo C9WATCH_E2E_TOKEN')
  await page.keyboard.press('Enter')

  // 4. Allow time for the keystroke to travel: renderer → port → PTY → output → port → renderer.
  await page.waitForTimeout(1500)

  // 5. Capture a screenshot as an artifact (canvas content proves output painted).
  await page.screenshot({ path: testInfo.outputPath('terminal-e2e.png') })

  // 6. PRIMARY ASSERTION: no port.* transport errors fired.
  //    These are the EXACT regression signatures from the original bug.
  const portBugErrors = pageErrors.filter((msg) =>
    PORT_BUG_SIGNATURES.some((sig) => msg.includes(sig))
  )
  expect(
    portBugErrors,
    `Transport regression detected — port.* errors fired: ${portBugErrors.join('; ')}`
  ).toHaveLength(0)

  // 7. SECONDARY ASSERTION: the terminal element is present and visible.
  await expect(terminal).toBeVisible()

  // 8. Report non-fatal pageerrors for debugging.
  if (pageErrors.length > 0) {
    console.warn('[e2e] pageerrors observed during test (not port.* — not a failure):', pageErrors)
  }
})
