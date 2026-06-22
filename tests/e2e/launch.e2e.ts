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
// The native KDE directory picker cannot be driven by Playwright, so main exposes a TEST-ONLY
// env seam (C9_TEST_PICK_DIR, mirrors C9_SMOKE): set it and `session:pick-directory` returns that
// path without opening the dialog. We set it to a fresh temp dir so the launch spawns `claude`
// there.
//
// LINUX-ONLY: the override check walks `/proc` (Linux), matching the app's Linux/KDE-first scope
// and the Story-5.1 spec's Linux process-group teardown.
//
// Pre-requisite: `npm run build:dir` (or `npm run build`) must have produced `out/main/index.js`.
// [Source: story 5.4; tests/e2e/terminal.e2e.ts (launch + teardown pattern);
//  src/main/index.ts (session:pick-directory C9_TEST_PICK_DIR seam, rawClaudeSpawn `-l -c claude`)]

import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import path from 'path'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync } from 'fs'
import { tmpdir } from 'os'

// The built entry point (after `npm run build:dir` / `npm run build`).
const BUILT_MAIN = path.resolve(__dirname, '../../out/main/index.js')

// Exact error message substrings that identify the MessagePort transport regression (Story 5.1).
const PORT_BUG_SIGNATURES = ['port.start is not a function', 'port.postMessage is not a function']

test.setTimeout(120000)

/** Read a process's PPid from /proc/<pid>/status (robust to a comm with spaces/parens). */
function ppidOf(pid: number): number | null {
  try {
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s+(\d+)/m)
    return m ? Number(m[1]) : null
  } catch {
    return null // the process may have exited between listing and reading — skip it
  }
}

/** Read a process's cmdline (NUL-separated → space-joined). Empty on a gone/denied process. */
function cmdlineOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

/** All processes that descend (transitively) from rootPid, with their cmdlines. */
function descendantCmdlines(rootPid: number): { pid: number; cmdline: string }[] {
  const pids = readdirSync('/proc')
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
  const children = new Map<number, number[]>()
  for (const pid of pids) {
    const pp = ppidOf(pid)
    if (pp === null) continue
    const arr = children.get(pp) ?? []
    arr.push(pid)
    children.set(pp, arr)
  }
  const out: { pid: number; cmdline: string }[] = []
  const stack = [...(children.get(rootPid) ?? [])]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const pid = stack.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    out.push({ pid, cmdline: cmdlineOf(pid) })
    stack.push(...(children.get(pid) ?? []))
  }
  return out
}

/** Poll for a descendant of rootPid whose cmdline contains `claude`. The spawn is async (click →
 *  launch → openLaunchedTerminal → EmbeddedTerminal mount → terminal:open → main spawns), so we
 *  poll rather than check once. Returns the full descendant list (for the assertion + diagnostics). */
async function waitForClaudeDescendant(
  rootPid: number,
  timeoutMs: number
): Promise<{ pid: number; cmdline: string }[]> {
  const deadline = Date.now() + timeoutMs
  let last: { pid: number; cmdline: string }[] = []
  while (Date.now() < deadline) {
    last = descendantCmdlines(rootPid)
    if (last.some((d) => d.cmdline.includes('claude'))) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  return last
}

test('in-app launch spawns `claude` in the picked dir (override applied) + no port.* errors', async () => {
  const pageErrors: string[] = []

  // A fresh temp dir the launch will cwd into (the test seam returns it from the picker).
  const launchDir = mkdtempSync(path.join(tmpdir(), 'c9-launch-e2e-'))

  // 1. Launch the BUILT app with the test-only picker seam pointed at our temp dir. Spread
  //    process.env so PATH (→ `claude` resolves) and DISPLAY (→ the window opens) are preserved.
  const app = await electron.launch({
    args: [BUILT_MAIN],
    env: { ...process.env, C9_TEST_PICK_DIR: launchDir }
  })
  const electronPid = app.process().pid
  expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

  const page = await app.firstWindow()
  page.on('pageerror', (err) => {
    pageErrors.push(err.message)
  })

  try {
    // 2. The app resolves smokeConfig() then renders the board with the `+ New session` header
    //    button (smoke is off → board view). Wait for it.
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 })
    const newSessionBtn = page.locator('[data-testid="header-new-session"]')
    await newSessionBtn.waitFor({ state: 'visible', timeout: 20000 })

    // 3. Click `+ New session`. With C9_TEST_PICK_DIR set, the picker returns launchDir without a
    //    native dialog → launch(launchDir) → openLaunchedTerminal → FocusedSession mounts the
    //    EmbeddedTerminal → terminal:open → main spawns `$SHELL -l -c claude` in launchDir.
    await newSessionBtn.click()

    // 4. The Focused-session's embedded terminal should mount.
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

    // 5. PRIMARY ASSERTION — the spawn OVERRIDE was applied: a descendant of the Electron process
    //    runs `claude` (the `$SHELL -l -c claude` shell and/or its `claude` child). A LOST override
    //    would spawn the default `/bin/bash` with NO `claude` anywhere (the bug signature).
    const descendants = await waitForClaudeDescendant(electronPid!, 8000)
    const claudeProcs = descendants.filter((d) => d.cmdline.includes('claude'))
    expect(
      claudeProcs.length,
      `No \`claude\` descendant of the Electron app — the launch spawn override was NOT applied ` +
        `(a lost override spawns the default shell). Descendant cmdlines:\n` +
        descendants.map((d) => `  ${d.pid}: ${d.cmdline || '(empty)'}`).join('\n')
    ).toBeGreaterThan(0)

    // 5b. SECONDARY (soft) — the launched process cwd should be the picked dir (the override sets
    //     cwd too). Best-effort: a /proc/<pid>/cwd read can race the process; warn, don't fail.
    {
      const real = (() => {
        try {
          return readlinkSync(`/proc/${claudeProcs[0]!.pid}/cwd`)
        } catch {
          return null
        }
      })()
      if (real !== null && real !== launchDir) {
        console.warn(`[launch-e2e] launched cwd ${real} !== picked dir ${launchDir} (non-fatal)`)
      }
    }

    // 6. Let bytes flow a moment, then capture a screenshot artifact.
    await page.waitForTimeout(1500)
    const screenshotDir = path.resolve(__dirname, '../../test-results')
    try {
      mkdirSync(screenshotDir, { recursive: true })
    } catch {
      /* directory may already exist */
    }
    await page.screenshot({ path: path.join(screenshotDir, 'launch-e2e.png'), fullPage: false })

    // 7. PRIMARY ASSERTION — no MessagePort transport regression on the launch path.
    const portBugErrors = pageErrors.filter((msg) =>
      PORT_BUG_SIGNATURES.some((sig) => msg.includes(sig))
    )
    expect(
      portBugErrors,
      `Transport regression on the launch path — port.* errors fired: ${portBugErrors.join('; ')}`
    ).toHaveLength(0)

    // 8. The embedded terminal is present + visible.
    await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible()

    if (pageErrors.length > 0) {
      console.warn('[launch-e2e] pageerrors observed (not port.* — not a failure):', pageErrors)
    }
  } finally {
    // 9. Tear down the ENTIRE Electron process group via SIGKILL (the Epic-4 minimize-to-taskbar
    //    guard makes app.close() hang ~120s; the launched bash/claude are descendants so the
    //    negative-pid group kill reaps them too). Mirrors tests/e2e/terminal.e2e.ts.
    const electronProcess = app.process()
    const processClosed = new Promise<void>((resolve) => {
      if (electronProcess.killed) resolve()
      else electronProcess.once('close', () => resolve())
    })
    try {
      process.kill(-electronProcess.pid!, 'SIGKILL')
    } catch {
      /* process group may already be gone */
    }
    await processClosed
  }
})
