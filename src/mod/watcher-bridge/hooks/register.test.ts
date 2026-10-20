// Engine test for the bridge mod, run by `claude plugin test` (npm run test:mod, local only). The
// test's own hooks sit beneath the mod and stand for the engine: they answer the calls the mod
// makes and record what it POSTs. The pure report builder is unit-tested in
// tests/unit/bridgeModReport.test.ts.
import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

const URL = 'http://127.0.0.1:19279/mod/report'
const FILES = [{ path: '/p/CLAUDE.md', kind: 'project', content: 'SECRET TEXT' }]

function world(on: On, env: Record<string, string>): { posts: string[]; contextSeen: unknown[] } {
  const posts: string[] = []
  const contextSeen: unknown[] = []
  mock.env(on, env)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.context', (_$, e) => {
    contextSeen.push(e)
    return { blocks: e.blocks }
  })
  on('turn.complete', () => ({ text: '' }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000 }, rateLimits: [] }
  }))
  on('settings.read', () => ({ value: {} }))
  on('http.fetch', (_$, e) => {
    posts.push(String(e.init?.body ?? ''))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  return { posts, contextSeen }
}

test('sends nothing in a session the app did not launch', async ($, on) => {
  const { posts } = world(on, {})
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  await $.prompt.context({ blocks: [], instructionFiles: FILES })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(posts).toEqual([])
})

test('posts one report after the turn once the files are known, with no file content', async ($, on) => {
  const { posts } = world(on, { CLAUDE_WATCHER_MOD_URL: URL })
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  expect(posts).toEqual([])
  await $.prompt.context({ blocks: [], instructionFiles: FILES })
  await $.turn.complete({ answer: 'hi', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(posts.length).toBe(1)
  expect(posts[0]).toContain('"sessionId":"sid-1"')
  expect(posts[0]).toContain('/p/CLAUDE.md')
  expect(posts[0]).not.toContain('SECRET TEXT')
})

test('does not resend an unchanged report', async ($, on) => {
  const { posts } = world(on, { CLAUDE_WATCHER_MOD_URL: URL })
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  await $.prompt.context({ blocks: [], instructionFiles: FILES })
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.turn.complete({ answer: 'b', durationMs: 1, isAborted: false, reason: 'answer' })
  expect(posts.length).toBe(1)
})

test('hands prompt.context on untouched', async ($, on) => {
  const { contextSeen } = world(on, { CLAUDE_WATCHER_MOD_URL: URL })
  const input = { blocks: [], instructionFiles: FILES }
  await $.prompt.context(input)
  expect(contextSeen).toEqual([input])
})
