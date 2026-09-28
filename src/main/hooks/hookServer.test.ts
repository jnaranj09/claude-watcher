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
import { MAX_BODY_BYTES } from './hookContract'
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'

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
      { hostname: u.hostname, port: Number(u.port), path: u.pathname, method, headers },
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
      log,
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        resolve({ close: () => srv.close(), url: `http://127.0.0.1:${port}/` })
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
      log,
      port: blockerPort,
      host: '127.0.0.1'
    })

    // Wait for the 'error' event to fire.
    await new Promise((r) => setTimeout(r, 100))

    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
    expect(logged?.code).toBe('eaddrinuse')

    // Cleanup — no crash
    srv2.close()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  })
})
