// An API create adds a card and never takes the operator's view (technical-taste §2: "a
// background event never takes the view"; api.md "A create never takes the view").
//
// The operator is working in a focused session A. The API creates session B. B's card must reach
// the board, while A's terminal stays the one shown and keeps the keyboard focus.
//
// Launches two real claudes (local only, like launch.e2e.ts). The template carries a short prompt
// because the API refuses a template without one.

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { E2E_PROFILE } from '../../src/main/profile'
import { API_TOKEN_FILENAME } from '../../src/main/api/apiToken'

const API = `http://127.0.0.1:${E2E_PROFILE.apiPort}`
const TEMPLATE_ID = 'e2e-api-template'
// The API mints its token lazily, on the first request that asks for it, so a spec cannot wait
// for the file to appear. It writes its own (64 lowercase hex) before the first request; the
// token store reads a valid file from disk instead of minting.
const TOKEN = 'a'.repeat(64)

test.use({
  extraSettings: { apiEnabled: true, apiPort: E2E_PROFILE.apiPort },
  seedFiles: {
    'claude-watcher-templates.json': {
      templates: {
        version: 1,
        templates: [
          {
            id: TEMPLATE_ID,
            name: 'e2e api',
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

/** The terminal id of the frame that holds keyboard focus, or null when focus is elsewhere. */
async function focusedTerminalId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.closest('[data-terminal-id]')?.getAttribute('data-terminal-id') ??
      null
  )
}

test('an API create adds a card and leaves the focused session in view and in focus', async ({
  page,
  appEnv,
  launchSession
}) => {
  // 1. The operator opens session A and works in its terminal.
  await launchSession(page)
  await expect(page.locator('[data-testid="focused-layer"]')).toHaveAttribute('data-active', 'true')
  await expect.poll(() => focusedTerminalId(page), { timeout: 20000 }).not.toBeNull()
  const terminalA = await focusedTerminalId(page)

  // 2. The API is up (GET answers 200 with the token the spec wrote).
  writeFileSync(path.join(appEnv.dataDir, API_TOKEN_FILENAME), TOKEN)
  await expect
    .poll(
      async () => {
        const res = await fetch(`${API}/v1/sessions`, {
          headers: { authorization: `Bearer ${TOKEN}` }
        })
        return res.status
      },
      { timeout: 20000 }
    )
    .toBe(200)

  // 3. An external caller creates session B.
  const res = await fetch(`${API}/v1/sessions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ templateId: TEMPLATE_ID, name: 'api-b', args: [] })
  })
  expect(res.status).toBe(201)
  const created = (await res.json()) as { sessionId: string; terminalId: string }

  // 4. B's card reaches the board (mounted under the hidden board layer). Two elements carry B's
  // id: the board card and its attention-rail row; `.first()` picks either, both are B's.
  await expect(page.locator(`[data-session-id="${created.sessionId}"]`).first()).toBeAttached({
    timeout: 20000
  })

  // 5. The view was not taken: A is still shown and still holds the focus.
  await expect(page.locator('[data-testid="focused-layer"]')).toHaveAttribute('data-active', 'true')
  await expect(page.locator(`[data-terminal-id="${terminalA}"]`)).toBeVisible()
  await expect(page.locator(`[data-terminal-id="${created.terminalId}"]`)).toBeHidden()
  expect(await focusedTerminalId(page)).toBe(terminalA)
})
