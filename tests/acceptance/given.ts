// The "Given a session the operator launched" step most scenarios start from: `+ New session` →
// Pick a folder → confirm the name, then wait for the real claude and its board card.

import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '../e2e/fixtures'
import { hookPathOf, waitForClaudeDescendant } from '../e2e/support/proc'

export interface LaunchedSession {
  /** The launch-minted session id the board card carries. */
  sessionId: string
  /** The session's hook channel path (`/h/<token>/`). */
  hookPath: string
  electronPid: number
}

export async function givenLaunchedSession(
  app: ElectronApplication,
  page: Page,
  launchSession: (page: Page) => Promise<void>
): Promise<LaunchedSession> {
  const electronPid = app.process().pid
  if (electronPid === undefined) throw new Error('acceptance: the Electron main pid is unknown')
  await launchSession(page)
  await expect(page.locator('[data-testid="embedded-terminal"]')).toBeVisible({ timeout: 20000 })
  const card = page.locator('[data-column] [data-session-id]')
  await card.waitFor({ state: 'attached', timeout: 5000 })
  const sessionId = (await card.getAttribute('data-session-id')) ?? ''
  expect(sessionId, 'the board card must carry the launch-minted session id').not.toBe('')
  await waitForClaudeDescendant(electronPid, 20000)
  return { sessionId, hookPath: hookPathOf(electronPid, sessionId), electronPid }
}
