// Regression e2e — quitting must not throw "Object has been destroyed" in main.
//
// Bug (predates Epic 6, reproduced on the installed app): the `'closed'` handler read
// `mainWindow.webContents` AFTER the BrowserWindow was destroyed — on a destroyed window even
// the getter throws, so EVERY real quit (tray Quit → app.quit(), window-all-closed) popped
// Electron's "A JavaScript error occurred in the main process" dialog. Worse, the throw
// aborted the handler, so teardownWatchFeed/teardownWindowTerminals never ran on quit.
// Fix: capture the WebContents reference at handler-registration time (index.ts `closedWc`).
//
// This spec drives the EXACT tray-Quit call (`app.quit()` — tray.ts's Quit item is
// `click: () => app.quit()`) on the BUILT bundle and asserts the main process exits cleanly
// with no destroyed-object throw on stderr. No session is needed: the bug fired with zero
// live sessions (the quit-guard is irrelevant to it). A quit that hangs is SIGKILLed by the
// fixture's teardown (./fixtures.ts).

import { test, expect } from './fixtures'

// Generous bound: a healthy quit lands in well under a second; the bound only exists so a
// regressed hang fails the test instead of stalling the suite.
const QUIT_EXIT_TIMEOUT_MS = 15_000

test('app.quit() (the tray-Quit path) exits cleanly — no "Object has been destroyed"', async ({
  app,
  page,
  mainLog
}) => {
  const child = app.process()

  // The board (or its skeleton) rendering proves the window + renderer are fully up, so the
  // quit below exercises the real teardown path, not an early-startup abort.
  await page.waitForSelector('[data-testid="empty-board"], [data-testid="skeleton-board"]', {
    timeout: 10_000
  })

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
  })

  // The exact call the tray's Quit menu item makes. Zero live sessions → the before-quit
  // guard proceeds straight to teardown + quit.
  await app.evaluate(({ app: electronApp }) => electronApp.quit())

  const code = await Promise.race([
    exited,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), QUIT_EXIT_TIMEOUT_MS))
  ])

  const log = mainLog.text()
  expect(log).not.toContain('Object has been destroyed')
  expect(log).not.toContain('A JavaScript error occurred')
  expect(code, 'main process must exit (cleanly) after app.quit()').toBe(0)
})
