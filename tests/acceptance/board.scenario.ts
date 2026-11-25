// Acceptance scenarios: the board's main journeys, through the built app (Given / When / Then).
// A scenario states shipped behaviour in the operator's words; never edit one to match a changed
// result without the owner (.claude/rules/testing.md "Risky code"). Every one but the cold start
// launches a real `claude` (local only, like tests/e2e/native-engine.e2e.ts).

import { writeFileSync } from 'node:fs'
import { test, expect, confirmSessionName } from '../e2e/fixtures'
import { hookCommon, postHook } from '../e2e/support/hookPost'
import { isLaunchedClaude, waitForClaudeDescendant } from '../e2e/support/proc'
import { givenLaunchedSession } from './given'

test.setTimeout(120000)

test('cold start shows an empty board', async ({ page }) => {
  await test.step('Given a fresh data folder', async () => {
    // The fixture gives every launch its own empty data folder.
  })

  await test.step('When the app starts', async () => {
    await page.waitForLoadState('domcontentloaded')
  })

  await test.step('Then the empty board shows, not the loading skeleton', async () => {
    await expect(page.locator('[data-testid="empty-board"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('[data-testid="skeleton-board"]')).toHaveCount(0)
  })
})

test('a new session gets a card and a live terminal', async ({ app, page, launchSession }) => {
  const electronPid = app.process().pid ?? 0

  await test.step('Given the empty board', async () => {
    await expect(page.locator('[data-testid="empty-board"]')).toBeVisible({ timeout: 10000 })
  })

  await test.step('When the operator starts a new session in a folder', async () => {
    await launchSession(page)
  })

  await test.step('Then its terminal shows, running claude', async () => {
    await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('[data-testid="dead-terminal"]')).toHaveCount(0)
    const procs = await waitForClaudeDescendant(electronPid, 20000)
    expect(procs.some((d) => isLaunchedClaude(d.cmdline))).toBe(true)
  })

  await test.step('And its card waits on the board, in Idle', async () => {
    await page.locator('[data-testid="focused-back"]').click()
    await expect(page.locator('[data-column="idle"] [data-session-id]')).toHaveCount(1)
  })
})

test('a finished turn moves the card to Needs you', async ({
  app,
  page,
  appEnv,
  launchSession
}) => {
  const s = await test.step('Given a session on the board', async () => {
    const launched = await givenLaunchedSession(app, page, launchSession)
    await page.locator('[data-testid="focused-back"]').click()
    return launched
  })

  await test.step('When claude ends its turn (a Stop hook)', async () => {
    const status = await postHook(s.hookPath, {
      ...hookCommon(s.sessionId, appEnv.pickDir),
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done - edited the file.'
    })
    expect(status).toBe(200)
  })

  await test.step('Then the card sits in Needs you', async () => {
    await expect(
      page.locator(`[data-column="needs-you"] [data-session-id="${s.sessionId}"]`)
    ).toBeVisible({ timeout: 5000 })
  })
})

test('an archived session leaves the board and shows in Past sessions', async ({
  app,
  page,
  appEnv,
  launchSession
}) => {
  const s = await test.step('Given a session that had a conversation', async () => {
    const launched = await givenLaunchedSession(app, page, launchSession)
    // claude writes its transcript on the first prompt; a session with none gets no record.
    const common = hookCommon(launched.sessionId, appEnv.pickDir)
    writeFileSync(common.transcript_path ?? '', '')
    const status = await postHook(launched.hookPath, {
      ...common,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done.'
    })
    expect(status).toBe(200)
    return launched
  })

  await test.step('When the operator archives it', async () => {
    await page.locator('[data-testid="focused-archive"]').click()
  })

  await test.step('Then its card is gone from the board', async () => {
    await expect(page.locator(`[data-column] [data-session-id="${s.sessionId}"]`)).toHaveCount(0)
  })

  await test.step('And Past sessions lists it by its folder name', async () => {
    await page.locator('[data-testid="app-menu"]').click()
    await page.locator('[data-testid="app-menu-sessions"]').click()
    await page.locator('[data-testid="sessions-menu-past"]').click()
    const folder = appEnv.pickDir.split('/').pop() ?? ''
    await expect(
      page.locator('[data-testid="past-session-name"]', { hasText: folder })
    ).toBeVisible({ timeout: 10000 })
  })
})

test('Esc in a working session drops its card to Idle', async ({
  app,
  page,
  appEnv,
  launchSession
}) => {
  const s = await test.step('Given a session claude is working in', async () => {
    const launched = await givenLaunchedSession(app, page, launchSession)
    const status = await postHook(launched.hookPath, {
      ...hookCommon(launched.sessionId, appEnv.pickDir),
      hook_event_name: 'UserPromptSubmit'
    })
    expect(status).toBe(200)
    await expect(
      page.locator(`[data-column="working"] [data-session-id="${launched.sessionId}"]`)
    ).toBeAttached({ timeout: 5000 })
    return launched
  })

  await test.step('When the operator presses Esc in its terminal', async () => {
    await page.locator('[data-testid="embedded-terminal"]').click()
    await page.keyboard.press('Escape')
  })

  await test.step('Then the card sits in Idle', async () => {
    await expect(
      page.locator(`[data-column="idle"] [data-session-id="${s.sessionId}"]`)
    ).toBeAttached({ timeout: 5000 })
  })
})

test('a pane whose claude exited offers New session, which starts a live one', async ({
  app,
  page,
  launchSession
}) => {
  const firstId = await test.step('Given a session in view', async () => {
    const s = await givenLaunchedSession(app, page, launchSession)
    return (
      (await page.locator('[data-testid="embedded-terminal"]').getAttribute('data-terminal-id')) ??
      `none-${s.sessionId}`
    )
  })

  await test.step('When its claude exits', async () => {
    const electronPid = app.process().pid ?? 0
    const procs = await waitForClaudeDescendant(electronPid, 20000)
    for (const p of procs.filter((d) => isLaunchedClaude(d.cmdline))) {
      try {
        process.kill(p.pid, 'SIGKILL')
      } catch {
        /* the shell may have gone with its claude */
      }
    }
  })

  await test.step('Then the pane shows one New session button', async () => {
    await expect(page.locator('[data-testid="dead-new-session"]')).toHaveCount(1, {
      timeout: 10000
    })
  })

  await test.step('When the operator starts a new session from it', async () => {
    await page.locator('[data-testid="dead-new-session"]').click()
    await page.locator('[data-testid="menu-pick-folder"]').click()
    await confirmSessionName(page)
  })

  await test.step('Then a new live terminal takes its place', async () => {
    const next = page.locator(
      `[data-testid="embedded-terminal"]:not([data-terminal-id="${firstId}"])`
    )
    await expect(next).toBeVisible({ timeout: 20000 })
    await expect(next.locator('[data-testid="dead-terminal"]')).toHaveCount(0)
  })
})
