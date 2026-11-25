// Acceptance scenario: one app per data folder (UX-04). A second start on the same folder quits
// at once and the running app raises its window. Needs no claude.

import { test, expect, spawnApp, killGroup } from '../e2e/fixtures'

test('a second start quits, and the running app raises its window', async ({
  appEnv,
  page,
  mainLog
}) => {
  await test.step('Given the app is running', async () => {
    await expect(page.locator('[data-testid="header-new-session"]')).toBeVisible({
      timeout: 20000
    })
  })

  const second = spawnApp(appEnv.env)
  try {
    await test.step('When the operator starts it again on the same data folder', async () => {
      const code = await Promise.race([
        second.exited,
        new Promise<'still running'>((r) => setTimeout(() => r('still running'), 10_000))
      ])
      expect(code, `the second start must quit at once. Its log:\n${second.log.text()}`).toBe(0)
    })

    await test.step('Then the second start says the app is already running', async () => {
      expect(second.log.text()).toContain('[claude-watcher][instance] code=already_running')
    })

    await test.step('And the running app raises its window', async () => {
      await expect
        .poll(() => mainLog.text(), { timeout: 5000 })
        .toContain('[claude-watcher][instance] code=second_instance_raised')
    })
  } finally {
    await killGroup(second.proc)
  }
})
