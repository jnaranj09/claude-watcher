// Acceptance scenario: a session created through the programmatic API gets a card and never takes
// the operator's view (.claude/rules/api.md "a create never takes the view"). Launches two real
// claudes; the template carries a short prompt because the API refuses one without.

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { API_TOKEN_FILENAME } from '../../src/main/api/apiToken'
import { E2E_PROFILE } from '../../src/main/profile'
import { test, expect } from '../e2e/fixtures'

const API = `http://127.0.0.1:${E2E_PROFILE.apiPort}`
const TEMPLATE_ID = 'acceptance-api-template'
// Written before the first request: the token store reads a valid file instead of minting one.
const TOKEN = 'b'.repeat(64)

test.use({
  extraSettings: { apiEnabled: true, apiPort: E2E_PROFILE.apiPort },
  seedFiles: {
    'claude-watcher-templates.json': {
      templates: {
        version: 1,
        templates: [
          {
            id: TEMPLATE_ID,
            name: 'acceptance api',
            cwd: tmpdir(),
            model: null,
            permissionMode: null,
            effort: null,
            workspaceId: null,
            initialPrompt: 'Reply with the word ok.',
            params: [],
            favorite: false
          }
        ]
      }
    }
  }
})

test.setTimeout(120000)

const focusedTerminalId = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      document.activeElement?.closest('[data-terminal-id]')?.getAttribute('data-terminal-id') ??
      null
  )

test('an API create adds a card without taking the operator’s view', async ({
  page,
  appEnv,
  launchSession
}) => {
  const terminalA = await test.step('Given the operator works in a session', async () => {
    await launchSession(page)
    await expect.poll(() => focusedTerminalId(page), { timeout: 20000 }).not.toBeNull()
    return focusedTerminalId(page)
  })

  const created = await test.step('When a caller creates a session through the API', async () => {
    writeFileSync(path.join(appEnv.dataDir, API_TOKEN_FILENAME), TOKEN)
    const auth = { authorization: `Bearer ${TOKEN}` }
    await expect
      .poll(async () => (await fetch(`${API}/v1/sessions`, { headers: auth })).status, {
        timeout: 20000
      })
      .toBe(200)
    const res = await fetch(`${API}/v1/sessions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: TEMPLATE_ID, name: 'api-b', args: [] })
    })
    expect(res.status).toBe(201)
    return (await res.json()) as { sessionId: string; terminalId: string }
  })

  await test.step('Then the new session has a card', async () => {
    await expect(page.locator(`[data-session-id="${created.sessionId}"]`).first()).toBeAttached({
      timeout: 20000
    })
  })

  await test.step('And the operator’s session stays in view and keeps the keyboard', async () => {
    await expect(page.locator(`[data-terminal-id="${terminalA}"]`)).toBeVisible()
    await expect(page.locator(`[data-terminal-id="${created.terminalId}"]`)).toBeHidden()
    expect(await focusedTerminalId(page)).toBe(terminalA)
  })
})
