// Hook-status feature — unit tests for createHookServer (the REAL production server).
//
// Runs under the `main-unit` Vitest project (node). Every handler test drives the
// ACTUAL createHookServer bound to an ephemeral port (port: 0) via the onListening
// readiness callback — NOT a hand-copied handler — so reverting any guard in
// hookServer.ts turns a test red (the project's fault-injection convention).
// [spec Tasks; spec hookServer.ts Code Map]

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHookServer, type HookServer } from './hookServer'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { MAX_BODY_BYTES, MOD_PROMPT_PATH, MOD_REPORT_PATH } from './hookContract'
import type { ModReport } from '../../shared/schemas/modReport'
import type { ModPrompt } from '../../shared/schemas/modPrompt'
import { modReportFixture } from '../../__fixtures__/modReport'
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHookChannel } from './hookChannel'

// Every request here goes through the hook channel (T-D13) under one live token, and no card is
// live, so the channel lets every session id through: these tests are about what comes after it
// (`hookServer.channel.test.ts` covers the channel itself).
const CHANNEL = createHookChannel()
const TOKEN = CHANNEL.mint({ sessionId: 'channel-test' })
const OPEN_CHANNEL = { resolve: (t: string) => CHANNEL.resolve(t), isLive: () => false }

// Make an HTTP request and resolve the status code (never rejects on 4xx/5xx).
function send(
  url: string,
  method: string,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers: Record<string, string | number> = {
      'content-type': 'application/json',
      ...extraHeaders
    }
    if (body !== undefined) headers['content-length'] = Buffer.byteLength(body)
    const req = httpRequest(
      { hostname: u.hostname, port: Number(u.port), path: u.pathname + u.search, method, headers },
      (res) => resolve(res.statusCode ?? 0)
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function post(url: string, body: string): Promise<number> {
  return send(url, 'POST', body)
}

// Start the REAL createHookServer on an ephemeral port; resolve once it is listening.
function startServer(
  onHookEvent: (evt: HookEvent) => void,
  log: (err: BoundaryErrorRecord) => void
): Promise<{ close: () => void; url: string }> {
  return new Promise((resolve) => {
    const srv: HookServer = createHookServer({
      onHookEvent,
      channel: OPEN_CHANNEL,
      log,
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        resolve({ close: () => srv.close(), url: `http://127.0.0.1:${port}/h/${TOKEN}/` })
      }
    })
  })
}

describe('hookServer — HTTP handler logic (real createHookServer on an ephemeral port)', () => {
  let srv: { close: () => void; url: string } | null = null

  afterEach(() => {
    srv?.close()
    srv = null
  })

  it('valid POST → onHookEvent called once with parsed event; responds 200', async () => {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    const status = await post(srv.url, body)
    expect(status).toBe(200)
    expect(onHookEvent).toHaveBeenCalledTimes(1)
    expect(onHookEvent.mock.calls[0]?.[0]?.session_id).toBe('aaaaaaaa-0000-4000-8000-000000000001')
    expect(onHookEvent.mock.calls[0]?.[0]?.hook_event_name).toBe('Stop')
    expect(log).not.toHaveBeenCalled()
  })

  it('non-POST method (GET) → 405; onHookEvent not called', async () => {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    const status = await send(srv.url, 'GET')
    expect(status).toBe(405)
    expect(onHookEvent).not.toHaveBeenCalled()
  })

  it('a POST carrying Origin (a browser) → 403, never parsed, origin never logged (SEC-2)', async () => {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    const status = await send(srv.url, 'POST', body, { origin: 'https://evil.example' })
    expect(status).toBe(403)
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith({ path: '(request)', code: 'origin_rejected' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('evil')
  })

  it('non-JSON body → 400 + log path+code only (never body)', async () => {
    const SECRET = 'SECRET_PROMPT_CONTENT'
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    const status = await post(srv.url, `not-json ${SECRET}`)
    expect(status).toBe(400)
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    // Body content must NEVER appear in the log
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
  })

  it('schema-invalid body (blank session_id) → 400 + log path+code only', async () => {
    const SECRET = 'secret-session-id'
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    const body = JSON.stringify({
      session_id: '',
      hook_event_name: 'Stop',
      last_assistant_message: SECRET
    })
    const status = await post(srv.url, body)
    expect(status).toBe(400)
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    // Body content (the secret) must NOT appear in the log
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
  })

  it('oversized body → 400 + log body_too_large; onHookEvent not called', async () => {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)

    // Build a body just over MAX_BODY_BYTES.
    const oversize = 'x'.repeat(MAX_BODY_BYTES + 1)
    const status = await post(srv.url, oversize)
    expect(status).toBe(400)
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]?.code).toBe('body_too_large')
  })

  // R22: a PostToolUse for a large file edit carries the whole file. 2 MiB was dropped under the
  // old 1 MiB cap and left the card on its old status.
  it('accepts a 2 MiB hook body (a large file edit)', async () => {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    srv = await startServer(onHookEvent, log)
    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'PostToolUse',
      tool_input: { content: 'x'.repeat(2 * 1024 * 1024) }
    })
    expect(await post(srv.url, body)).toBe(200)
    expect(onHookEvent).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('server never crashes: onHookEvent throwing is caught; responds 200', async () => {
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    let hookCalled = false
    srv = await startServer(() => {
      hookCalled = true
      throw new Error('simulated handler error with secret content')
    }, log)

    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    // Should NOT throw — server stays alive
    const status = await post(srv.url, body)
    expect(hookCalled).toBe(true)
    expect(status).toBe(200)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]?.code).toBe('hook_handler_error')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret content')
  })
})

describe('hookServer — EADDRINUSE tolerance (real createHookServer on a used port)', () => {
  it('logs eaddrinuse and does not throw when the port is already in use', async () => {
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    const onError = vi.fn<(errno: string) => void>()
    const onListening = vi.fn()

    // Bind a raw blocker on an ephemeral port, then read the actual port it took.
    const blocker = createServer((_req, res) => {
      res.writeHead(200).end()
    })
    const blockerPort = await new Promise<number>((resolve, reject) => {
      blocker.listen(0, '127.0.0.1', () => {
        const addr = blocker.address() as AddressInfo
        resolve(addr.port)
      })
      blocker.on('error', reject)
    })

    // createHookServer on the SAME port → deterministic EADDRINUSE (no vacuous guard).
    const srv2 = createHookServer({
      onHookEvent: vi.fn(),
      channel: OPEN_CHANNEL,
      log,
      port: blockerPort,
      host: '127.0.0.1',
      onError,
      onListening
    })

    // Wait for the 'error' event to fire.
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())

    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    expect(logged?.code).toBe('eaddrinuse')
    // UX-05 / SEC-6 — main learns the bind failed (the errno CODE only), and never that it bound.
    expect(onError).toHaveBeenCalledWith('EADDRINUSE')
    expect(onListening).not.toHaveBeenCalled()

    // Cleanup — no crash
    srv2.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})

describe('hookServer — the bridge mod report at /mod/report (spec 2026-10-18 §2)', () => {
  let srv: { close: () => void; base: string } | null = null
  afterEach(() => {
    srv?.close()
    srv = null
  })

  function start(): Promise<{
    onHookEvent: ReturnType<typeof vi.fn<(evt: HookEvent) => void>>
    onModReport: ReturnType<typeof vi.fn<(r: ModReport) => boolean>>
    log: ReturnType<typeof vi.fn<(err: BoundaryErrorRecord) => void>>
  }> {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const onModReport = vi.fn<(r: ModReport) => boolean>(() => true)
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    return new Promise((resolve) => {
      const s = createHookServer({
        onHookEvent,
        onModReport,
        channel: OPEN_CHANNEL,
        log,
        port: 0,
        host: '127.0.0.1',
        onListening: (port) => {
          srv = { close: () => s.close(), base: `http://127.0.0.1:${port}/h/${TOKEN}` }
          resolve({ onHookEvent, onModReport, log })
        }
      })
    })
  }

  it('a valid report goes to onModReport, never to onHookEvent; 200', async () => {
    const { onHookEvent, onModReport } = await start()
    const status = await post(`${srv!.base}${MOD_REPORT_PATH}`, JSON.stringify(modReportFixture()))
    expect(status).toBe(200)
    expect(onModReport).toHaveBeenCalledWith(modReportFixture())
    expect(onHookEvent).not.toHaveBeenCalled()
  })

  it('a report the setup drops (unknown session) is 409, so the mod sends it again', async () => {
    const { onModReport } = await start()
    onModReport.mockReturnValue(false)
    expect(await post(`${srv!.base}${MOD_REPORT_PATH}`, JSON.stringify(modReportFixture()))).toBe(
      409
    )
  })

  it('a hook body at / is still a hook', async () => {
    const { onHookEvent, onModReport } = await start()
    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    expect(await post(`${srv!.base}/`, body)).toBe(200)
    expect(onHookEvent).toHaveBeenCalledTimes(1)
    expect(onModReport).not.toHaveBeenCalled()
  })

  it('a report with an Origin header is refused 403 before the body is read', async () => {
    const { onModReport, log } = await start()
    const status = await send(
      `${srv!.base}${MOD_REPORT_PATH}`,
      'POST',
      JSON.stringify(modReportFixture()),
      {
        origin: 'https://evil.example'
      }
    )
    expect(status).toBe(403)
    expect(onModReport).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith({ path: '(request)', code: 'origin_rejected' })
  })

  it('an invalid report is 400 with path + code only, never a value', async () => {
    const { onModReport, onHookEvent, log } = await start()
    const bad = { ...modReportFixture(), env: { SECRET: '/work/app' } }
    expect(await post(`${srv!.base}${MOD_REPORT_PATH}`, JSON.stringify(bad))).toBe(400)
    expect(onModReport).not.toHaveBeenCalled()
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toContain('/work/app')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
  })

  it('a hook body sent to /mod/report is 400, not a hook', async () => {
    const { onHookEvent } = await start()
    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    expect(await post(`${srv!.base}${MOD_REPORT_PATH}`, body)).toBe(400)
    expect(onHookEvent).not.toHaveBeenCalled()
  })

  it('a report over the body cap is 400', async () => {
    const { onModReport } = await start()
    const huge = JSON.stringify(
      modReportFixture({
        instructionFiles: [{ path: 'x'.repeat(MAX_BODY_BYTES + 1), kind: 'user' }]
      })
    )
    expect(await post(`${srv!.base}${MOD_REPORT_PATH}`, huge)).toBe(400)
    expect(onModReport).not.toHaveBeenCalled()
  })

  it('a query string does not change the route', async () => {
    const { onModReport } = await start()
    expect(
      await post(`${srv!.base}${MOD_REPORT_PATH}?x=1`, JSON.stringify(modReportFixture()))
    ).toBe(200)
    expect(onModReport).toHaveBeenCalledTimes(1)
  })
})

describe('hookServer — the bridge mod prompt origin at /mod/prompt', () => {
  let srv: { close: () => void; base: string } | null = null
  afterEach(() => {
    srv?.close()
    srv = null
  })

  const PROMPT: ModPrompt = {
    version: 1,
    sessionId: 'aaaaaaaa-0000-4000-8000-0000000000aa',
    origin: 'composer'
  }

  function start(): Promise<{
    onHookEvent: ReturnType<typeof vi.fn<(evt: HookEvent) => void>>
    onModPrompt: ReturnType<typeof vi.fn<(p: ModPrompt) => boolean>>
    onModReport: ReturnType<typeof vi.fn<(r: ModReport) => boolean>>
    log: ReturnType<typeof vi.fn<(err: BoundaryErrorRecord) => void>>
  }> {
    const onHookEvent = vi.fn<(evt: HookEvent) => void>()
    const onModPrompt = vi.fn<(p: ModPrompt) => boolean>(() => true)
    const onModReport = vi.fn<(r: ModReport) => boolean>(() => true)
    const log = vi.fn<(err: BoundaryErrorRecord) => void>()
    return new Promise((resolve) => {
      const s = createHookServer({
        onHookEvent,
        onModPrompt,
        onModReport,
        channel: OPEN_CHANNEL,
        log,
        port: 0,
        host: '127.0.0.1',
        onListening: (port) => {
          srv = { close: () => s.close(), base: `http://127.0.0.1:${port}/h/${TOKEN}` }
          resolve({ onHookEvent, onModPrompt, onModReport, log })
        }
      })
    })
  }

  it('a valid origin goes to onModPrompt only; 200', async () => {
    const { onHookEvent, onModPrompt, onModReport } = await start()
    expect(await post(`${srv!.base}${MOD_PROMPT_PATH}`, JSON.stringify(PROMPT))).toBe(200)
    expect(onModPrompt).toHaveBeenCalledWith(PROMPT)
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(onModReport).not.toHaveBeenCalled()
  })

  it('an origin for a session that is not live is 409', async () => {
    const { onModPrompt } = await start()
    onModPrompt.mockReturnValue(false)
    expect(await post(`${srv!.base}${MOD_PROMPT_PATH}`, JSON.stringify(PROMPT))).toBe(409)
  })

  it('a bad body is 400 with path + code only, never a value', async () => {
    const { onModPrompt, onHookEvent, log } = await start()
    const bad = { ...PROMPT, text: 'SECRET PROMPT' }
    expect(await post(`${srv!.base}${MOD_PROMPT_PATH}`, JSON.stringify(bad))).toBe(400)
    expect(onModPrompt).not.toHaveBeenCalled()
    expect(onHookEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith({ path: '(root)', code: 'unrecognized_keys' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET PROMPT')
  })

  it('a handler that throws still answers 200 and logs its code', async () => {
    const { onModPrompt, log } = await start()
    onModPrompt.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await post(`${srv!.base}${MOD_PROMPT_PATH}`, JSON.stringify(PROMPT))).toBe(200)
    expect(log).toHaveBeenCalledWith({ path: '(mod_prompt)', code: 'mod_prompt_handler_error' })
  })
})
