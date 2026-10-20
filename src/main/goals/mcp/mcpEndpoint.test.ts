// The JSON-RPC side of the goals MCP endpoint (spec 2026-10-19 goals, Claude integration): what a
// session's MCP client gets for each method, and what `mark_task_done` may change.
import { describe, it, expect } from 'vitest'
import { createGoalsStore, type GoalsStore } from '../../persistence/goals'
import { createGoalTokens, type Grant } from './goalTokens'
import { createMcpTools } from './mcpTools'
import { createMcpEndpoint, handleMcpRequest } from './mcpEndpoint'

function seed(): { store: GoalsStore; t1: string; t2: string } {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 5 })
  const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship v2' }).saved.id
  const t1 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Write the spec' }).saved.id
  const t2 = store.saveTask({ workspaceId: 'w1', goalId, title: 'Cut the release' }).saved.id
  store.linkMany([t1], 'sess-a')
  store.linkMany([t2], 'sess-b')
  return { store, t1, t2 }
}

const worker: Grant = { sessionId: 'sess-a', workspaceId: 'w1', mode: 'worker' }
const call = (taskId: unknown, id = 3): unknown => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'mark_task_done', arguments: { taskId } }
})

describe('goals MCP endpoint', () => {
  it('initialize answers with tools capability', () => {
    const { store } = seed()
    const res = handleMcpRequest(
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude' } }
      },
      worker,
      createMcpTools(() => store)
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'claude-watcher', version: '1' }
      }
    })
  })

  it('initialize with a version it does not know answers with its own latest', () => {
    const { store } = seed()
    const res = handleMcpRequest(
      { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
      worker,
      createMcpTools(() => store)
    )
    expect(res).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  })

  it('notifications/initialized gets no response', () => {
    const { store } = seed()
    expect(
      handleMcpRequest(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        worker,
        createMcpTools(() => store)
      )
    ).toBeNull()
  })

  it('tools/list for a worker lists only mark_task_done', () => {
    const { store } = seed()
    const res = handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      worker,
      createMcpTools(() => store)
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [expect.objectContaining({ name: 'mark_task_done' })] }
    })
  })

  it('tools/list for a planner lists nothing yet, and it cannot call mark_task_done', () => {
    const { store, t1 } = seed()
    const planner: Grant = { sessionId: 'sess-a', workspaceId: 'w1', mode: 'planner', goalId: 'g' }
    const tools = createMcpTools(() => store)
    expect(
      handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, planner, tools)
    ).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: [] } })
    expect(handleMcpRequest(call(t1), planner, tools)).toMatchObject({ error: { code: -32602 } })
    expect(store.view().tasks.find((t) => t.id === t1)?.status).toBe('open')
  })

  it('mark_task_done on a linked task marks it done by session', () => {
    const { store, t1 } = seed()
    const res = handleMcpRequest(
      call(t1),
      worker,
      createMcpTools(() => store)
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'done' }] }
    })
    expect(store.view().tasks.find((t) => t.id === t1)).toMatchObject({
      status: 'done',
      doneBy: 'session',
      doneAt: 5
    })
  })

  it('on a task linked elsewhere returns isError task_not_linked and changes nothing', () => {
    const { store, t2 } = seed()
    const before = store.view()
    const res = handleMcpRequest(
      call(t2),
      worker,
      createMcpTools(() => store)
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: 'task_not_linked' }], isError: true }
    })
    expect(store.view()).toEqual(before)
  })

  it('on a linked task of another workspace returns task_not_linked', () => {
    const { store } = seed()
    const other = store.saveTask({ workspaceId: 'w2', goalId: null, title: 'Elsewhere' }).saved.id
    store.linkMany([other], 'sess-a')
    const res = handleMcpRequest(
      call(other),
      worker,
      createMcpTools(() => store)
    )
    expect(res).toMatchObject({ result: { content: [{ text: 'task_not_linked' }], isError: true } })
    expect(store.view().tasks.find((t) => t.id === other)?.status).toBe('open')
  })

  it('on a deleted task returns task_not_found', () => {
    const { store, t1 } = seed()
    store.removeTask(t1)
    const res = handleMcpRequest(
      call(t1),
      worker,
      createMcpTools(() => store)
    )
    expect(res).toMatchObject({ result: { content: [{ text: 'task_not_found' }], isError: true } })
  })

  it('after its goal is deleted (the cascade takes the task), returns task_not_found and changes nothing', () => {
    const { store, t1 } = seed()
    const goalId = store.view().goals[0]?.id ?? ''
    store.removeGoal(goalId)
    const before = store.view()
    const res = handleMcpRequest(
      call(t1),
      worker,
      createMcpTools(() => store)
    )
    expect(before.tasks.some((t) => t.id === t1)).toBe(false)
    expect(res).toMatchObject({ result: { content: [{ text: 'task_not_found' }], isError: true } })
    expect(store.view()).toEqual(before)
  })

  it('twice succeeds and changes nothing', () => {
    const { store, t1 } = seed()
    const tools = createMcpTools(() => store)
    handleMcpRequest(call(t1), worker, tools)
    const after = store.view()
    let emitted = 0
    store.onChange(() => emitted++)
    expect(handleMcpRequest(call(t1, 4), worker, tools)).toMatchObject({
      id: 4,
      result: { content: [{ text: 'done' }] }
    })
    expect(store.view()).toEqual(after)
    expect(emitted).toBe(0)
  })

  it('an unknown method is -32601', () => {
    const { store } = seed()
    expect(
      handleMcpRequest(
        { jsonrpc: '2.0', id: 'server-discover-probe-1', method: 'server/discover' },
        worker,
        createMcpTools(() => store)
      )
    ).toEqual({
      jsonrpc: '2.0',
      id: 'server-discover-probe-1',
      error: { code: -32601, message: 'Method not found' }
    })
  })

  it('bad params are -32602: no taskId, an unknown tool, an extra argument', () => {
    const { store, t1 } = seed()
    const tools = createMcpTools(() => store)
    const bad = [
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mark_task_done' } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'rm_rf', arguments: {} } },
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'mark_task_done', arguments: { taskId: t1, also: 1 } }
      },
      { jsonrpc: '2.0', id: 5, method: 'initialize', params: {} }
    ]
    for (const body of bad) {
      expect(handleMcpRequest(body, worker, tools)).toMatchObject({
        id: 5,
        error: { code: -32602 }
      })
    }
    expect(store.view().tasks.find((t) => t.id === t1)?.status).toBe('open')
  })

  it('a body that is not a JSON-RPC request is -32600 with a null id', () => {
    const { store } = seed()
    const tools = createMcpTools(() => store)
    for (const body of [
      [],
      'x',
      { id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: null, method: 'ping' }
    ]) {
      expect(handleMcpRequest(body, worker, tools)).toMatchObject({
        id: null,
        error: { code: -32600 }
      })
    }
  })

  it('ping answers an empty result', () => {
    const { store } = seed()
    expect(
      handleMcpRequest(
        { jsonrpc: '2.0', id: 9, method: 'ping' },
        worker,
        createMcpTools(() => store)
      )
    ).toEqual({ jsonrpc: '2.0', id: 9, result: {} })
  })
})

describe('goals MCP endpoint logging', () => {
  it('logs the rpc method and a code only: never a task id, a title or a token', () => {
    const { store, t1, t2 } = seed()
    const tokens = createGoalTokens()
    const token = tokens.mint(worker)
    const lines: string[] = []
    const endpoint = createMcpEndpoint({
      tokens,
      tools: createMcpTools(() => store),
      log: (l) => lines.push(l)
    })
    endpoint.handle(call(t1), worker)
    endpoint.handle(call(t2), worker)
    endpoint.handle({ jsonrpc: '2.0', id: 1, method: `evil ${token}` }, worker)
    expect(lines).toEqual([
      '[claude-watcher][goals] route=mcp method=tools/call code=ok',
      '[claude-watcher][goals] route=mcp method=tools/call code=task_not_linked',
      '[claude-watcher][goals] route=mcp method=other code=method_not_found'
    ])
  })

  it('resolve takes the bearer header and answers the grant, or null', () => {
    const tokens = createGoalTokens()
    const token = tokens.mint(worker)
    const endpoint = createMcpEndpoint({
      tokens,
      tools: createMcpTools(() => seed().store),
      log: () => {}
    })
    expect(endpoint.resolve(`Bearer ${token}`)).toEqual(worker)
    expect(endpoint.resolve(token)).toBeNull()
    expect(endpoint.resolve(`Basic ${token}`)).toBeNull()
    expect(endpoint.resolve(undefined)).toBeNull()
    expect(endpoint.resolve('Bearer nope')).toBeNull()
  })
})
