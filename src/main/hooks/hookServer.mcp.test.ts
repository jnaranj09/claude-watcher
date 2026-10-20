// The goals MCP endpoint on the hook listener (spec 2026-10-19 goals): the REAL createHookServer on
// an ephemeral port with the real endpoint, tokens, tools and goals store, so reverting the bearer,
// Origin or authority guard turns a test red.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { createHookServer } from './hookServer'
import { GOALS_MCP_PATH, MAX_BODY_BYTES } from './hookContract'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { createGoalsStore, type GoalsStore } from '../persistence/goals'
import { createGoalTokens } from '../goals/mcp/goalTokens'
import { createMcpTools } from '../goals/mcp/mcpTools'
import { createMcpEndpoint, type McpEndpoint } from '../goals/mcp/mcpEndpoint'

interface Reply {
  status: number
  body: string
}

function send(
  base: string,
  path: string,
  method: string,
  body: string | undefined,
  headers: Record<string, string> = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const all: Record<string, string | number> = { 'content-type': 'application/json', ...headers }
    if (body !== undefined) all['content-length'] = Buffer.byteLength(body)
    const req = httpRequest(
      { hostname: u.hostname, port: Number(u.port), path, method, headers: all },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

interface Rig {
  base: string
  close: () => void
  token: string
  store: GoalsStore
  taskId: string
  otherTaskId: string
  onHookEvent: ReturnType<typeof vi.fn<(evt: HookEvent) => void>>
  log: ReturnType<typeof vi.fn<(err: BoundaryErrorRecord) => void>>
  mcpLines: string[]
}

let rig: Rig | null = null
afterEach(() => {
  rig?.close()
  rig = null
})

function start(withMcp = true, endpointOverride?: Partial<McpEndpoint>): Promise<Rig> {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 1 })
  const taskId = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'Mine' }).saved.id
  const otherTaskId = store.saveTask({ workspaceId: 'w1', goalId: null, title: 'Theirs' }).saved.id
  store.linkMany([taskId], 'sess-a')
  store.linkMany([otherTaskId], 'sess-b')
  const tokens = createGoalTokens()
  const token = tokens.mint({ sessionId: 'sess-a', workspaceId: 'w1', mode: 'worker' })
  const mcpLines: string[] = []
  const endpoint = createMcpEndpoint({
    tokens,
    tools: createMcpTools(() => store),
    log: (l) => mcpLines.push(l)
  })
  const onHookEvent = vi.fn<(evt: HookEvent) => void>()
  const log = vi.fn<(err: BoundaryErrorRecord) => void>()
  return new Promise((resolve) => {
    const s = createHookServer({
      onHookEvent,
      log,
      ...(withMcp
        ? { mcp: { ...endpoint, ...endpointOverride, log: (l: string) => mcpLines.push(l) } }
        : {}),
      port: 0,
      host: '127.0.0.1',
      onListening: (port) => {
        rig = {
          base: `http://127.0.0.1:${port}`,
          close: () => s.close(),
          token,
          store,
          taskId,
          otherTaskId,
          onHookEvent,
          log,
          mcpLines
        }
        resolve(rig)
      }
    })
  })
}

/** `id` null = a notification (no id at all). */
const rpc = (method: string, params?: unknown, id: number | null = 1): string =>
  JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params })

describe('hookServer — the goals MCP endpoint', () => {
  it('POST /mcp/goals without a bearer is 401 and logs no header value', async () => {
    const r = await start()
    const none = await send(r.base, GOALS_MCP_PATH, 'POST', rpc('tools/list'))
    const wrong = await send(r.base, GOALS_MCP_PATH, 'POST', rpc('tools/list'), {
      authorization: 'Bearer not-a-live-token-xyz'
    })
    const bare = await send(r.base, GOALS_MCP_PATH, 'POST', rpc('tools/list'), {
      authorization: r.token
    })
    expect([none.status, wrong.status, bare.status]).toEqual([401, 401, 401])
    expect([none.body, wrong.body, bare.body]).toEqual(['', '', ''])
    const logged = JSON.stringify([r.log.mock.calls, r.mcpLines])
    expect(logged).not.toContain('not-a-live-token-xyz')
    expect(logged).not.toContain(r.token)
    expect(r.mcpLines).toEqual([
      '[claude-watcher][goals] route=mcp code=unauthorized',
      '[claude-watcher][goals] route=mcp code=unauthorized',
      '[claude-watcher][goals] route=mcp code=unauthorized'
    ])
  })

  it('with an Origin header is 403, even with a live token', async () => {
    const r = await start()
    const res = await send(
      r.base,
      GOALS_MCP_PATH,
      'POST',
      rpc('tools/call', { name: 'mark_task_done', arguments: { taskId: r.taskId } }),
      { authorization: `Bearer ${r.token}`, origin: 'https://evil.example' }
    )
    expect(res.status).toBe(403)
    expect(r.store.view().tasks.find((t) => t.id === r.taskId)?.status).toBe('open')
  })

  it('a hook POST still works', async () => {
    const r = await start()
    const body = JSON.stringify({
      session_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      hook_event_name: 'Stop'
    })
    expect((await send(r.base, '/', 'POST', body)).status).toBe(200)
    expect(r.onHookEvent).toHaveBeenCalledTimes(1)
  })

  it('with a live bearer, initialize answers JSON and a notification is 202 with no body', async () => {
    const r = await start()
    const auth = { authorization: `Bearer ${r.token}` }
    const init = await send(
      r.base,
      GOALS_MCP_PATH,
      'POST',
      rpc('initialize', { protocolVersion: '2025-11-25' }, 0),
      auth
    )
    expect(init.status).toBe(200)
    expect(JSON.parse(init.body)).toMatchObject({
      id: 0,
      result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } }
    })
    const note = await send(
      r.base,
      GOALS_MCP_PATH,
      'POST',
      rpc('notifications/initialized', undefined, null),
      auth
    )
    expect(note).toEqual({ status: 202, body: '' })
    expect(r.onHookEvent).not.toHaveBeenCalled()
  })

  it("mark_task_done closes the caller's linked task and refuses another session's", async () => {
    const r = await start()
    const auth = { authorization: `Bearer ${r.token}` }
    const mine = await send(
      r.base,
      `${GOALS_MCP_PATH}?x=1`,
      'POST',
      rpc('tools/call', { name: 'mark_task_done', arguments: { taskId: r.taskId } }),
      auth
    )
    const theirs = await send(
      r.base,
      GOALS_MCP_PATH,
      'POST',
      rpc('tools/call', { name: 'mark_task_done', arguments: { taskId: r.otherTaskId } }),
      auth
    )
    expect(JSON.parse(mine.body)).toMatchObject({ result: { content: [{ text: 'done' }] } })
    expect(JSON.parse(theirs.body)).toMatchObject({ result: { isError: true } })
    const status = (id: string): string | undefined =>
      r.store.view().tasks.find((t) => t.id === id)?.status
    expect([status(r.taskId), status(r.otherTaskId)]).toEqual(['done', 'open'])
    expect(r.onHookEvent).not.toHaveBeenCalled()
  })

  it('a GET is 405 (no stream is served)', async () => {
    const r = await start()
    const res = await send(r.base, GOALS_MCP_PATH, 'GET', undefined, {
      authorization: `Bearer ${r.token}`
    })
    expect(res.status).toBe(405)
  })

  it('a body over the cap is 400', async () => {
    const r = await start()
    const huge = rpc('ping', { pad: 'x'.repeat(MAX_BODY_BYTES + 1) })
    const res = await send(r.base, GOALS_MCP_PATH, 'POST', huge, {
      authorization: `Bearer ${r.token}`
    })
    expect(res.status).toBe(400)
  })

  it('a handler that throws is 500 with a code, and the server keeps serving', async () => {
    const r = await start(true, {
      handle: () => {
        throw new Error('boom')
      }
    })
    const auth = { authorization: `Bearer ${r.token}` }
    expect((await send(r.base, GOALS_MCP_PATH, 'POST', rpc('ping'), auth)).status).toBe(500)
    expect(r.mcpLines).toContain('[claude-watcher][goals] route=mcp code=mcp_handler_error')
    const hook = JSON.stringify({ session_id: 'a', hook_event_name: 'Stop' })
    expect((await send(r.base, '/', 'POST', hook)).status).toBe(200)
  })

  it('with no endpoint wired, /mcp/goals is 404 and never a hook', async () => {
    const r = await start(false)
    const body = JSON.stringify({ session_id: 'a', hook_event_name: 'Stop' })
    expect((await send(r.base, GOALS_MCP_PATH, 'POST', body)).status).toBe(404)
    expect(r.onHookEvent).not.toHaveBeenCalled()
  })
})
