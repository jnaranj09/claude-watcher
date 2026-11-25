// Acceptance scenario: Context → Instructions lists the project's CLAUDE.md, as the bridge mod
// reports it after the first turn. Needs a claude at or above MIN_MOD_CLAUDE_VERSION and spends
// one short real prompt.

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '../e2e/fixtures'

test.setTimeout(180000)

test('Context shows the project’s CLAUDE.md under Instructions', async ({
  page,
  appEnv,
  launchSession
}) => {
  await test.step('Given a project folder with a CLAUDE.md', async () => {
    writeFileSync(path.join(appEnv.pickDir, 'CLAUDE.md'), '# acceptance\n\nAnswer in one word.\n')
  })

  await test.step('When the operator starts a session there and sends one prompt', async () => {
    await launchSession(page)
    const terminal = page.locator('[data-testid="embedded-terminal"] >> visible=true').first()
    await expect(terminal).toBeVisible({ timeout: 20000 })
    await terminal.click()
    // claude's folder-trust question first (ArrowDown + Enter = "Yes"; nothing on a trusted
    // folder); repeated until the prompt lands and the card leaves Idle.
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
  })

  await test.step('Then Context → Instructions lists CLAUDE.md', async () => {
    await page.locator('[data-testid="focused-context"]').click()
    await expect(
      page.locator('[data-testid="context-file-name"]', { hasText: 'CLAUDE.md' }).first()
    ).toBeVisible({ timeout: 120000 })
  })
})
