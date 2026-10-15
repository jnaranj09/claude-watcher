// One app per data folder (UX-04, src/main/lifecycle/singleInstance.ts). Electron's lock lives in
// userData, so only a real Electron can prove it: two apps on the SAME e2e data folder → the
// second quits at once (exit 0, `code=already_running`) and the first raises its window
// (`code=second_instance_raised`). The unit test injects the lock; this one uses the real one.
// Needs no claude.

import { test, expect, spawnApp, killGroup } from './fixtures'

test('a second app on the same data folder quits, and the first one raises', async ({
  appEnv,
  page,
  mainLog
}) => {
  // The first app is up: its window loaded the renderer (the `page` fixture waits for it).
  await expect(page.locator('[data-testid="header-new-session"]')).toBeVisible({ timeout: 20000 })

  const second = spawnApp(appEnv.env)
  try {
    const code = await Promise.race([
      second.exited,
      new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), 10_000))
    ])
    expect(code, `the second app must quit at once. Its log:\n${second.log.text()}`).toBe(0)
    expect(second.log.text()).toContain('[claude-watcher][instance] code=already_running')
    await expect
      .poll(() => mainLog.text(), {
        timeout: 5000,
        message: 'the first app must log that it raised its window for the second launch'
      })
      .toContain('[claude-watcher][instance] code=second_instance_raised')
  } finally {
    await killGroup(second.proc)
  }
})
