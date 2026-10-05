// Story 6.5 — REAL Playwright-Electron e2e proof of the NATIVE SESSION ENGINE (Epic 6).
//
// Purpose: Stories 6.1–6.4 replaced the c9watch CLI with a native engine — the app mints
// `--session-id <uuid>` at launch (instant board card, exact terminal↔session binding),
// the :9279 hook ingest drives every status transition, and stop/PTY-exit remove the card
// immediately. This spec proves that end-to-end on the BUILT bundle with REAL hook POSTs:
//
//   Test 1 (the engine journey, one session's whole life):
//     (0) COLD LOAD — on a fresh start, BEFORE any launch, the EMPTY board (not the
//         skeleton) is visible: the two-shot engine-started `watch:status` signal is the
//         ONLY skeleton-clear when no delta ever arrives (Story 5.3 contract, kept by 6.4).
//     (1) INSTANT CARD — clicking `+ New session` (C9_TEST_PICK_DIR picker seam) synthesizes
//         the board card at spawn, with NO external watcher to wait on (the retired c9watch
//         poll is gone); the card exposes the launch-minted uuid via `data-session-id`.
//     (2) HOOK-DRIVEN STATUS — a real `Stop` POST to http://127.0.0.1:9279/ (2.1.199-shaped
//         body, mirroring src/__fixtures__/fakeHookFeed.ts) moves the card to the IDLE column;
//         a `Notification`+`permission_prompt` POST moves it to NEEDS-YOU. This exercises the
//         REAL boundary chain: HTTP listener → HookEventSchema → hookStatus → reducer →
//         handleDelta → CH.watchEvents → board store → column.
//     (3) FAST REMOVAL — the Archive flow (Past sessions D-3: the card's Stop control's
//         successor, same place, same chord, no confirmation) removes the card within
//         2 SECONDS (the Story-6.3 AC; no multi-second c9watch linger).
//
//   Test 2 (the Story-6.1 dead pane): SIGKILL the launched claude → the PTY exits → the pane
//     shows EXACTLY ONE `New session` button → clicking it re-runs the launch flow (picker
//     seam) and a NEW live terminal takes focus.
//
// PORT GUARD (mandatory for signal integrity): the hook port is FIXED at 9279 and the app
// TOLERATES EADDRINUSE silently (hookServer.ts logs + skips). If another instance (a dev
// `npm run dev`, the installed app) already owns the port, the app under test would bind
// NOTHING and the test's POSTs would land on the WRONG instance — so each test pre-checks
// the port and SKIPS with a clear message instead of producing a false signal. The suite
// also runs with workers:1 (playwright.config.ts) so a sibling spec's Electron instance is
// never holding the port from a parallel worker.
//
// REAL `claude` is spawned by these tests (same as launch.e2e.ts). Sessions are short-lived
// and every claude descendant is SIGKILLed in the finally teardown (belt-and-suspenders
// before the process-group kill).
//
// LINUX-ONLY: /proc descendant walk + process-group teardown (mirrors launch.e2e.ts).
//
// Pre-requisite: `npm run build` (or `build:dir`) must have produced `out/main/index.js`.
// [Source: spec-native-session-engine.md Story 6.5; tests/e2e/launch.e2e.ts (launch + /proc
//  walk + teardown pattern); src/main/hooks/hookContract.ts (HOST/PORT); fakeHookFeed.ts
//  (2.1.199 hook body shapes); src/renderer/src/components/board/Column.tsx (data-column);
//  SessionCard.tsx (data-session-id); StopConfirm.tsx (stop flow selectors)]

import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import path from 'path'
import http from 'http'
import net from 'net'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

// The built entry point (after `npm run build` / `build:dir`).
const BUILT_MAIN = path.resolve(__dirname, '../../out/main/index.js')

// The checkout root. Every Electron helper (renderer / GPU / zygote) carries it in its cmdline.
const PROJECT_ROOT = path.resolve(__dirname, '../..')

/**
 * Is this descendant the LAUNCHED `claude`, rather than one of Electron's own helper processes?
 *
 * A bare `cmdline.includes('claude')` is NOT safe: the checkout path itself can contain "claude"
 * (this repo lives at `.../claude-watcher/claude-watcher/`), so EVERY Electron zygote/renderer
 * matched it. Measured on this machine: 6 of 7 descendants matched with NO session launched at
 * all — so the dead-pane test below SIGKILLed the app under test instead of the launched claude,
 * the page died, and the dead pane never rendered.
 *
 * Excluding anything whose cmdline mentions the checkout root removes all of Electron's own
 * processes while leaving the real `claude` (resolved to an absolute path outside the repo,
 * e.g. `~/.local/bin/claude` — see `resolveClaudeBin` in src/main/index.ts) untouched.
 */
function isLaunchedClaude(cmdline: string): boolean {
  if (cmdline === '' || cmdline.includes(PROJECT_ROOT)) return false
  return cmdline.includes('claude')
}

// The FIXED hook ingest endpoint (src/main/hooks/hookContract.ts — HOST/PORT are consts
// there; duplicated here because the e2e drives the app strictly from the OUTSIDE).
const HOOK_HOST = '127.0.0.1'
const HOOK_PORT = 9279

test.setTimeout(120000)

/**
 * Session-naming — confirm the create-time NAME PROMPT that now sits between the directory picker
 * and the launch. Accepts the prefill (the cwd basename), which is what these specs assumed before
 * the prompt existed, so their downstream assertions are unchanged.
 * MUST be called after every `+ New session` / dead-pane New-session click: nothing spawns until
 * it runs, so omitting it makes the following `embedded-terminal` wait time out.
 */
async function confirmSessionName(page: Page): Promise<void> {
  const confirm = page.locator('[data-testid="session-name-confirm"]')
  await confirm.waitFor({ state: 'visible', timeout: 20000 })
  await confirm.click()
}

// ---------------------------------------------------------------------------------------
// /proc helpers — copied from tests/e2e/launch.e2e.ts (same Linux-only walk).
// ---------------------------------------------------------------------------------------

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

/** Poll for a descendant of rootPid whose cmdline contains `claude` (the spawn is async). */
async function waitForClaudeDescendant(
  rootPid: number,
  timeoutMs: number
): Promise<{ pid: number; cmdline: string }[]> {
  const deadline = Date.now() + timeoutMs
  let last: { pid: number; cmdline: string }[] = []
  while (Date.now() < deadline) {
    last = descendantCmdlines(rootPid)
    if (last.some((d) => isLaunchedClaude(d.cmdline))) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  return last
}

// ---------------------------------------------------------------------------------------
// Story-6.5 helpers — the port guard + the real hook POST.
// ---------------------------------------------------------------------------------------

/** True when something is ALREADY listening on host:port (a dev/installed instance). The
 *  app under test tolerates EADDRINUSE silently, so this pre-check is mandatory: without
 *  it the test's POSTs would land on the WRONG instance and produce a false signal. */
function portInUse(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    const done = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

const PORT_GUARD_SKIP_MESSAGE =
  `127.0.0.1:${HOOK_PORT} is already bound (a dev/installed Claude Watcher instance is ` +
  `running). The app under test must OWN the hook port — it tolerates EADDRINUSE silently, ` +
  `so running now would post hooks to the WRONG instance. Close the other instance and re-run.`

/** POST one hook body (an object, JSON-encoded here) to the app's hook listener exactly the
 *  way Claude Code does. Resolves with the HTTP status code (200 = accepted past the Zod
 *  boundary; 400 = dropped). */
function postHook(body: Record<string, unknown>): Promise<number> {
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
        res.resume() // drain — the body is empty; we only need the status
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(payload)
  })
}

/** Tear down the app: SIGKILL any still-live `claude` descendants FIRST (the PTY child sits
 *  in its own session — the master-fd close usually reaps it on app death, but don't rely on
 *  it), then SIGKILL the ENTIRE Electron process group (the Epic-4 minimize-to-taskbar guard
 *  makes app.close() hang ~120s — mirrors launch.e2e.ts / terminal.e2e.ts). */
async function teardownApp(app: ElectronApplication): Promise<void> {
  const electronProcess = app.process()
  const pid = electronProcess.pid
  if (pid) {
    for (const d of descendantCmdlines(pid)) {
      // Same precise predicate as the assertions: reap the LAUNCHED claude (which lives in its own
      // session), not Electron's own helpers — the process-group kill below handles those.
      if (isLaunchedClaude(d.cmdline)) {
        try {
          process.kill(d.pid, 'SIGKILL')
        } catch {
          /* the process may already be gone */
        }
      }
    }
  }
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

/** Save a screenshot artifact into test-results/ (best-effort, mirrors the sibling specs). */
async function screenshot(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>,
  name: string
): Promise<void> {
  const screenshotDir = path.resolve(__dirname, '../../test-results')
  try {
    mkdirSync(screenshotDir, { recursive: true })
  } catch {
    /* directory may already exist */
  }
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: false })
}

// A launch-minted `--session-id` is a v4-shaped uuid (randomUUID in launchSession.ts).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// =========================================================================================
// Test 1 — the native-engine journey: instant card → hook-driven columns → 2s stop removal.
// =========================================================================================
test('native engine: instant card at launch, hook POSTs drive columns, UI archive removes in ≤2s', async () => {
  // PORT GUARD — must run BEFORE the app launches (see header comment).
  test.skip(await portInUse(HOOK_PORT, HOOK_HOST), PORT_GUARD_SKIP_MESSAGE)

  const launchDir = mkdtempSync(path.join(tmpdir(), 'c9-native-e2e-'))
  const app = await electron.launch({
    args: [BUILT_MAIN],
    env: { ...process.env, C9_TEST_PICK_DIR: launchDir }
  })
  const electronPid = app.process().pid
  expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()
  const page = await app.firstWindow()

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

    // ── (0) COLD-LOAD SKELETON CLEARS WITH NO LAUNCH (Story 5.3/6.4 engine-started) ──
    // On a fresh start ZERO deltas ever ship, so the ONLY thing clearing the cold-load
    // skeleton is the two-shot `CH.watchStatus { reconnecting: false }` engine-started
    // signal (index.ts registerWatchFeed). BEFORE any launch the EMPTY board (not the
    // skeleton) must be visible — if the signal breaks, the skeleton hangs forever and
    // this expect turns red. (10s comfortably covers the deferred emit + its 1s re-emit.)
    await expect(
      page.locator('[data-testid="empty-board"]'),
      'a fresh no-launch start must clear the skeleton to the EMPTY board (engine-started signal)'
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.locator('[data-testid="skeleton-board"]'),
      'the cold-load skeleton must be gone once the engine-started signal lands'
    ).toHaveCount(0)

    // Launch a session via the header button (picker seam returns launchDir; the launch
    // drops into the FOCUSED view where the EmbeddedTerminal mounts → terminal:open →
    // main mints the --session-id uuid, spawns claude, and synthesizes the card AT SPAWN).
    const newSessionBtn = page.locator('[data-testid="header-new-session"]')
    await newSessionBtn.waitFor({ state: 'visible', timeout: 20000 })
    await newSessionBtn.click()
    // session templates: the header button opens a popover; "Pick a folder…" is the old flow
    await page.locator('[data-testid="menu-pick-folder"]').click()
    await confirmSessionName(page)
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

    // ── (1) INSTANT CARD ─────────────────────────────────────────────────────────────
    // The board layer stays MOUNTED under the focused view (visibility:hidden stacking —
    // App.tsx B-1), so the synthesized card is ATTACHED the moment main ships the delta.
    // 5s is generous: the synthesis is synchronous at spawn — there is NO external watcher
    // (c9watch is retired) and NO hook needed for the card to exist.
    // Scope to a board column: the attention rail's rows ALSO carry data-session-id.
    const boardCard = page.locator('[data-column] [data-session-id]')
    await boardCard.waitFor({ state: 'attached', timeout: 5000 })
    const sessionId = await boardCard.getAttribute('data-session-id')
    expect(sessionId, 'the board card must expose the launch-minted session id').toBeTruthy()
    expect(sessionId!, 'the session id must be the launch-minted uuid').toMatch(UUID_RE)

    // Navigate back to the BOARD (launch landed in the focused view) via the ← Board button
    // (deterministic — Esc also works but rides keydown through the focused xterm).
    await page.locator('[data-testid="focused-back"]').click()
    // 'Connecting' (the synthesized status) classifies into the IDLE column — a fresh
    // spawn is waiting for the operator's FIRST prompt, not claude's turn.
    await expect(
      page.locator(`[data-column="idle"] [data-session-id="${sessionId}"]`),
      'the instant card must sit in the idle column (Connecting → idle)'
    ).toBeVisible({ timeout: 5000 })

    // ── (2) HOOK-DRIVEN STATUS, end-to-end over REAL HTTP ────────────────────────────
    // Wait for the real claude descendant + a settle beat first: the REAL session's own
    // startup hooks (none today: claude sends no SessionStart to an http hook) must land BEFORE our
    // synthetic POSTs so they cannot interleave mid-assertion.
    await waitForClaudeDescendant(electronPid!, 20000)
    await page.waitForTimeout(3000)

    // 2.1.199-shaped bodies (mirrors src/__fixtures__/fakeHookFeed.ts): every event carries
    // session_id + cwd + transcript_path; extras ride .passthrough().
    const common = {
      session_id: sessionId!,
      transcript_path: path.join(launchDir, `${sessionId}.jsonl`),
      cwd: launchDir
    }

    // Stop with plain prose (NO trailing '?') → `YourTurn` → the NEEDS-YOU column.
    // NOT idle: the deterministic-attention floor (spec DA-1) says a turn end is never idle —
    // claude stopped, so it is the operator's move. Idle is reached only from an interrupt, a
    // /clear or the session:seen demotion. (This assertion read `idle` until now, which had been stale
    // since the your-turn floor landed in hookStatus.ts.)
    const stopStatus = await postHook({
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done - edited the file and updated the tests.'
    })
    expect(stopStatus, 'the Stop hook POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="needs-you"] [data-session-id="${sessionId}"]`),
      'a plain Stop hook must move the card to the needs-you column (the your-turn floor)'
    ).toBeVisible({ timeout: 5000 })

    // Notification(permission_prompt) → NeedsPermission → the NEEDS-YOU column.
    const notifStatus = await postHook({
      ...common,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      message: 'Claude needs your permission to use Bash'
    })
    expect(notifStatus, 'the Notification hook POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="needs-you"] [data-session-id="${sessionId}"]`),
      'a permission_prompt Notification must move the card to the needs-you column'
    ).toBeVisible({ timeout: 5000 })

    await screenshot(page, 'native-engine-e2e-needs-you.png')

    // ── (3) FAST REMOVAL via the Archive flow ─────────────────────────────────────────
    // Past sessions (D-3) — Archive is the Stop control's successor: same place, same chord,
    // but NO confirmation (it is reversible through `Past sessions…`, so the modal this used
    // to open is gone from this path — see StopConfirm.tsx, now the DELETE-only confirm).
    // Card click → activateCard → the focused view (the terminal is still focused-bound);
    // Archive → sessionExit.archiveTerminal stops the PTY FIRST (window.launch.archiveSession
    // → main removes the bound session synchronously) then returns to the board — the card
    // must be GONE within 2 SECONDS (the Story-6.3 AC).
    //
    // force:true — the needs-you card runs the INFINITE emphasis pulse (emphasis.module.css
    // animates transform:scale 1↔1.015 forever), so Playwright's "stable" actionability
    // check can never pass on it. A human clicks a pulsing card fine; nothing overlays
    // board cards, so skipping the hit-test masks no occlusion here.
    await page.locator(`[data-column] [data-session-id="${sessionId}"]`).click({ force: true })
    const archiveBtn = page.locator('[data-testid="focused-archive"]')
    await archiveBtn.waitFor({ state: 'visible', timeout: 5000 })
    await archiveBtn.click()
    await expect(
      page.locator(`[data-column] [data-session-id="${sessionId}"]`),
      'archiving the session must remove its card within 2s (no linger)'
    ).toHaveCount(0, { timeout: 2000 })
  } finally {
    await teardownApp(app)
  }
})

// =========================================================================================
// Test 2 — the Story-6.1 dead pane: claude dies → ONE New-session button → re-launch works.
// =========================================================================================
test('dead pane: killed claude shows exactly one New-session button; clicking re-launches', async () => {
  // PORT GUARD — same pre-check: this test's app must own :9279 too (its exit-removal path
  // and the re-launch's instant card both ride the native engine under test).
  test.skip(await portInUse(HOOK_PORT, HOOK_HOST), PORT_GUARD_SKIP_MESSAGE)

  const launchDir = mkdtempSync(path.join(tmpdir(), 'c9-deadpane-e2e-'))
  const app = await electron.launch({
    args: [BUILT_MAIN],
    env: { ...process.env, C9_TEST_PICK_DIR: launchDir }
  })
  const electronPid = app.process().pid
  expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()
  const page = await app.firstWindow()

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

    // Launch a session (picker seam) and capture the FIRST terminal's opaque id.
    const newSessionBtn = page.locator('[data-testid="header-new-session"]')
    await newSessionBtn.waitFor({ state: 'visible', timeout: 20000 })
    await newSessionBtn.click()
    // session templates: the header button opens a popover; "Pick a folder…" is the old flow
    await page.locator('[data-testid="menu-pick-folder"]').click()
    await confirmSessionName(page)
    const firstTerminal = page.locator('[data-testid="embedded-terminal"]')
    await firstTerminal.waitFor({ state: 'visible', timeout: 20000 })
    const firstTerminalId = await firstTerminal.getAttribute('data-terminal-id')
    expect(firstTerminalId, 'the terminal frame must expose its terminal id').toBeTruthy()

    // Kill the launched claude (the double-ctrl+c stand-in): SIGKILL every claude-matching
    // descendant → the PTY leader dies → the PTY exits → main pushes CH.terminalExit (the
    // pane flips dead) + removes the bound session's card (Story 6.3).
    const descendants = await waitForClaudeDescendant(electronPid!, 20000)
    const claudeProcs = descendants.filter((d) => isLaunchedClaude(d.cmdline))
    expect(
      claudeProcs.length,
      `No \`claude\` descendant found to kill. Descendant cmdlines:\n` +
        descendants.map((d) => `  ${d.pid}: ${d.cmdline || '(empty)'}`).join('\n')
    ).toBeGreaterThan(0)
    for (const p of claudeProcs) {
      try {
        process.kill(p.pid, 'SIGKILL')
      } catch {
        /* the process may already be gone */
      }
    }

    // The dead pane shows EXACTLY ONE action: New session (Story 6.1 — Reopen+Stop retired).
    const deadBtn = page.locator('[data-testid="dead-new-session"]')
    await deadBtn.waitFor({ state: 'visible', timeout: 10000 })
    await expect(deadBtn, 'the dead pane must show exactly ONE New-session button').toHaveCount(1)

    await screenshot(page, 'native-engine-e2e-dead-pane.png')

    // Click it — with C9_TEST_PICK_DIR still set the picker seam fires again and the SAME
    // launch flow runs (picker → launch → focused view). A NEW terminal frame (a fresh
    // opaque terminalId) must appear LIVE and FOCUSED; the old pane may be gone (its card
    // was removed, dropping it from the kept-alive set) or kept hidden — we assert on the
    // NEW terminal only.
    await deadBtn.click()
    // session templates parity: the dead-pane button now opens the SAME popover as the header;
    // "Pick a folder…" is the old flow (mirrors the header path at the top of this test).
    await page.locator('[data-testid="menu-pick-folder"]').click()
    await confirmSessionName(page)
    const newTerminal = page.locator(
      `[data-testid="embedded-terminal"]:not([data-terminal-id="${firstTerminalId}"])`
    )
    await newTerminal.waitFor({ state: 'visible', timeout: 20000 })
    await expect(newTerminal, 'exactly one NEW terminal frame must appear').toHaveCount(1)
    const newTerminalId = await newTerminal.getAttribute('data-terminal-id')
    expect(newTerminalId, 'the new frame must carry a fresh terminal id').toBeTruthy()
    expect(newTerminalId!).not.toBe(firstTerminalId)
    // The new frame is the ACTIVE one (visible — kept-alive hidden frames are visibility:hidden),
    // and it must NOT be showing a dead pane of its own (the re-launch spawned a live PTY).
    await expect(newTerminal.locator('[data-testid="dead-terminal"]')).toHaveCount(0)

    await screenshot(page, 'native-engine-e2e-relaunched.png')
  } finally {
    await teardownApp(app)
  }
})

// =========================================================================================
// Test 3 — the ESC INTERRUPT, and the background work that must survive it.
//
// WHY THIS IS AN E2E AND NOT A UNIT TEST. The interrupt is the one path in this app with no
// hook behind it: pressing Esc fires NO Claude Code hook of any kind (probe-verified twice
// on claude 2.1.250 — 12 events before the keypress, 12 after, and no idle notification
// even 90s later). So the app detects it by watching the pty's own input stream, and that
// detection lives in the composition root (`src/main/index.ts`), wired across the renderer's
// xterm → the preload MessagePort → terminalManager → the reducer. Every one of those seams
// is invisible to a unit test, and this session has already been bitten TWICE by exactly
// that gap: the keystroke observer was first added to only ONE of terminalManager's two
// hand-copied port handlers (the spawn port, while the app actually re-attaches), and the
// hook probes that designed this feature first used `command`-type hooks while the app
// registers `http` ones. Both times the unit tests were green and the app was broken.
//
// So this test drives the REAL keystroke through the REAL renderer into the REAL pty, and
// asserts on BOTH the board column AND the main-process log line, which is the only place
// the decision itself is observable.
//
// THE BEHAVIOUR UNDER TEST. An interrupt ends the FOREGROUND turn, not background work —
// claude detaches a backgrounded shell deliberately and it keeps running past the Esc. So:
//
//   Esc while `background_tasks` reported RUNNING  → card STAYS `working` (`..._background_kept`)
//   Esc with no background work reported           → card demotes to `idle` (`interrupt_key`)
//
// The first is the regression that matters: demoting there is a FALSE IDLE for the whole
// life of the background task, which is the exact lie the board exists to not tell.
// =========================================================================================
test('esc interrupt: demotes to idle, but NEVER while background work is running', async () => {
  test.skip(await portInUse(HOOK_PORT, HOOK_HOST), PORT_GUARD_SKIP_MESSAGE)

  const launchDir = mkdtempSync(path.join(tmpdir(), 'c9-interrupt-e2e-'))
  const app = await electron.launch({
    args: [BUILT_MAIN],
    env: { ...process.env, C9_TEST_PICK_DIR: launchDir }
  })
  const electronPid = app.process().pid
  expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

  // The interrupt DECISION is only observable in main's log — the board shows the outcome,
  // but "kept because background work is running" and "never saw the key at all" look
  // identical on the board. Capture stdout so the two can be told apart.
  const mainLog: string[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString('utf8')))
  const logged = (needle: string): boolean => mainLog.join('').includes(needle)

  const page = await app.firstWindow()

  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

    const newSessionBtn = page.locator('[data-testid="header-new-session"]')
    await newSessionBtn.waitFor({ state: 'visible', timeout: 20000 })
    await newSessionBtn.click()
    // session templates: the header button opens a popover; "Pick a folder…" is the old flow
    await page.locator('[data-testid="menu-pick-folder"]').click()
    await confirmSessionName(page)
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

    const boardCard = page.locator('[data-column] [data-session-id]')
    await boardCard.waitFor({ state: 'attached', timeout: 5000 })
    const sessionId = await boardCard.getAttribute('data-session-id')
    expect(sessionId, 'the board card must expose the launch-minted session id').toBeTruthy()

    // Let the REAL session's own startup hooks land before any synthetic POST, so they can
    // never interleave mid-assertion (same settle as test 1).
    await waitForClaudeDescendant(electronPid!, 20000)
    await page.waitForTimeout(3000)

    const common = {
      session_id: sessionId!,
      transcript_path: path.join(launchDir, `${sessionId}.jsonl`),
      cwd: launchDir
    }

    // ── (1) ARM: a Stop whose `background_tasks` reports a RUNNING shell ──────────────
    // This is the real claude 2.1.250 shape (probe-captured keys: id/type/status/
    // description/command). A turn that ends with work still running is `Working`, not the
    // operator's turn — claude will wake ITSELF when the task finishes.
    const armStatus = await postHook({
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Started the build in the background.',
      background_tasks: [
        {
          id: 'bg_e2e_1',
          type: 'shell',
          status: 'running',
          description: 'long build',
          command: 'sleep 300'
        }
      ]
    })
    expect(armStatus, 'the arming Stop POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="working"] [data-session-id="${sessionId}"]`),
      'a Stop reporting running background work must hold the card in the working column'
    ).toBeAttached({ timeout: 5000 })

    // ── (2) THE REGRESSION: Esc must NOT demote while that work is running ────────────
    // A real keystroke into the real xterm: renderer → preload MessagePort → terminalManager
    // → main's onInput → isInterruptKey → the board seam.
    //
    // The view STAYS on the focused session: Esc is consumed by the focused xterm and does
    // NOT trigger the focused→board return (measured here — the board layer stays mounted at
    // `visibility:hidden` under the focused view, App.tsx B-1). That is the correct product
    // behaviour: Esc belongs to claude while a terminal has focus. So every card assertion
    // below is `toBeAttached`, not `toBeVisible` — the column is what is under test, and a
    // column-scoped locator only resolves at all when the card is in that column.
    await page.locator('[data-testid="embedded-terminal"]').click()
    await page.keyboard.press('Escape')

    // The key must have been SEEN on the pty at all — this is the assertion that would have
    // caught the spawn-port-only observer bug.
    await expect
      .poll(() => logged(`code=interrupt_key_seen session=${sessionId}`), {
        timeout: 5000,
        message: 'the Escape keystroke must reach main through the pty input path'
      })
      .toBe(true)
    // …and the decision must have been to KEEP the card, because work is running.
    await expect
      .poll(() => logged(`code=interrupt_key_background_kept session=${sessionId}`), {
        timeout: 5000,
        message: 'Esc during running background work must be logged as kept, not demoted'
      })
      .toBe(true)
    expect(
      logged(`code=interrupt_key session=${sessionId}`),
      'the demote path must NOT have run while background work was running'
    ).toBe(false)
    await expect(
      page.locator(`[data-column="working"] [data-session-id="${sessionId}"]`),
      'the card must STILL be in the working column — the background shell is still running'
    ).toBeAttached({ timeout: 5000 })

    await screenshot(page, 'native-engine-e2e-interrupt-kept.png')

    // ── (3) DISARM: a later Stop reporting an EMPTY list clears the verdict ───────────
    // This is what really happens when the task finishes: claude wakes itself and the turn
    // it runs ends with `background_tasks: []` (probe-verified, ~4s after completion).
    const disarmStatus = await postHook({
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Background task done.',
      background_tasks: []
    })
    expect(disarmStatus, 'the disarming Stop POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="needs-you"] [data-session-id="${sessionId}"]`),
      'a Stop with no running work is the operator turn → the needs-you column'
    ).toBeAttached({ timeout: 5000 })

    // ── (4) Esc with nothing running MUST demote — the plain "hi then Esc" case ───────
    // Re-enter the focused view (this marks the YourTurn card seen → idle), then put it back
    // on `Working` with a prompt-submit, which is exactly the state a real session is in the
    // instant the operator hits Esc.
    await page.locator(`[data-column] [data-session-id="${sessionId}"]`).click({ force: true })
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 10000 })
    const promptStatus = await postHook({ ...common, hook_event_name: 'UserPromptSubmit' })
    expect(promptStatus, 'the UserPromptSubmit POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="working"] [data-session-id="${sessionId}"]`),
      'a prompt submit puts the card back on working'
    ).toBeAttached({ timeout: 5000 })

    await page.locator('[data-testid="embedded-terminal"]').click()
    await page.keyboard.press('Escape')

    await expect
      .poll(() => logged(`code=interrupt_key session=${sessionId}`), {
        timeout: 5000,
        message: 'Esc with no background work must take the demote path'
      })
      .toBe(true)
    await expect(
      page.locator(`[data-column="idle"] [data-session-id="${sessionId}"]`),
      'Esc with nothing running must drop the card to the idle column'
    ).toBeAttached({ timeout: 5000 })

    await screenshot(page, 'native-engine-e2e-interrupt-demoted.png')
  } finally {
    await teardownApp(app)
  }
})
