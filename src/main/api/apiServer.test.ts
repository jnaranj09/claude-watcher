// Programmatic API — the HTTP listener's tests. They drive the REAL `createApiServer` on an
// ephemeral 127.0.0.1 port (the `hookServer.test.ts` pattern), so reverting any guard —
// the bearer check, the body cap, the output validation, the stream cap — turns one red.
//
// The commands below are TEST doubles, not the shipped ones: the router must be provable on a
// route whose failure modes we control (a handler that throws, one whose output is wrong, a
// stream that answers an error before it starts).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { get as httpGet, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { defineCommand, type ApiErr } from './registry'
import { ApiErrorBodySchema, EmptySchema } from '../../shared/schemas/api'
import { createApiServer, matchPath, type ApiServer } from './apiServer'
import { startTestServer, call, makeFakeContext, TEST_TOKEN } from './testSupport'
import { API_MAX_BODY_BYTES } from './apiContract'

const echo = defineCommand({
  id: 'test.echo',
  method: 'POST',
  path: '/v1/echo/{id}',
  summary: 'echo',
  params: z.object({ id: z.string().min(1) }).strict(),
  query: z.object({ q: z.string().optional() }).strict(),
  body: z.object({ n: z.number() }).strict(),
  output: z.object({ id: z.string(), q: z.string().optional(), n: z.number() }).strict(),
  successStatus: 201,
  errorStatuses: [400, 401],
  async handler(_ctx, { params, query, body }) {
    return {
      ok: true,
      status: 201,
      body: { id: params.id, ...(query.q !== undefined ? { q: query.q } : {}), n: body.n }
    }
  }
})

const bad = defineCommand({
  id: 'test.bad',
  method: 'GET',
  path: '/v1/bad',
  summary: 'bad output',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: z.object({ must: z.string() }).strict(),
  successStatus: 200,
  errorStatuses: [],
  async handler() {
    return { ok: true, status: 200, body: { wrong: 1 } as unknown as { must: string } }
  }
})

const throws = defineCommand({
  id: 'test.throws',
  method: 'GET',
  path: '/v1/throws',
  summary: 't',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: EmptySchema,
  successStatus: 200,
  errorStatuses: [],
  async handler() {
    throw new Error('SECRET VALUE')
  }
})

const stream = defineCommand({
  id: 'test.stream',
  method: 'GET',
  path: '/v1/stream/{id}',
  summary: 's',
  params: z.object({ id: z.string() }).strict(),
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [404],
  async stream(_ctx, { params }, sink) {
    if (params.id === 'missing') return { ok: false, status: 404, code: 'session_not_found' }
    sink.start()
    sink.send('hello', { id: params.id }, 1)
    return null
  }
})

/** Starts and then sends NOTHING — the only bytes it ever produces are the keep-alive pings. */
const idle = defineCommand({
  id: 'test.idle',
  method: 'GET',
  path: '/v1/idle',
  summary: 'idle',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [],
  async stream(_ctx, _input, sink) {
    sink.start()
    return null
  }
})

/** The sink is already ended when the command registers its cleanup (a fast disconnect). */
const closeRan = { early: false }
const earlyClose = defineCommand({
  id: 'test.earlyClose',
  method: 'GET',
  path: '/v1/early-close',
  summary: 'e',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [],
  async stream(_ctx, _input, sink) {
    sink.start()
    sink.end()
    sink.onClose(() => {
      closeRan.early = true
    })
    return null
  }
})

/** Neither `handler` nor `stream` — a programming error, not a caller error. */
const neither = defineCommand({
  id: 'test.neither',
  method: 'GET',
  path: '/v1/neither',
  summary: 'n',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: EmptySchema,
  successStatus: 200,
  errorStatuses: []
})

/** BOTH — the documented policy is that `stream` wins, so this answers the stream's 404. */
const both = defineCommand({
  id: 'test.both',
  method: 'GET',
  path: '/v1/both',
  summary: 'b',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [404],
  async handler() {
    return { ok: true, status: 200, body: { from: 'handler' } }
  },
  async stream() {
    return { ok: false, status: 404, code: 'session_not_found' } satisfies ApiErr
  }
})

/** Open an SSE request; resolve with the first `bytes` of the body, then destroy the socket. */
function readStream(
  url: string,
  path: string,
  bytes: number,
  token = TEST_TOKEN
): Promise<{ status: number; type: string | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = httpGet(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        headers: { authorization: `Bearer ${token}` }
      },
      (res) => {
        let text = ''
        res.on('data', (c: Buffer) => {
          text += c.toString('utf8')
          if (text.length >= bytes) {
            req.destroy()
            resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], text })
          }
        })
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], text })
        )
      }
    )
    req.on('error', reject)
  })
}

let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

describe('matchPath', () => {
  it('binds {name} segments and rejects other shapes', () => {
    expect(matchPath('/v1/sessions/{id}/events', '/v1/sessions/abc/events')).toEqual({ id: 'abc' })
    expect(matchPath('/v1/sessions/{id}', '/v1/sessions/abc/events')).toBeNull()
    expect(matchPath('/v1/sessions', '/v1/sessions/')).toBeNull()
    expect(matchPath('/v1/sessions/{id}', '/v1/sessions/a%20b')).toEqual({ id: 'a b' })
  })
})

describe('createApiServer', () => {
  it('401 without a token, with a wrong one, and with the wrong scheme', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx)
    server = s.server
    for (const token of [null, 'b'.repeat(64), 'a'.repeat(63)]) {
      const r = await call(s.url, 'POST', '/v1/echo/x', { body: '{"n":1}', token })
      expect(r.status).toBe(401)
      expect(JSON.parse(r.text)).toEqual({ error: { code: 'unauthorized' } })
      // The response body is the wire contract, so hold it to the schema here.
      expect(ApiErrorBodySchema.safeParse(JSON.parse(r.text)).success).toBe(true)
    }
    // The wrong SCHEME — bearerOk's `!header.startsWith('Bearer ')` branch, which no wrong
    // token ever reaches.
    const basic = await call(s.url, 'POST', '/v1/echo/x', {
      body: '{"n":1}',
      rawAuthorization: `Basic ${Buffer.from('x:y').toString('base64')}`
    })
    expect(basic.status).toBe(401)
    expect(JSON.parse(basic.text)).toEqual({ error: { code: 'unauthorized' } })
  })

  it('reads the token through the getter on EVERY request (a regenerate takes effect)', async () => {
    const { ctx } = makeFakeContext()
    let token = TEST_TOKEN
    const s = await new Promise<{ server: ApiServer; url: string }>((resolve) => {
      const srv = createApiServer({
        commands: [echo],
        context: ctx,
        token: () => token,
        port: 0,
        host: '127.0.0.1',
        log: () => {},
        onListening: (port) => resolve({ server: srv, url: `http://127.0.0.1:${port}` })
      })
    })
    server = s.server
    expect((await call(s.url, 'POST', '/v1/echo/x', { body: '{"n":1}' })).status).toBe(201)
    token = 'c'.repeat(64)
    expect((await call(s.url, 'POST', '/v1/echo/x', { body: '{"n":1}' })).status).toBe(401)
    expect(
      (await call(s.url, 'POST', '/v1/echo/x', { body: '{"n":1}', token: 'c'.repeat(64) })).status
    ).toBe(201)
  })

  it('routes params + query + body into the handler and validates the output', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx)
    server = s.server
    const r = await call(s.url, 'POST', '/v1/echo/abc?q=hi', { body: '{"n":2}' })
    expect(r.status).toBe(201)
    expect(r.headers['content-type']).toContain('application/json')
    expect(JSON.parse(r.text)).toEqual({ id: 'abc', q: 'hi', n: 2 })
  })

  it('400 invalid_request with the issue PATH, and the log never carries the value', async () => {
    const log = vi.fn()
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx, { log })
    server = s.server
    const r = await call(s.url, 'POST', '/v1/echo/abc', { body: '{"n":"SECRETVALUE"}' })
    expect(r.status).toBe(400)
    expect(JSON.parse(r.text)).toEqual({ error: { code: 'invalid_request', path: 'n' } })
    expect(String(log.mock.calls)).not.toContain('SECRETVALUE')
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][api] code=invalid_request route=test.echo path=n'
    )
  })

  it('400 invalid_json and body_too_large', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx)
    server = s.server
    expect((await call(s.url, 'POST', '/v1/echo/abc', { body: '{nope' })).status).toBe(400)
    expect(
      JSON.parse((await call(s.url, 'POST', '/v1/echo/abc', { body: '{nope' })).text).error.code
    ).toBe('invalid_json')
    const big = await call(s.url, 'POST', '/v1/echo/abc', {
      rawBody: Buffer.alloc(API_MAX_BODY_BYTES + 1, 0x20)
    })
    expect(big.status).toBe(400)
    expect(JSON.parse(big.text).error.code).toBe('body_too_large')
  })

  it('404 not_found for an unknown route and 405 for a known route with another method', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx)
    server = s.server
    expect(JSON.parse((await call(s.url, 'GET', '/v1/nope')).text).error.code).toBe('not_found')
    const r = await call(s.url, 'GET', '/v1/echo/abc')
    expect(r.status).toBe(405)
    expect(JSON.parse(r.text).error.code).toBe('method_not_allowed')
  })

  it('a handler whose output fails validation answers 500 internal; a throw too, value-free', async () => {
    const log = vi.fn()
    const { ctx } = makeFakeContext()
    const s = await startTestServer([bad, throws], ctx, { log })
    server = s.server
    const badRes = await call(s.url, 'GET', '/v1/bad')
    expect(badRes.status).toBe(500)
    // The unvalidated body must NOT be what lands: the whole point is that it never ships.
    expect(JSON.parse(badRes.text)).toEqual({ error: { code: 'internal' } })
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][api] code=invalid_output route=test.bad path=must'
    )
    const r = await call(s.url, 'GET', '/v1/throws')
    expect(r.status).toBe(500)
    expect(r.text).not.toContain('SECRET VALUE')
    expect(String(log.mock.calls)).not.toContain('SECRET VALUE')
    expect(log).toHaveBeenCalledWith('[claude-watcher][api] code=handler_threw route=test.throws')
  })

  it('a command with NEITHER handler nor stream answers 500 internal; with BOTH, stream wins', async () => {
    const log = vi.fn()
    const { ctx } = makeFakeContext()
    const s = await startTestServer([neither, both], ctx, { log })
    server = s.server
    const r = await call(s.url, 'GET', '/v1/neither')
    expect(r.status).toBe(500)
    expect(JSON.parse(r.text).error.code).toBe('internal')
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][api] code=command_misconfigured route=test.neither'
    )
    // `both` would answer 200 through its handler; the stream's pre-start error is what lands.
    const b = await call(s.url, 'GET', '/v1/both')
    expect(b.status).toBe(404)
    expect(JSON.parse(b.text).error.code).toBe('session_not_found')
  })

  it('serves a public route without a token, and still guards every other path', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([echo], ctx, {
      publicRoutes: ({ method, path }) =>
        method === 'GET' && path === '/openapi.json'
          ? { status: 200, contentType: 'application/json', body: '{"openapi":"3.1.0"}' }
          : null
    })
    server = s.server
    const r = await call(s.url, 'GET', '/openapi.json', { token: null })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('application/json')
    expect(r.text).toBe('{"openapi":"3.1.0"}')
    expect((await call(s.url, 'GET', '/v1/nope', { token: null })).status).toBe(401)
  })

  it('a stream command answers JSON errors before start, and SSE frames after', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([stream], ctx)
    server = s.server
    expect((await call(s.url, 'GET', '/v1/stream/missing')).status).toBe(404)
    const r = await readStream(s.url, '/v1/stream/abc', 10)
    expect(r.status).toBe(200)
    expect(r.type).toBe('text/event-stream')
    expect(r.text).toBe('id: 1\nevent: hello\ndata: {"id":"abc"}\n\n')
    await vi.waitFor(() => expect(s.server.streams()).toBe(0)) // destroy() → onClose → freed
  })

  it('keeps an idle stream alive with `: ping` comments at pingMs', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([idle], ctx, { pingMs: 10 })
    server = s.server
    const r = await readStream(s.url, '/v1/idle', 8)
    expect(r.text).toContain(': ping\n\n')
  })

  it('runs an onClose registered AFTER the sink ended (a fast disconnect must not leak)', async () => {
    closeRan.early = false
    const { ctx } = makeFakeContext()
    const s = await startTestServer([earlyClose], ctx)
    server = s.server
    const r = await call(s.url, 'GET', '/v1/early-close')
    expect(r.status).toBe(200)
    await vi.waitFor(() => expect(closeRan.early).toBe(true))
    expect(s.server.streams()).toBe(0)
  })

  it('caps open streams (503 too_many_streams past the cap)', async () => {
    const { ctx } = makeFakeContext()
    const s = await startTestServer([stream], ctx, { maxStreams: 1 })
    server = s.server
    const holdOpen = new Promise<void>((resolve) => {
      const u = new URL(s.url)
      httpGet(
        {
          hostname: u.hostname,
          port: Number(u.port),
          path: '/v1/stream/one',
          headers: { authorization: `Bearer ${TEST_TOKEN}` }
        },
        () => resolve()
      )
    })
    await holdOpen
    await vi.waitFor(() => expect(s.server.streams()).toBe(1))
    const r = await call(s.url, 'GET', '/v1/stream/two')
    expect(r.status).toBe(503)
    expect(JSON.parse(r.text).error.code).toBe('too_many_streams')
  })
})

describe('createApiServer — a bind failure is logged, never swallowed', () => {
  it('logs code=listen_failed when the port is already taken, and does not throw', async () => {
    const log = vi.fn()
    const { ctx } = makeFakeContext()
    const blocker = createServer((_req, res) => {
      res.writeHead(200).end()
    })
    const port = await new Promise<number>((resolve, reject) => {
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as AddressInfo).port))
      blocker.on('error', reject)
    })

    const srv = createApiServer({
      commands: [echo],
      context: ctx,
      token: () => TEST_TOKEN,
      port,
      host: '127.0.0.1',
      log
    })
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith('[claude-watcher][api] code=listen_failed errno=EADDRINUSE')
    )

    srv.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})
