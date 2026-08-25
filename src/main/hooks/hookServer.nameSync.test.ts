// Name-sync — the hook server's RESPONSE half, driven end-to-end over real HTTP.
//
// Until this feature the server was write-only from claude's side: every valid POST got an
// empty 200. Claude's `type: "http"` hook actually reads the response BODY as hook output,
// which is the only supported way to rename a session that is already running. These tests
// drive the REAL createHookServer on an ephemeral port and read the bytes off the wire, so
// reverting the response wiring in hookServer.ts turns a test red (the repo's fault-injection
// convention — a hand-copied handler would prove nothing).
// [spec-claude-session-name-sync.md; .claude/rules/zod-boundaries.md]

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHookServer, type HookServer } from './hookServer'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { createPendingTitles } from './pendingTitles'
import { request as httpRequest } from 'node:http'

interface Reply {
  status: number
  body: string
  contentType: string | undefined
}

/** POST a body and capture the FULL response — status, body bytes and content-type. */
function post(url: string, body: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let out = ''
        res.on('data', (c) => (out += c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: out,
            contentType: res.headers['content-type']
          })
        )
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

let open: HookServer | null = null
afterEach(() => {
  open?.close()
  open = null
})

/** Start the REAL server with a name-sync seam wired in. */
function start(opts: {
  takePendingTitle?: (sessionId: string) => string | null
  onHookEvent?: (evt: HookEvent) => void
  log?: (err: BoundaryErrorRecord) => void
}): Promise<string> {
  return new Promise((resolve) => {
    const srv = createHookServer({
      onHookEvent: opts.onHookEvent ?? ((): void => {}),
      ...(opts.takePendingTitle !== undefined ? { takePendingTitle: opts.takePendingTitle } : {}),
      log: opts.log ?? ((): void => {}),
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => resolve(`http://127.0.0.1:${port}/`)
    })
    open = srv
  })
}

const promptSubmit = (sessionId: string): string =>
  JSON.stringify({ session_id: sessionId, hook_event_name: 'UserPromptSubmit', prompt: 'hi' })

describe('hook server — name-sync response', () => {
  it('answers UserPromptSubmit with the sessionTitle block when a rename is pending', async () => {
    const pending = createPendingTitles()
    pending.set('sess-1', 'billing api')
    const url = await start({ takePendingTitle: (id) => pending.take(id) })

    const reply = await post(url, promptSubmit('sess-1'))

    expect(reply.status).toBe(200)
    expect(reply.contentType).toContain('application/json')
    expect(JSON.parse(reply.body)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        sessionTitle: 'billing api'
      }
    })
  })

  it('pushes ONCE — the next prompt for the same session gets an empty 200', async () => {
    const pending = createPendingTitles()
    pending.set('sess-1', 'billing api')
    const url = await start({ takePendingTitle: (id) => pending.take(id) })

    const first = await post(url, promptSubmit('sess-1'))
    const second = await post(url, promptSubmit('sess-1'))

    expect(first.body).not.toBe('')
    // Re-pushing every prompt would fight claude's live-name collision rule and mint a
    // fresh suffix each time — the name would never settle.
    expect(second.body).toBe('')
  })

  it('keeps the historical empty 200 when nothing is pending', async () => {
    const pending = createPendingTitles()
    const url = await start({ takePendingTitle: (id) => pending.take(id) })

    const reply = await post(url, promptSubmit('sess-1'))

    expect(reply.status).toBe(200)
    expect(reply.body).toBe('')
  })

  it('does not answer a DIFFERENT session with a pending name meant for another', async () => {
    const pending = createPendingTitles()
    pending.set('sess-1', 'billing api')
    const url = await start({ takePendingTitle: (id) => pending.take(id) })

    const reply = await post(url, promptSubmit('sess-2'))

    expect(reply.body).toBe('')
    // sess-1's rename is untouched and still deliverable.
    expect(pending.take('sess-1')).toBe('billing api')
  })

  it('a Stop arriving first does NOT consume the pending rename', async () => {
    const pending = createPendingTitles()
    pending.set('sess-1', 'billing api')
    const url = await start({ takePendingTitle: (id) => pending.take(id) })

    const stop = await post(url, JSON.stringify({ session_id: 'sess-1', hook_event_name: 'Stop' }))
    expect(stop.body).toBe('')

    // The name survived the wrong event, so the operator's next prompt still delivers it.
    const submit = await post(url, promptSubmit('sess-1'))
    expect(JSON.parse(submit.body).hookSpecificOutput.sessionTitle).toBe('billing api')
  })

  it('with NO takePendingTitle seam, behaves exactly as before — always an empty 200', async () => {
    const url = await start({})

    const reply = await post(url, promptSubmit('sess-1'))

    expect(reply.status).toBe(200)
    expect(reply.body).toBe('')
  })

  it('never-crash: a throwing seam still answers 200, and logs CODE only — never the name', async () => {
    const log = vi.fn()
    const url = await start({
      takePendingTitle: () => {
        throw new Error('boom: billing api')
      },
      log
    })

    const reply = await post(url, promptSubmit('sess-1'))

    // One bad response must not cost every other session its ingest.
    expect(reply.status).toBe(200)
    expect(reply.body).toBe('')
    expect(log).toHaveBeenCalledWith({ path: '(response)', code: 'hook_response_error' })

    // Guardrail #6 — no logged line may carry the session name.
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('billing api')
  })

  it('still delivers the event to onHookEvent when it answers with a body', async () => {
    const pending = createPendingTitles()
    pending.set('sess-1', 'billing api')
    const seen: HookEvent[] = []
    const url = await start({
      takePendingTitle: (id) => pending.take(id),
      onHookEvent: (e) => seen.push(e)
    })

    await post(url, promptSubmit('sess-1'))

    // The status pipeline must not be shortcut by the new response path.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.hook_event_name).toBe('UserPromptSubmit')
  })

  it('a rejected body never reaches the response builder (400, seam untouched)', async () => {
    const take = vi.fn(() => 'billing api')
    const url = await start({ takePendingTitle: take })

    // Blank session_id fails closed at the Zod boundary.
    const reply = await post(
      url,
      JSON.stringify({ session_id: '', hook_event_name: 'UserPromptSubmit' })
    )

    expect(reply.status).toBe(400)
    expect(take).not.toHaveBeenCalled()
  })
})
