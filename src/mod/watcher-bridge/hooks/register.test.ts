// Engine test for the bridge mod, run by `claude plugin test` (npm run test:mod, local only). The
// test's own hooks sit beneath the mod and stand for the engine: they answer the calls the mod
// makes and record what it POSTs. The pure report builder is unit-tested in
// tests/unit/bridgeModReport.test.ts; the prompt-origin body and URL are pinned to main in
// tests/main/modPromptContract.test.ts.
import type { On } from 'claude-code'
import { test, expect, mock } from 'claude-code/testing'

const URL = 'http://127.0.0.1:19279/mod/report'
const PROMPT_URL = 'http://127.0.0.1:19279/mod/prompt'
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

/** The engine beneath the mod for `prompt.submit`: answers it, and logs when it settled and what
 *  the mod POSTed where, in order. */
function promptWorld(
  on: On,
  env: Record<string, string>,
  fetch: () => { status: number; ok: boolean }
): { log: string[]; posts: { url: string; body: string }[] } {
  const log: string[] = []
  const posts: { url: string; body: string }[] = []
  mock.env(on, env)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('prompt.submit', (_$, e) => {
    log.push('next')
    return { text: `entered:${e.text}` }
  })
  on('http.fetch', (_$, e) => {
    log.push('post')
    posts.push({ url: e.url, body: String(e.init?.body ?? '') })
    return { value: { ...fetch(), headers: {}, text: '' } }
  })
  return { log, posts }
}

const OK = (): { status: number; ok: boolean } => ({ status: 200, ok: true })

test('reports a typed prompt’s origin after it entered, without its text', async ($, on) => {
  const { log, posts } = promptWorld(on, { CLAUDE_WATCHER_MOD_URL: URL }, OK)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  const result = await $.prompt.submit({
    text: 'SECRET PROMPT',
    wait: false,
    origin: { kind: 'composer' }
  })
  expect(result).toEqual({ text: 'entered:SECRET PROMPT' })
  expect(log).toEqual(['next', 'post'])
  expect(posts).toEqual([
    { url: PROMPT_URL, body: '{"version":1,"sessionId":"sid-1","origin":"composer"}' }
  ])
})

// An older claude with no `origin`: sending nothing keeps the app's `UserPromptSubmit` fallback.
test('a prompt with no origin sends nothing', async ($, on) => {
  const { posts } = promptWorld(on, { CLAUDE_WATCHER_MOD_URL: URL }, OK)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  const result = await $.prompt.submit({ text: 'hi', wait: false } as Parameters<
    typeof $.prompt.submit
  >[0])
  expect(result).toEqual({ text: 'entered:hi' })
  expect(posts).toEqual([])
})

test('a prompt with an empty origin kind sends nothing', async ($, on) => {
  const { posts } = promptWorld(on, { CLAUDE_WATCHER_MOD_URL: URL }, OK)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: '' } } as Parameters<
    typeof $.prompt.submit
  >[0])
  expect(posts).toEqual([])
})

test('a report that fails to send leaves the prompt as it entered', async ($, on) => {
  const { log } = promptWorld(on, { CLAUDE_WATCHER_MOD_URL: URL }, () => {
    throw new Error('connection refused')
  })
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  const result = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(log).toEqual(['next', 'post'])
  expect(result).toEqual({ text: 'entered:hi' })
})

test('reports no origin in a session the app did not launch', async ($, on) => {
  const { posts } = promptWorld(on, {}, OK)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false })
  const result = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(result).toEqual({ text: 'entered:hi' })
  expect(posts).toEqual([])
})
