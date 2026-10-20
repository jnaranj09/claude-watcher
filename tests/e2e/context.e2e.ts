// Context end to end (spec 2026-10-18): a REAL claude, launched by the app with the bridge mod
// (`--plugin-dir`), loads the project's CLAUDE.md, the mod reports it to `/mod/report` after the
// first turn, and the Context dialog lists it. Needs a claude at or above MIN_MOD_CLAUDE_VERSION
// and spends one short real prompt. Launch, teardown and the picker seam live in ./fixtures.ts.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test.setTimeout(180000)

test('a launched session’s CLAUDE.md shows on Context’s Instructions page', async ({
  page,
  appEnv,
  launchSession
}) => {
  writeFileSync(path.join(appEnv.pickDir, 'CLAUDE.md'), '# e2e project\n\nAnswer in one word.\n')
  await launchSession(page)
  const terminal = page.locator('[data-testid="embedded-terminal"] >> visible=true').first()
  await terminal.waitFor({ state: 'visible', timeout: 20000 })
  await terminal.click()

  // A fresh temp folder opens claude's folder-trust question (claude's own, unrelated to the
  // mod): its default is "No, exit", so move to "Yes" first. Keys sent before claude is ready
  // are lost, so the whole sequence retries until the prompt lands: the card leaves idle (the
  // UserPromptSubmit hook). On a trusted folder ArrowDown and an empty Enter do nothing.
  const moved = page.locator(
    '[data-column="working"] [data-session-id], [data-column="needs-you"] [data-session-id]'
  )
  await expect(async () => {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('say only the word ok')
    await page.keyboard.press('Enter')
    await expect(moved).toHaveCount(1, { timeout: 8000 })
  }).toPass({ timeout: 90000 })

  await page.locator('[data-testid="focused-context"]').click()
  await expect(
    page.locator('[data-testid="context-file-name"]', { hasText: 'CLAUDE.md' }).first(),
    'the bridge mod must report the project CLAUDE.md after the first turn'
  ).toBeVisible({ timeout: 120000 })
})
