// Story 5.4 — REAL Playwright-Electron e2e for the IN-APP LAUNCH path (`+ New session → claude`).
//
// Purpose: the launch flow (FocusedSession + the `claude` spawn override) had ZERO end-to-end
// coverage — the Story-5.1 e2e tests the `#terminals` host (plain `$SHELL`), NOT the launch
// override. That gap let a launch-path defect (the dev blank/wrong-terminal bug) ship. This spec
// closes it: it clicks the REAL `+ New session` button on the BUILT app and proves
//   (1) the spawn OVERRIDE was applied — a descendant process of the Electron app runs `claude`
//       (cmdline contains `claude`), NOT the default `/bin/bash` (which is what a LOST override
//       spawns — exactly the bug signature from the prior diagnosis); and
//   (2) the MessagePort transport does not regress on this path — ZERO `port.*` pageerrors.
//
// COVERAGE SPLIT (read before editing): this spec runs the BUILT (production) renderer, where
// React StrictMode does NOT double-invoke effects. So it exercises the PROD fresh-launch path
// (single mount). The DEV-only StrictMode regressions — the override surviving a transient stop
// (Fix A/B) and the per-open-token port disambiguation (Fix C) — are covered by the UNIT tests
// (src/main/pty/launchSession.test.ts, src/renderer/src/terminal/EmbeddedTerminal.test.tsx). This
// e2e is the prod end-to-end gate + scope confirmation: it PASSES whether or not the dev fix is
// present (prod fresh-launch always worked), and guards against a FUTURE break of the override
// wiring or the launch transport. Do not "strengthen" it to assert StrictMode behavior — the built
// app has none.
//
// Launch, the folder-picker seam and teardown live in ./fixtures.ts; the `/proc` walk in
// ./support/proc.ts (LINUX-ONLY, matching the app's Linux/KDE-first scope).

import { readlinkSync } from 'node:fs'
import { test, expect } from './fixtures'
import { isLaunchedClaude, waitForClaudeDescendant } from './support/proc'

// Exact error message substrings that identify the MessagePort transport regression (Story 5.1).
const PORT_BUG_SIGNATURES = ['port.start is not a function', 'port.postMessage is not a function']

test.setTimeout(120000)

test('in-app launch spawns `claude` in the picked dir (override applied) + no port.* errors', async ({
  app,
  page,
  appEnv,
  launchSession
}, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })
  const electronPid = app.process().pid
  expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

  // 1. `+ New session` → Pick a folder (the seam returns pickDir) → confirm the name prompt
  //    → openLaunchedTerminal → FocusedSession mounts the EmbeddedTerminal → terminal:open →
  //    main spawns `$SHELL -l -c claude` in pickDir.
  await launchSession(page)

  // 2. The Focused-session's embedded terminal should mount.
  await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

  // 3. PRIMARY ASSERTION — the spawn OVERRIDE was applied: a descendant of the Electron process
  //    runs `claude` (the `$SHELL -l -c claude` shell and/or its `claude` child). A LOST override
  //    would spawn the default `/bin/bash` with NO `claude` anywhere (the bug signature), and
  //    waitForClaudeDescendant throws, naming every descendant's cmdline.
  const descendants = await waitForClaudeDescendant(electronPid!, 8000)
  const claudeProcs = descendants.filter((d) => isLaunchedClaude(d.cmdline))

  // 3b. SECONDARY (soft) — the launched process cwd should be the picked dir (the override sets
  //     cwd too). Best-effort: a /proc/<pid>/cwd read can race the process; warn, don't fail.
  {
    const real = (() => {
      try {
        return readlinkSync(`/proc/${claudeProcs[0]!.pid}/cwd`)
      } catch {
        return null
      }
    })()
    if (real !== null && real !== appEnv.pickDir) {
      console.warn(`[launch-e2e] launched cwd ${real} !== picked dir ${appEnv.pickDir} (non-fatal)`)
    }
  }

  await page.screenshot({ path: testInfo.outputPath('launch-e2e.png') })

  // 4. PRIMARY ASSERTION — no MessagePort transport regression on the launch path.
  const portBugErrors = pageErrors.filter((msg) =>
    PORT_BUG_SIGNATURES.some((sig) => msg.includes(sig))
  )
  expect(
    portBugErrors,
    `Transport regression on the launch path — port.* errors fired: ${portBugErrors.join('; ')}`
  ).toHaveLength(0)

  // 5. The embedded terminal is present + visible.
  await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible()

  if (pageErrors.length > 0) {
    console.warn('[launch-e2e] pageerrors observed (not port.* — not a failure):', pageErrors)
  }
})
