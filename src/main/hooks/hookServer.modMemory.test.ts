// A token route on the hook listener (memory phase 3, the `watcher-memory` mod's routes): the REAL
// createHookServer on an ephemeral port with a stand-in `TokenRoute`, so reverting the bearer,
// Origin, 404, re-open or log guard turns a test red. The bodies carry prompt text: nothing of a
// body may reach a log.
import { describe, it, expect, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { createHookServer, type TokenRoute, type TokenRouteAnswer } from './hookServer'
import { MAX_BODY_BYTES } from './hookContract'
import { createHookChannel } from './hookChannel'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { createMcpEndpoint, mcpRoute } from '../mcp/mcpEndpoint'
import { createSessionTokens } from '../mcp/sessionTokens'

const RECALL = '/mod/memory/recall'
const MCP_PATH = '/mcp/goals'

interface Reply {
  status: number
  body: string
}

interface Rig {
  base: string
  /** The hook channel path a hook posts to (`/h/<token>/`, T-D13). */
  hookPath: string
  close: () => void
  handled: unknown[]
  hookEvents: HookEvent[]
  boundaryLog: BoundaryErrorRecord[]
  routeLog: string[]
  mcpToken: string
}

let rig: Rig | null = null
afterEach(() => {
  rig?.close()
  rig = null
})

type Handler = (body: unknown) => TokenRouteAnswer
const answerOk: Handler = () => ({ status: 200, body: { ok: true, text: 'T' } })

/** `opens` decides each `open` call in turn: true = a handler, false = null; past its end, the
 *  bearer decides (`Bearer good`). */
function start(handler: Handler = answerOk, opens: boolean[] = []): Promise<Rig> {
  const handled: unknown[] = []
  const hookEvents: HookEvent[] = []
  const boundaryLog: BoundaryErrorRecord[] = []
  const routeLog: string[] = []
  let call = 0
  const route: TokenRoute = {
    path: RECALL,
    open(authorization) {
      const scripted = opens[call++]
      const live = scripted ?? authorization === 'Bearer good'
      if (!live) return null
      return (body) => {
        handled.push(body)
        return handler(body)
      }
    },
    log: (line) => routeLog.push(line)
  }
  const mcpTokens = createSessionTokens<{ sessionId: string }>()
  const mcpToken = mcpTokens.mint({ sessionId: 's1' })
  const endpoint = createMcpEndpoint<{ sessionId: string }>({
    tokens: mcpTokens,
    tools: { list: () => [], call: () => ({ kind: 'invalid_params' }) },
    serverName: 'goals-like',
    area: 'goals',
    log: () => {}
  })
  const channel = createHookChannel()
  const hookToken = channel.mint({ sessionId: 's' })
  return new Promise((resolve) => {
    const s = createHookServer({
      onHookEvent: (evt) => hookEvents.push(evt),
      channel: { resolve: (t) => channel.resolve(t), isLive: () => false },
      log: (err) => boundaryLog.push(err),
      mcpRoutes: [mcpRoute(MCP_PATH, endpoint, () => {})],
      tokenRoutes: [route],
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        rig = {
          base: `http://127.0.0.1:${port}`,
          hookPath: `/h/${hookToken}/`,
          close: () => s.close(),
          handled,
          hookEvents,
          boundaryLog,
          routeLog,
          mcpToken
        }
        resolve(rig)
      }
    })
  })
}

function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Reply> {
  const r = rig
  if (r === null) throw new Error('no rig')
  const u = new URL(r.base)
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

describe('hookServer — a token route (the memory mod)', () => {
  it('without a bearer is 401 before the body is read: an oversized body is not 400, an unfinished one is not a hang', async () => {
    const r = await start()
    const big = await post(RECALL, 'x'.repeat(MAX_BODY_BYTES + 1))
    const u = new URL(r.base)
    const unfinished = new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: u.hostname,
          port: Number(u.port),
          path: RECALL,
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
      req.write('{"version"') // headers out, the body never ends
    })
    expect([big.status, await unfinished]).toEqual([401, 401])
    expect(r.handled).toEqual([])
    expect(r.routeLog).toEqual([
      'route=mod_memory code=unauthorized',
      'route=mod_memory code=unauthorized'
    ])
  })

  it('an Origin header is 403 even with a good bearer', async () => {
    const r = await start()
    expect(
      (await post(RECALL, '{}', { authorization: 'Bearer good', origin: 'https://acme.test' }))
        .status
    ).toBe(403)
    expect(r.handled).toEqual([])
  })

  it('an unknown path under /mod/memory/ is 404 and never a hook', async () => {
    const r = await start()
    expect(
      (
        await post('/mod/memory/nope', '{"session_id":"s","hook_event_name":"Stop"}', {
          authorization: 'Bearer good'
        })
      ).status
    ).toBe(404)
    expect(r.hookEvents).toEqual([])
  })

  it("a good bearer gets the handler's JSON", async () => {
    const r = await start()
    const res = await post(RECALL, '{"a":1}', { authorization: 'Bearer good' })
    expect([res.status, JSON.parse(res.body), r.handled]).toEqual([
      200,
      { ok: true, text: 'T' },
      [{ a: 1 }]
    ])
  })

  it('a token revoked while the body arrives is 401 at the body end, and the handler never runs', async () => {
    const r = await start(answerOk, [true, false])
    const res = await post(RECALL, '{"a":1}', { authorization: 'Bearer good' })
    expect([res.status, r.handled]).toEqual([401, []])
    expect(r.routeLog).toEqual(['route=mod_memory code=unauthorized'])
  })

  it("a handler's 400 logs path and code only", async () => {
    const r = await start(() => ({ status: 400, path: 'text', code: 'too_big' }))
    const res = await post(RECALL, '{"text":"SECRET-PROMPT"}', { authorization: 'Bearer good' })
    expect([res.status, res.body]).toEqual([400, ''])
    expect(r.boundaryLog).toEqual([{ path: 'text', code: 'too_big' }])
    expect(JSON.stringify([r.boundaryLog, r.routeLog])).not.toContain('SECRET-PROMPT')
  })

  it('a handler throw is 500 with a code, and the server keeps serving', async () => {
    let first = true
    const r = await start(() => {
      if (first) {
        first = false
        throw new Error('SECRET-PROMPT')
      }
      return { status: 200, body: { ok: true, text: 'T' } }
    })
    const auth = { authorization: 'Bearer good' }
    const failed = await post(RECALL, '{}', auth)
    const next = await post(RECALL, '{}', auth)
    expect([failed.status, next.status]).toEqual([500, 200])
    expect(r.routeLog).toEqual(['route=mod_memory code=mod_memory_handler_error'])
  })

  it('an answer that cannot become JSON is 500 with a code, and the server keeps serving', async () => {
    const r = await start(() => ({ status: 200, body: { ok: true, text: 10n } }))
    const auth = { authorization: 'Bearer good' }
    const failed = await post(RECALL, '{"text":"SECRET-PROMPT"}', auth)
    const hook = await post(r.hookPath, '{"session_id":"s","hook_event_name":"Stop"}')
    expect([failed.status, failed.body, hook.status]).toEqual([500, '', 200])
    expect(r.routeLog).toEqual(['route=mod_memory code=mod_memory_handler_error'])
    expect(JSON.stringify([r.boundaryLog, r.routeLog])).not.toContain('SECRET-PROMPT')
  })

  it('a hook POST and an MCP route still work beside a token route', async () => {
    const r = await start()
    const hook = await post(r.hookPath, '{"session_id":"s","hook_event_name":"Stop"}')
    const init = JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' }
    })
    const mcp = await post(MCP_PATH, init, { authorization: `Bearer ${r.mcpToken}` })
    const crossed = await post(MCP_PATH, init, { authorization: 'Bearer good' })
    expect([hook.status, mcp.status, crossed.status]).toEqual([200, 200, 401])
    expect(r.hookEvents).toMatchObject([{ session_id: 's', hook_event_name: 'Stop' }])
    expect(JSON.parse(mcp.body)).toMatchObject({ result: { serverInfo: { name: 'goals-like' } } })
    expect(r.handled).toEqual([])
  })
})
