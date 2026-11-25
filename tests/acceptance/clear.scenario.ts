// Acceptance scenario: `/clear` gives the conversation a new session id, and the card follows it
// (.claude/rules/session-engine.md "`/clear` changes the id; the card follows"). A real claude runs
// the real `/clear` (no model call); the new id is read from claude's own record of its process
// (`<claude config>/sessions/<pid>.json`), as the app's exact proof reads it.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { claudeSessionsDir } from '../../src/main/pty/claudeSessionFile'
import { test, expect } from '../e2e/fixtures'
import { hookCommon, postHook } from '../e2e/support/hookPost'
import { descendantCmdlines, isLaunchedClaude } from '../e2e/support/proc'
import { givenLaunchedSession } from './given'

test.setTimeout(180000)

/** Every session id claude's own records give for the launched claudes under `electronPid`. */
function recordedSessionIds(electronPid: number): string[] {
  return descendantCmdlines(electronPid)
    .filter((d) => isLaunchedClaude(d.cmdline))
    .map((d) => {
      try {
        const record: unknown = JSON.parse(
          readFileSync(path.join(claudeSessionsDir(), `${d.pid}.json`), 'utf8')
        )
        const id: unknown =
          typeof record === 'object' && record !== null ? Reflect.get(record, 'sessionId') : null
        return typeof id === 'string' ? id : ''
      } catch {
        return '' // not the claude itself (its login shell), or no record yet
      }
    })
    .filter((id) => id !== '')
}

test('/clear keeps the card and moves it to the new session id', async ({
  app,
  page,
  appEnv,
  mainLog,
  launchSession
}) => {
  const s = await test.step('Given a session on the board', async () => {
    return givenLaunchedSession(app, page, launchSession)
  })

  await test.step('When the operator types /clear in its terminal', async () => {
    const terminal = page.locator('[data-testid="embedded-terminal"]')
    // A fresh temp folder first asks claude's folder-trust question (default "No, exit"):
    // ArrowDown + Enter picks "Yes"; on a trusted folder they do nothing. Keys sent before claude
    // is ready are lost, so the sequence repeats until claude ends the old session (SessionEnd
    // on a live pty, which the app logs).
    await expect(async () => {
      await terminal.click()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/clear')
      await page.keyboard.press('Enter')
      await expect
        .poll(() => mainLog.text(), { timeout: 8000 })
        .toContain('code=hook_sessionend_pty_alive')
    }).toPass({ timeout: 90000 })
  })

  const newId = await test.step('Then claude runs under a new session id', async () => {
    let id = ''
    await expect
      .poll(
        () => {
          id = recordedSessionIds(s.electronPid).find((x) => x !== s.sessionId) ?? ''
          return id
        },
        { timeout: 10000 }
      )
      .not.toBe('')
    return id
  })

  await test.step('When claude ends a turn under the new id', async () => {
    const status = await postHook(s.hookPath, {
      ...hookCommon(newId, appEnv.pickDir),
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done.'
    })
    expect(status).toBe(200)
  })

  await test.step('Then the same card carries the new id, and none carries the old one', async () => {
    await page.locator('[data-testid="focused-back"]').click()
    await expect(page.locator(`[data-column] [data-session-id="${newId}"]`)).toHaveCount(1, {
      timeout: 5000
    })
    await expect(page.locator(`[data-column] [data-session-id="${s.sessionId}"]`)).toHaveCount(0)
    await expect(page.locator('[data-column] [data-session-id]')).toHaveCount(1)
  })
})
