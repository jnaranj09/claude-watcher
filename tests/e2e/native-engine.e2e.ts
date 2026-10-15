// Story 6.5 — REAL Playwright-Electron e2e proof of the NATIVE SESSION ENGINE (Epic 6).
//
// Purpose: Stories 6.1–6.4 replaced the c9watch CLI with a native engine — the app mints
// `--session-id <uuid>` at launch (instant board card, exact terminal↔session binding),
// the hook ingest drives every status transition, and stop/PTY-exit remove the card
// immediately. This spec proves that end-to-end on the BUILT bundle with REAL hook POSTs:
//
//   Test 1a (cold load): on a fresh start, BEFORE any launch, the EMPTY board (not the
//     skeleton) is visible: the two-shot engine-started `watch:status` signal is the ONLY
//     skeleton-clear when no delta ever arrives (Story 5.3 contract, kept by 6.4).
//
//   Test 1b (the engine journey, one session's whole life):
//     (1) INSTANT CARD — clicking `+ New session` (C9_TEST_PICK_DIR picker seam) synthesizes
//         the board card at spawn, with NO external watcher to wait on (the retired c9watch
//         poll is gone); the card exposes the launch-minted uuid via `data-session-id`.
//     (2) HOOK-DRIVEN STATUS — a real `Stop` POST to the e2e profile's hook port (2.1.199-shaped
//         body, mirroring src/__fixtures__/fakeHookFeed.ts) moves the card to NEEDS-YOU (the
//         your-turn floor); a `Notification`+`permission_prompt` POST keeps it there. This
//         exercises the REAL boundary chain: HTTP listener → HookEventSchema → hookStatus →
//         reducer → handleDelta → CH.watchEvents → board store → column.
//     (3) FAST REMOVAL — the Archive button (no confirmation) removes the card within
//         2 SECONDS (the Story-6.3 AC; no multi-second c9watch linger).
//
//   Test 2 (the Story-6.1 dead pane): SIGKILL the launched claude → the PTY exits → the pane
//     shows EXACTLY ONE `New session` button → clicking it re-runs the launch flow (picker
//     seam) and a NEW live terminal takes focus.
//
//   Test 3 (the Esc interrupt, R5): Esc demotes the card to idle, background work or not.
//
// THE HOOK PORT: the app runs on the e2e profile (src/main/profile.ts, set by ./fixtures.ts), whose
// hook port no other profile uses, and the POSTs below go to that same `E2E_PROFILE.hookPort`.
// globalSetup.ts FAILS the run when something already holds it (a leaked e2e app): the app under
// test would bind nothing and the POSTs would reach the wrong process. The suite runs with
// workers:1 (playwright.config.ts) because every spec's app binds that one port.
//
// REAL `claude` is spawned by these tests (same as launch.e2e.ts). Launch, the picker seam and
// teardown (every launched claude, then the Electron process group) live in ./fixtures.ts; the
// LINUX-ONLY `/proc` walk in ./support/proc.ts.
//
// [Source: spec-native-session-engine.md Story 6.5; src/main/hooks/hookContract.ts (the hook
//  port, from the profile); fakeHookFeed.ts (2.1.199 hook body shapes);
//  src/renderer/src/components/board/Column.tsx (data-column); SessionCard.tsx (data-session-id)]

import path from 'node:path'
import http from 'node:http'
import { E2E_PROFILE } from '../../src/main/profile'
import { test, expect, confirmSessionName } from './fixtures'
import { isLaunchedClaude, waitForClaudeDescendant } from './support/proc'

// The e2e profile's hook ingest endpoint (src/main/hooks/hookContract.ts reads the same profile).
const HOOK_HOST = '127.0.0.1'
const HOOK_PORT = E2E_PROFILE.hookPort

test.setTimeout(120000)

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

// A launch-minted `--session-id` is a v4-shaped uuid (randomUUID in launchSession.ts).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The hook body fields every event carries (2.1.199 shape, mirrors src/__fixtures__/fakeHookFeed.ts);
 *  extras ride .passthrough(). */
function hookCommon(sessionId: string, pickDir: string): Record<string, string> {
  return {
    session_id: sessionId,
    transcript_path: path.join(pickDir, `${sessionId}.jsonl`),
    cwd: pickDir
  }
}

test.describe('native engine', () => {
  // =======================================================================================
  // Test 1a — cold load: on a fresh start, with no launch, the EMPTY board (not the skeleton).
  // =======================================================================================
  test('cold load shows an empty board', async ({ page }) => {
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
  })

  // =======================================================================================
  // Test 1b — the native-engine journey: instant card → hook-driven columns → 2s removal.
  // =======================================================================================
  test('launch → hook POSTs drive columns → archive removes in ≤2s', async ({
    app,
    page,
    appEnv,
    launchSession
  }, testInfo) => {
    const electronPid = app.process().pid
    expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

    // Launch a session via the header button (picker seam returns pickDir; the launch
    // drops into the FOCUSED view where the EmbeddedTerminal mounts → terminal:open →
    // main mints the --session-id uuid, spawns claude, and synthesizes the card AT SPAWN).
    await launchSession(page)
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

    // ── (1) INSTANT CARD ───────────────────────────────────────────────────────────────
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

    // ── (2) HOOK-DRIVEN STATUS, end-to-end over REAL HTTP ──────────────────────────────
    // The real claude must be running before the synthetic POSTs (it throws, naming every
    // descendant, if it never spawned). claude sends no startup hook to an http hook, so
    // nothing of its own can interleave with the POSTs below.
    await waitForClaudeDescendant(electronPid!, 20000)
    const common = hookCommon(sessionId!, appEnv.pickDir)

    // Stop with plain prose (NO trailing '?') → `YourTurn` → the NEEDS-YOU column.
    // NOT idle: the deterministic-attention floor (spec DA-1) says a turn end is never idle —
    // claude stopped, so it is the operator's move. Idle is reached only from an interrupt, a
    // /clear or the session:seen demotion.
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

    await page.screenshot({ path: testInfo.outputPath('native-engine-e2e-needs-you.png') })

    // ── (3) FAST REMOVAL via the Archive button ─────────────────────────────────────────
    // Archive asks no confirmation (it is reversible through `Past sessions…`; StopConfirm.tsx
    // is the DELETE-only confirm). Card click → activateCard → the focused view (the terminal
    // is still focused-bound); Archive → sessionExit.archiveTerminal stops the PTY FIRST
    // (window.launch.archiveSession → main removes the bound session synchronously) then
    // returns to the board — the card must be GONE within 2 SECONDS (the Story-6.3 AC).
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
  })

  // =======================================================================================
  // Test 2 — the Story-6.1 dead pane: claude dies → ONE New-session button → re-launch works.
  // =======================================================================================
  test('dead pane: killed claude shows exactly one New-session button; clicking re-launches', async ({
    app,
    page,
    launchSession
  }, testInfo) => {
    const electronPid = app.process().pid
    expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

    // Launch a session (picker seam) and capture the FIRST terminal's opaque id.
    await launchSession(page)
    const firstTerminal = page.locator('[data-testid="embedded-terminal"]')
    await firstTerminal.waitFor({ state: 'visible', timeout: 20000 })
    const firstTerminalId = await firstTerminal.getAttribute('data-terminal-id')
    expect(firstTerminalId, 'the terminal frame must expose its terminal id').toBeTruthy()

    // Kill the launched claude (the double-ctrl+c stand-in): SIGKILL every claude-matching
    // descendant → the PTY leader dies → the PTY exits → main pushes CH.terminalExit (the
    // pane flips dead) + removes the bound session's card (Story 6.3).
    const descendants = await waitForClaudeDescendant(electronPid!, 20000)
    for (const p of descendants.filter((d) => isLaunchedClaude(d.cmdline))) {
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

    await page.screenshot({ path: testInfo.outputPath('native-engine-e2e-dead-pane.png') })

    // Click it — with C9_TEST_PICK_DIR still set the picker seam fires again and the SAME
    // launch flow runs (picker → launch → focused view). A NEW terminal frame (a fresh
    // opaque terminalId) must appear LIVE and FOCUSED; the old pane may be gone (its card
    // was removed, dropping it from the kept-alive set) or kept hidden — we assert on the
    // NEW terminal only.
    await deadBtn.click()
    // session templates parity: the dead-pane button opens the SAME popover as the header.
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

    await page.screenshot({ path: testInfo.outputPath('native-engine-e2e-relaunched.png') })
  })

  // =========================================================================================
  // Test 3 — the ESC INTERRUPT demotes to idle, background work or not (R5).
  //
  // WHY THIS IS AN E2E AND NOT A UNIT TEST. The interrupt is the one path in this app with no
  // hook behind it: pressing Esc fires NO Claude Code hook of any kind (probe-verified twice
  // on claude 2.1.250 — 12 events before the keypress, 12 after, and no idle notification
  // even 90s later). So the app detects it by watching the pty's own input stream, and that
  // detection lives in the composition root, wired across the renderer's xterm → the preload
  // MessagePort → terminalManager → the reducer. Every one of those seams is invisible to a
  // unit test, and this session has already been bitten TWICE by exactly that gap: the
  // keystroke observer was first added to only ONE of terminalManager's two hand-copied port
  // handlers (the spawn port, while the app actually re-attaches), and the hook probes that
  // designed this feature first used `command`-type hooks while the app registers `http` ones.
  // Both times the unit tests were green and the app was broken.
  //
  // So this test drives the REAL keystroke through the REAL renderer into the REAL pty, and
  // asserts on BOTH the board column AND the main-process log line, which is the only place
  // the decision itself is observable.
  //
  // THE BEHAVIOUR UNDER TEST (R5, `demoteOnInterrupt` in src/main/window/watchFeed.ts and
  // `interruptDemotes` in src/main/pty/interruptKey.ts; .claude/rules/session-engine.md "Esc
  // demotes any card not already idle"): an interrupt always demotes to idle, background work
  // or not. It used to keep the card on `working` while the last `Stop` reported running work,
  // and a task that never ends (a dev server) then held it there forever, Esc included.
  //
  //   Esc while `background_tasks` reported RUNNING  → `interrupt_key` → idle
  //   Esc with no background work reported           → `interrupt_key` → idle
  // =========================================================================================
  test('esc interrupt: demotes to idle even while background work runs (R5)', async ({
    app,
    page,
    appEnv,
    mainLog,
    launchSession
  }, testInfo) => {
    const electronPid = app.process().pid
    expect(electronPid, 'Electron main pid must be known to walk /proc').toBeTruthy()

    // The interrupt DECISION is only observable in main's log — the board shows the outcome,
    // but "demoted by the key" and "never saw the key at all, moved by something else" look
    // identical on the board. The fixture captures main's output so the two can be told apart.
    const timesLogged = (needle: string): number =>
      mainLog.lines().filter((line) => line.includes(needle)).length

    await launchSession(page)
    await page.waitForSelector('[data-testid="embedded-terminal"]', { timeout: 20000 })

    const boardCard = page.locator('[data-column] [data-session-id]')
    await boardCard.waitFor({ state: 'attached', timeout: 5000 })
    const sessionId = await boardCard.getAttribute('data-session-id')
    expect(sessionId, 'the board card must expose the launch-minted session id').toBeTruthy()
    const demoted = `code=interrupt_key session=${sessionId}`

    // The real claude must be running before any synthetic POST (same as test 1b).
    await waitForClaudeDescendant(electronPid!, 20000)
    const common = hookCommon(sessionId!, appEnv.pickDir)

    // ── (1) A Stop whose `background_tasks` reports a RUNNING shell ───────────────────────
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
    expect(armStatus, 'the background Stop POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="working"] [data-session-id="${sessionId}"]`),
      'a Stop reporting running background work must hold the card in the working column'
    ).toBeAttached({ timeout: 5000 })

    // ── (2) Esc while that work runs DEMOTES (R5) ─────────────────────────────────────────
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
      .poll(() => timesLogged(`code=interrupt_key_seen session=${sessionId}`), {
        timeout: 5000,
        message: 'the Escape keystroke must reach main through the pty input path'
      })
      .toBe(1)
    // …and the decision must have been to demote, running work or not.
    await expect
      .poll(() => timesLogged(demoted), {
        timeout: 5000,
        message: 'Esc during running background work must take the demote path (R5)'
      })
      .toBe(1)
    await expect(
      page.locator(`[data-column="idle"] [data-session-id="${sessionId}"]`),
      'Esc must drop the card to the idle column even while background work runs (R5)'
    ).toBeAttached({ timeout: 5000 })

    await page.screenshot({
      path: testInfo.outputPath('native-engine-e2e-interrupt-background.png')
    })

    // ── (3) A later Stop reporting an EMPTY list ──────────────────────────────────────────
    // This is what really happens when the task finishes: claude wakes itself and the turn
    // it runs ends with `background_tasks: []` (probe-verified, ~4s after completion).
    // Back to the board first: while the operator looks at a session in the focused view
    // (window focused), its `YourTurn` is marked seen and demoted to idle at once
    // (hooks/useSessionSeen.ts), so needs-you is only observable from the board.
    await page.locator('[data-testid="focused-back"]').click()
    const doneStatus = await postHook({
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Background task done.',
      background_tasks: []
    })
    expect(doneStatus, 'the empty-list Stop POST must pass the Zod boundary').toBe(200)
    await expect(
      page.locator(`[data-column="needs-you"] [data-session-id="${sessionId}"]`),
      'a Stop with no running work is the operator turn → the needs-you column'
    ).toBeVisible({ timeout: 5000 })

    // ── (4) Esc with nothing running demotes too — the plain "hi then Esc" case ────────────
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

    // A second demote line: the first one (step 2) must not satisfy this wait.
    await expect
      .poll(() => timesLogged(demoted), {
        timeout: 5000,
        message: 'Esc with no background work must take the demote path'
      })
      .toBe(2)
    await expect(
      page.locator(`[data-column="idle"] [data-session-id="${sessionId}"]`),
      'Esc with nothing running must drop the card to the idle column'
    ).toBeAttached({ timeout: 5000 })

    await page.screenshot({
      path: testInfo.outputPath('native-engine-e2e-interrupt-demoted.png')
    })
  })
})
