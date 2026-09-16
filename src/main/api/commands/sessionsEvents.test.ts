// Programmatic API — `GET /v1/sessions/{id}/events`. Driven through the REAL server, because the
// sink IS the server's: the frame format, the ping interval, the stream cap and the disconnect →
// `onClose` path all live in `apiServer.ts`, and a hand-rolled sink would prove none of them.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { get as httpGet } from 'node:http'
import { sessionsEventsCommand } from './sessionsEvents'
import { startTestServer, call, makeFakeContext, makeFakeSeam, TEST_TOKEN } from '../testSupport'
import type { ApiServer } from '../apiServer'
import type { ApiSession } from '../../../shared/schemas/api'

const S: ApiSession = {
  id: 's1',
  sessionName: 'HT-1',
  status: 'Connecting',
  column: 'working',
  enteredColumnAt: 1,
  workspaceId: 'default',
  tagIds: [],
  projectPath: '/w'
}
let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

/** Collect the stream until the server ends it (or `until` bytes arrived). */
function collect(
  url: string,
  path: string,
  until = Infinity
): Promise<{ status: number; text: string; ended: boolean }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = httpGet(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        headers: { authorization: `Bearer ${TEST_TOKEN}` }
      },
      (res) => {
        let text = ''
        res.on('data', (c: Buffer) => {
          text += c.toString()
          if (text.length >= until) {
            req.destroy()
            resolve({ status: res.statusCode ?? 0, text, ended: false })
          }
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, ended: true }))
      }
    )
    req.on('error', reject)
  })
}

describe('GET /v1/sessions/{id}/events', () => {
  it('404 session_not_found as plain JSON', async () => {
    const { ctx } = makeFakeContext({ seam: makeFakeSeam([]) })
    const s = await startTestServer([sessionsEventsCommand], ctx)
    server = s.server
    const r = await call(s.url, 'GET', '/v1/sessions/zz/events')
    expect(r.status).toBe(404)
    expect(JSON.parse(r.text).error.code).toBe('session_not_found')
  })

  it('503 no_window as plain JSON', async () => {
    const { ctx } = makeFakeContext({ seam: null })
    const s = await startTestServer([sessionsEventsCommand], ctx)
    server = s.server
    const r = await call(s.url, 'GET', '/v1/sessions/s1/events')
    expect(r.status).toBe(503)
    expect(JSON.parse(r.text).error.code).toBe('no_window')
  })

  it('sends the snapshot, then deltas for THIS id only, then removed + close', async () => {
    const seam = makeFakeSeam([S])
    const { ctx } = makeFakeContext({ seam })
    const s = await startTestServer([sessionsEventsCommand], ctx, { pingMs: 100_000 })
    server = s.server
    const done = collect(s.url, '/v1/sessions/s1/events')
    await vi.waitFor(() => expect(s.server.streams()).toBe(1))
    seam.emit({
      type: 'session.updated',
      id: 'other',
      sessionName: 'x',
      projectPath: '/w',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 2,
      pid: 1,
      workspaceId: 'default',
      tagIds: []
    })
    seam.emit({
      type: 'session.updated',
      id: 's1',
      sessionName: 'HT-1',
      projectPath: '/w',
      status: 'Working',
      column: 'working',
      enteredColumnAt: 2,
      pid: 1,
      workspaceId: 'default',
      tagIds: []
    })
    seam.emit({ type: 'session.removed', id: 's1', sessionName: 'HT-1', projectPath: '/w' })
    const r = await done
    expect(r.ended).toBe(true)
    const frames = r.text.trim().split('\n\n')
    expect(frames).toHaveLength(3)
    expect(frames[0]).toBe(`id: 1\nevent: session.updated\ndata: ${JSON.stringify(S)}`)
    expect(frames[1]).toContain('"status":"Working"')
    expect(frames[1]).not.toContain('"pid"')
    expect(frames[2]).toBe('id: 3\nevent: session.removed\ndata: {"id":"s1"}')
    expect(s.server.streams()).toBe(0)
  })

  it('a client disconnect unsubscribes', async () => {
    const seam = makeFakeSeam([S])
    const { ctx } = makeFakeContext({ seam })
    const s = await startTestServer([sessionsEventsCommand], ctx)
    server = s.server
    await collect(s.url, '/v1/sessions/s1/events', 5) // destroys after the first bytes
    await vi.waitFor(() => expect(s.server.streams()).toBe(0))
  })

  it('a client that closes right after the snapshot leaves ZERO hub subscribers', async () => {
    // The unsubscribe-race guard: a dropped `off` is invisible in `streams()` (the sink is gone)
    // and invisible in the frames (a send on a dead sink is a no-op). The hub is the only place
    // it shows.
    const seam = makeFakeSeam([S])
    const { ctx } = makeFakeContext({ seam })
    const s = await startTestServer([sessionsEventsCommand], ctx)
    server = s.server
    await collect(s.url, '/v1/sessions/s1/events', 1) // destroys on the very first byte
    await vi.waitFor(() => expect(s.server.streams()).toBe(0))
    await vi.waitFor(() => expect(seam.subscriberCount()).toBe(0))
  })
})
