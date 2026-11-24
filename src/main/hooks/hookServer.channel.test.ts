// The hook channel on the REAL createHookServer (threat model T-D13): a session id is readable by
// any OS user (/proc), so a hook, a bridge mod report or a prompt origin is taken only under the
// session's channel token (`/h/<token>/…`), and only for the token's own session or one no card
// holds. Reverting any channel check in hookServer.ts turns a test here red.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { createHookServer } from './hookServer'
import { createHookChannel, type HookChannel } from './hookChannel'
import { MAX_BODY_BYTES, MOD_PROMPT_PATH, MOD_REPORT_PATH } from './hookContract'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import type { ModPrompt } from '../../shared/schemas/modPrompt'
import type { ModReport } from '../../shared/schemas/modReport'
import { modReportFixture } from '../../__fixtures__/modReport'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'aaaaaaaa-0000-4000-8000-00000000000b'
/** An id no card holds (a `/clear`'s new id before the rebind). */
const NEW_ID = 'aaaaaaaa-0000-4000-8000-0000000000ff'
const TOKEN_A = '0a'.repeat(32)
const TOKEN_B = '0b'.repeat(32)
/** Live in the store, but not 64 lowercase hex: only the path parser may refuse them. */
const UPPER_TOKEN = '0D'.repeat(32)
const SHORT_TOKEN = '0e'.repeat(32).slice(1)

interface Rig {
  base: string
  channel: HookChannel
  onHookEvent: ReturnType<typeof vi.fn<(evt: HookEvent) => void>>
  onModReport: ReturnType<typeof vi.fn<(r: ModReport) => boolean>>
  onModPrompt: ReturnType<typeof vi.fn<(p: ModPrompt) => boolean>>
  takePendingTitle: ReturnType<typeof vi.fn<(id: string) => string | null>>
  logs: BoundaryErrorRecord[]
  /** Settles when the server first resolves a channel token (it has read the request's headers). */
  headersSeen: Promise<void>
}

let close: (() => void) | null = null
afterEach(() => {
  close?.()
  close = null
})

/** The listener with two live cards, A and B, each holding its own token, plus two grants under
 *  token shapes a spawn never mints. */
function start(): Promise<Rig> {
  const tokens = [TOKEN_A, TOKEN_B, UPPER_TOKEN, SHORT_TOKEN]
  const channel = createHookChannel(() => tokens.shift() ?? 'f'.repeat(64))
  channel.mint({ sessionId: A })
  channel.mint({ sessionId: B })
  channel.mint({ sessionId: 'upper' })
  channel.mint({ sessionId: 'short' })
  const live = new Set([A, B])
  let seen: () => void = () => {}
  const headersSeen = new Promise<void>((r) => (seen = r))
  const onHookEvent = vi.fn<(evt: HookEvent) => void>()
  const onModReport = vi.fn<(r: ModReport) => boolean>(() => true)
  const onModPrompt = vi.fn<(p: ModPrompt) => boolean>(() => true)
  const takePendingTitle = vi.fn<(id: string) => string | null>(() => 'renamed')
  const logs: BoundaryErrorRecord[] = []
  return new Promise((resolve) => {
    const s = createHookServer({
      onHookEvent,
      onModReport,
      onModPrompt,
      takePendingTitle,
      channel: {
        resolve: (t) => {
          seen()
          return channel.resolve(t)
        },
        isLive: (id) => live.has(id)
      },
      log: (err) => logs.push(err),
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        close = () => s.close()
        resolve({
          base: `http://127.0.0.1:${port}`,
          channel,
          onHookEvent,
          onModReport,
          onModPrompt,
          takePendingTitle,
          logs,
          headersSeen
        })
      }
    })
  })
}

function post(base: string, path: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

/** Headers out, a little of the body, and never the rest: the status, or a hang. */
function unfinished(base: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': 100 }
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
        req.destroy()
      }
    )
    req.on('error', reject)
    req.write('{"session_id"')
  })
}

const hook = (sessionId: string): string =>
  JSON.stringify({ session_id: sessionId, hook_event_name: 'UserPromptSubmit', prompt: 'hi' })
const report = (sessionId: string): string => JSON.stringify(modReportFixture({ sessionId }))
const origin = (sessionId: string): string =>
  JSON.stringify({ version: 1, sessionId, origin: 'composer' })

describe('hook server — the hook channel (T-D13)', () => {
  it("the token's own session reaches every handler, and its pending rename", async () => {
    const r = await start()
    expect([
      await post(r.base, `/h/${TOKEN_A}/`, hook(A)),
      await post(r.base, `/h/${TOKEN_A}${MOD_REPORT_PATH}`, report(A)),
      await post(r.base, `/h/${TOKEN_A}${MOD_PROMPT_PATH}`, origin(A))
    ]).toEqual([200, 200, 200])
    expect([
      r.onHookEvent.mock.calls.length,
      r.onModReport.mock.calls.length,
      r.onModPrompt.mock.calls.length,
      r.takePendingTitle.mock.calls
    ]).toEqual([1, 1, 1, [[A]]])
  })

  it('no token: 401 before the body, no handler, no rename taken', async () => {
    const r = await start()
    expect([await unfinished(r.base, '/'), await post(r.base, '/', hook(A))]).toEqual([401, 401])
    expect([r.onHookEvent.mock.calls, r.takePendingTitle.mock.calls]).toEqual([[], []])
    expect(r.logs).toContainEqual({ path: '(channel)', code: 'channel_unauthorized' })
  })

  it('a mod report or a prompt origin with no channel token is 401', async () => {
    const r = await start()
    expect([
      await post(r.base, MOD_REPORT_PATH, report(A)),
      await post(r.base, MOD_PROMPT_PATH, origin(A))
    ]).toEqual([401, 401])
    expect([r.onModReport.mock.calls, r.onModPrompt.mock.calls]).toEqual([[], []])
  })

  it.each([
    ['an unknown token', `/h/${'0c'.repeat(32)}/`],
    ['a token one character short', `/h/${SHORT_TOKEN}/`],
    ['a token in upper case', `/h/${UPPER_TOKEN}/`],
    ['a token with no slash before the route', `/h/${TOKEN_A}x/`]
  ])('%s is 401 and reaches no handler', async (_name, path) => {
    const r = await start()
    expect(await post(r.base, path, hook(NEW_ID))).toBe(401)
    expect(r.onHookEvent).not.toHaveBeenCalled()
  })

  it("A's token naming live B: 403 for a hook, a report and a prompt", async () => {
    const r = await start()
    expect([
      await post(r.base, `/h/${TOKEN_A}/`, hook(B)),
      await post(r.base, `/h/${TOKEN_A}${MOD_REPORT_PATH}`, report(B)),
      await post(r.base, `/h/${TOKEN_A}${MOD_PROMPT_PATH}`, origin(B))
    ]).toEqual([403, 403, 403])
    expect([
      r.onHookEvent.mock.calls,
      r.onModReport.mock.calls,
      r.onModPrompt.mock.calls,
      r.takePendingTitle.mock.calls
    ]).toEqual([[], [], [], []])
    expect(r.logs).toEqual([
      { path: '(channel)', code: 'channel_session_mismatch' },
      { path: '(channel)', code: 'channel_session_mismatch' },
      { path: '(channel)', code: 'channel_session_mismatch' }
    ])
  })

  it("A's token naming an id no card holds still reaches onHookEvent (a /clear's new id before the rebind)", async () => {
    const r = await start()
    expect(await post(r.base, `/h/${TOKEN_A}/`, hook(NEW_ID))).toBe(200)
    expect(r.onHookEvent.mock.calls.map(([e]) => e.session_id)).toEqual([NEW_ID])
  })

  it("after a /clear rebind, A's token speaks for the new id", async () => {
    const r = await start()
    r.channel.rebind(A, NEW_ID)
    expect(await post(r.base, `/h/${TOKEN_A}/`, hook(NEW_ID))).toBe(200)
  })

  it('a token revoked mid-body: 401 at the body end, no handler', async () => {
    const r = await start()
    const body = hook(A)
    const u = new URL(r.base)
    const reply = new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: u.hostname,
          port: Number(u.port),
          path: `/h/${TOKEN_A}/`,
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.write(body.slice(0, 10))
      // The card is removed after the headers were let in, before the body ends.
      void r.headersSeen.then(() => {
        r.channel.revoke(A)
        req.end(body.slice(10))
      })
    })
    expect(await reply).toBe(401)
    expect([r.onHookEvent.mock.calls, r.takePendingTitle.mock.calls]).toEqual([[], []])
  })

  it('without a token an oversized body is 401, not 400, and an unfinished one is not a hang', async () => {
    const r = await start()
    expect([
      await post(r.base, '/', 'x'.repeat(MAX_BODY_BYTES + 1)),
      await unfinished(r.base, MOD_REPORT_PATH)
    ]).toEqual([401, 401])
    expect(r.logs).not.toContainEqual({ path: '(body)', code: 'body_too_large' })
  })

  it('an unknown route after a live token is 404 and never a hook', async () => {
    const r = await start()
    expect(await post(r.base, `/h/${TOKEN_A}/mod/elsewhere`, hook(A))).toBe(404)
    expect(r.onHookEvent).not.toHaveBeenCalled()
  })

  it('no log line holds a token or a request URL', async () => {
    const r = await start()
    await post(r.base, `/h/${'0c'.repeat(32)}/`, hook(A))
    await post(r.base, `/h/${TOKEN_A}/`, hook(B))
    await post(r.base, `/h/${TOKEN_A}/`, '{not json')
    const logged = JSON.stringify(r.logs)
    expect(r.logs).toHaveLength(3)
    expect([
      logged.includes(TOKEN_A),
      logged.includes('0c'.repeat(32)),
      logged.includes('/h/'),
      logged.includes('127.0.0.1')
    ]).toEqual([false, false, false, false])
  })
})
