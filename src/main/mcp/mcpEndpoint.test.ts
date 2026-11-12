// The JSON-RPC side of the app's MCP endpoint, driven through the goals server (spec 2026-10-19
// goals, Claude integration): what a session's MCP client gets for each method, what
// `mark_task_done` may change, and the hook server's route to an endpoint.
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createGoalsStore, type GoalsStore } from '../persistence/goals'
import { createGoalTokens, type Grant } from '../goals/mcp/goalTokens'
import { createMcpTools } from '../goals/mcp/mcpTools'
import { MCP_SERVER_NAME } from '../goals/mcp/mcpConfigFile'
import {
  appMcpRoutes,
  createMcpEndpoint,
  handleMcpRequest,
  mcpRoute,
  type McpEndpoint
} from './mcpEndpoint'
import { GOALS_MCP_PATH, MEMORY_MCP_PATH } from '../hooks/hookContract'
import { createProposals } from '../goals/proposals'

function seed(): { store: GoalsStore; t1: string; t2: string } {
  let n = 0
  const store = createGoalsStore({ newId: () => `id${++n}`, now: () => 5 })
  const goalId = store.saveGoal({ workspaceId: 'w1', name: 'Ship v2' }, '/work').saved.id
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
    )
    expect(res).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  })

  it('notifications/initialized gets no response', () => {
    const { store } = seed()
    expect(
      handleMcpRequest(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        worker,
        createMcpTools(
          () => store,
          createProposals(() => {})
        ),
        MCP_SERVER_NAME
      )
    ).toBeNull()
  })

  it('tools/list for a worker lists only mark_task_done', () => {
    const { store } = seed()
    const res = handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      worker,
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [expect.objectContaining({ name: 'mark_task_done' })] }
    })
  })

  it('mark_task_done on a linked task marks it done by session', () => {
    const { store, t1 } = seed()
    const res = handleMcpRequest(
      call(t1),
      worker,
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
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
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
    )
    expect(before.tasks.some((t) => t.id === t1)).toBe(false)
    expect(res).toMatchObject({ result: { content: [{ text: 'task_not_found' }], isError: true } })
    expect(store.view()).toEqual(before)
  })

  it('twice succeeds and changes nothing', () => {
    const { store, t1 } = seed()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    handleMcpRequest(call(t1), worker, tools, MCP_SERVER_NAME)
    const after = store.view()
    let emitted = 0
    store.onChange(() => emitted++)
    expect(handleMcpRequest(call(t1, 4), worker, tools, MCP_SERVER_NAME)).toMatchObject({
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
        createMcpTools(
          () => store,
          createProposals(() => {})
        ),
        MCP_SERVER_NAME
      )
    ).toEqual({
      jsonrpc: '2.0',
      id: 'server-discover-probe-1',
      error: { code: -32601, message: 'Method not found' }
    })
  })

  it('bad params are -32602: no taskId, an unknown tool, an extra argument', () => {
    const { store, t1 } = seed()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
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
      expect(handleMcpRequest(body, worker, tools, MCP_SERVER_NAME)).toMatchObject({
        id: 5,
        error: { code: -32602 }
      })
    }
    expect(store.view().tasks.find((t) => t.id === t1)?.status).toBe('open')
  })

  it('a body that is not a JSON-RPC request is -32600 with a null id', () => {
    const { store } = seed()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    for (const body of [
      [],
      'x',
      { id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: null, method: 'ping' }
    ]) {
      expect(handleMcpRequest(body, worker, tools, MCP_SERVER_NAME)).toMatchObject({
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
        createMcpTools(
          () => store,
          createProposals(() => {})
        ),
        MCP_SERVER_NAME
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
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      tokens,
      tools: createMcpTools(
        () => store,
        createProposals(() => {})
      ),
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

  describe('an error outcome with a log code', () => {
    const callOf = (name: string): unknown => ({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name, arguments: {} }
    })
    function endpointOver(lines: string[]): McpEndpoint<Grant> {
      return createMcpEndpoint({
        serverName: 'stub',
        area: 'stubarea',
        tokens: { resolve: (): Grant | null => null },
        tools: {
          list: () => [],
          call: (name) =>
            name === 'coded'
              ? { kind: 'result', text: 'Some sentence.', isError: true, code: 'some_code' }
              : { kind: 'result', text: 'plain_code', isError: true }
        },
        log: (l) => lines.push(l)
      })
    }

    it('logs the code and still answers the caller with the text', () => {
      const lines: string[] = []
      const res = endpointOver(lines).handle(callOf('coded'), worker)
      expect(lines).toEqual([
        '[claude-watcher][stubarea] route=mcp method=tools/call code=some_code'
      ])
      expect(res).toMatchObject({
        result: { content: [{ type: 'text', text: 'Some sentence.' }], isError: true }
      })
    })

    it('without a code logs the text, as before', () => {
      const lines: string[] = []
      endpointOver(lines).handle(callOf('plain'), worker)
      expect(lines).toEqual([
        '[claude-watcher][stubarea] route=mcp method=tools/call code=plain_code'
      ])
    })
  })

  it('resolve takes the bearer header and answers the grant, or null', () => {
    const tokens = createGoalTokens()
    const token = tokens.mint(worker)
    const endpoint = createMcpEndpoint({
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      tokens,
      tools: createMcpTools(
        () => seed().store,
        createProposals(() => {})
      ),
      log: () => {}
    })
    expect(endpoint.resolve(`Bearer ${token}`)).toEqual(worker)
    expect(endpoint.resolve(token)).toBeNull()
    expect(endpoint.resolve(`Basic ${token}`)).toBeNull()
    expect(endpoint.resolve(undefined)).toBeNull()
    expect(endpoint.resolve('Bearer nope')).toBeNull()
  })
})

describe('mcpRoute', () => {
  const stub = (): McpEndpoint<Grant> => ({
    area: 'goals',
    resolve: vi.fn((header: string | undefined) => (header === 'Bearer live' ? worker : null)),
    handle: vi.fn(() => null)
  })

  it('opens a handler that hands the body and the bearer’s grant to its endpoint', () => {
    const endpoint = stub()
    const route = mcpRoute('/mcp/goals', endpoint, () => {})
    expect(route.path).toBe('/mcp/goals')
    const handler = route.open('Bearer live')
    expect(handler).not.toBeNull()
    handler?.({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(endpoint.handle).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'ping' }, worker)
  })

  it('opens nothing on a bearer miss', () => {
    const endpoint = stub()
    const route = mcpRoute('/mcp/goals', endpoint, () => {})
    expect([route.open('Bearer nope'), route.open(undefined)]).toEqual([null, null])
    expect(endpoint.handle).not.toHaveBeenCalled()
  })

  it("logs through its sink with its endpoint's area", () => {
    const log = vi.fn()
    mcpRoute('/mcp/goals', stub(), log).log('route=mcp code=unauthorized')
    expect(log).toHaveBeenCalledWith('[claude-watcher][goals] route=mcp code=unauthorized')
  })
})

describe('appMcpRoutes', () => {
  const endpoint = (area: string, bearer: string): McpEndpoint<string> => ({
    area,
    resolve: vi.fn((header: string | undefined) => (header === `Bearer ${bearer}` ? area : null)),
    handle: vi.fn(() => null)
  })

  it('serves the goals server and the memory server, each at its own path', () => {
    const routes = appMcpRoutes(
      { goals: endpoint('goals', 'g'), memory: endpoint('memory', 'm') },
      () => {}
    )
    expect(routes.map((r) => r.path)).toEqual([GOALS_MCP_PATH, MEMORY_MCP_PATH])
  })

  it("the memory path opens with the memory server's bearer only, and hands it the body", () => {
    const memory = endpoint('memory', 'm')
    const routes = appMcpRoutes({ goals: endpoint('goals', 'g'), memory }, () => {})
    const route = routes.find((r) => r.path === MEMORY_MCP_PATH)
    expect(route?.open('Bearer g')).toBeNull()
    route?.open('Bearer m')?.({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(memory.handle).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'memory')
  })
})

/** The one text of a successful tool result (parsed, so no cast). */
function okText(res: unknown): string {
  const parsed = z
    .object({ result: z.object({ content: z.tuple([z.object({ text: z.string() })]) }) })
    .parse(res)
  return parsed.result.content[0].text
}

describe('goals MCP endpoint — the planner tools', () => {
  /** Two goals in w1 (one done task in the first) and a goal in w2; a planner on the first goal. */
  function plannerSeed(): {
    store: GoalsStore
    goalId: string
    t1: string
    t2: string
    done: string
    otherGoalTask: string
    otherWorkspaceTask: string
  } {
    const { store, t1, t2 } = seed()
    const goalId = store.view().goals[0]?.id ?? ''
    const done = store.saveTask({ workspaceId: 'w1', goalId, title: 'Old work' }).saved.id
    store.setTaskStatus(done, 'done', 'operator')
    const g2 = store.saveGoal({ workspaceId: 'w1', name: 'Other' }, '/work').saved.id
    const otherGoalTask = store.saveTask({ workspaceId: 'w1', goalId: g2, title: 'X' }).saved.id
    const g3 = store.saveGoal({ workspaceId: 'w2', name: 'Far' }, '/work').saved.id
    const otherWorkspaceTask = store.saveTask({ workspaceId: 'w2', goalId: g3, title: 'Y' }).saved
      .id
    return { store, goalId, t1, t2, done, otherGoalTask, otherWorkspaceTask }
  }
  const plannerOf = (goalId: string): Grant => ({
    sessionId: 'planner-1',
    workspaceId: 'w1',
    mode: 'planner',
    goalId
  })
  const tool = (name: string, args: unknown, id = 7): unknown => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  })

  it('tools/list for a planner lists list_tasks, create_task, propose_split', () => {
    const { store, goalId } = plannerSeed()
    const res = handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      plannerOf(goalId),
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
    )
    const { tools } = z
      .object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) })
      .parse(res).result
    expect(tools.map((t) => t.name)).toEqual(['list_tasks', 'create_task', 'propose_split'])
  })

  it("list_tasks lists only the planner's goal, with ids, titles and status", () => {
    const { store, goalId, t1, t2, done } = plannerSeed()
    const res = handleMcpRequest(
      tool('list_tasks', {}),
      plannerOf(goalId),
      createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      MCP_SERVER_NAME
    )
    expect(res).not.toMatchObject({ result: { isError: true } })
    expect(JSON.parse(okText(res))).toEqual([
      { id: t1, title: 'Write the spec', status: 'open' },
      { id: t2, title: 'Cut the release', status: 'open' },
      { id: done, title: 'Old work', status: 'done' }
    ])
  })

  it("create_task adds a task to the planner's goal only", () => {
    const { store, goalId } = plannerSeed()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    // A goalId argument is not the planner's to give: the schema is strict.
    expect(
      handleMcpRequest(
        tool('create_task', { title: 'Sneaky', goalId: 'g-other' }),
        plannerOf(goalId),
        tools,
        MCP_SERVER_NAME
      )
    ).toMatchObject({ error: { code: -32602 } })
    const res = handleMcpRequest(
      tool('create_task', { title: '  Water the plants  ' }),
      plannerOf(goalId),
      tools,
      MCP_SERVER_NAME
    )
    const { id } = z.object({ id: z.string() }).parse(JSON.parse(okText(res)))
    expect(store.view().tasks.find((t) => t.id === id)).toMatchObject({
      workspaceId: 'w1',
      goalId,
      title: 'Water the plants',
      status: 'open',
      sessionIds: []
    })
    expect(store.view().tasks.filter((t) => t.title === 'Sneaky')).toEqual([])
  })

  it('create_task goes through the task title rules: a refused title is isError, never echoed', () => {
    const { store, goalId } = plannerSeed()
    const before = store.view()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    for (const title of ['', '   ', 'a\nb', 'tab\there', 'x'.repeat(201), '\u009bcsi']) {
      expect(
        handleMcpRequest(tool('create_task', { title }), plannerOf(goalId), tools, MCP_SERVER_NAME)
      ).toEqual({
        jsonrpc: '2.0',
        id: 7,
        result: { content: [{ type: 'text', text: 'title_invalid' }], isError: true }
      })
    }
    expect(store.view()).toEqual(before)
  })

  it('create_task and list_tasks on a goal deleted since the launch are goal_not_found', () => {
    const { store, goalId } = plannerSeed()
    store.removeGoal(goalId)
    const before = store.view()
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    for (const body of [tool('create_task', { title: 'Late' }), tool('list_tasks', {})]) {
      expect(handleMcpRequest(body, plannerOf(goalId), tools, MCP_SERVER_NAME)).toMatchObject({
        result: { content: [{ text: 'goal_not_found' }], isError: true }
      })
    }
    expect(store.view()).toEqual(before)
  })

  it('a planner grant naming a goal of another workspace reaches nothing', () => {
    const { store } = plannerSeed()
    const farGoal = store.view().goals.find((g) => g.workspaceId === 'w2')?.id ?? ''
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    expect(
      handleMcpRequest(tool('list_tasks', {}), plannerOf(farGoal), tools, MCP_SERVER_NAME)
    ).toMatchObject({
      result: { content: [{ text: 'goal_not_found' }], isError: true }
    })
  })

  it('propose_split stores the proposal for this planner and goal', () => {
    const { store, goalId, t1, t2 } = plannerSeed()
    const proposals = createProposals(() => {})
    const res = handleMcpRequest(
      tool('propose_split', {
        groups: [
          { taskIds: [t1], note: 'first' },
          { taskIds: [t2], note: '' }
        ]
      }),
      plannerOf(goalId),
      createMcpTools(() => store, proposals),
      MCP_SERVER_NAME
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { content: [{ type: 'text', text: 'proposed' }] }
    })
    expect(proposals.list()).toEqual([
      {
        plannerSessionId: 'planner-1',
        goalId,
        groups: [
          { taskIds: [t1], note: 'first' },
          { taskIds: [t2], note: '' }
        ]
      }
    ])
  })

  it("propose_split with a done task or another goal's task is isError and stores nothing", () => {
    const { store, goalId, t1, done, otherGoalTask, otherWorkspaceTask } = plannerSeed()
    const proposals = createProposals(() => {})
    const tools = createMcpTools(() => store, proposals)
    for (const bad of [done, otherGoalTask, otherWorkspaceTask, 'no-such-task']) {
      expect(
        handleMcpRequest(
          tool('propose_split', { groups: [{ taskIds: [t1, bad], note: '' }] }),
          plannerOf(goalId),
          tools,
          MCP_SERVER_NAME
        )
      ).toEqual({
        jsonrpc: '2.0',
        id: 7,
        result: { content: [{ type: 'text', text: 'task_not_in_goal' }], isError: true }
      })
    }
    expect(proposals.list()).toEqual([])
  })

  it('propose_split with a repeated task id is isError task_repeated and stores nothing', () => {
    const { store, goalId, t1, t2 } = plannerSeed()
    const proposals = createProposals(() => {})
    const tools = createMcpTools(() => store, proposals)
    for (const groups of [
      [{ taskIds: [t1, t1], note: '' }],
      [
        { taskIds: [t1, t2], note: '' },
        { taskIds: [t2], note: '' }
      ]
    ]) {
      expect(
        handleMcpRequest(
          tool('propose_split', { groups }),
          plannerOf(goalId),
          tools,
          MCP_SERVER_NAME
        )
      ).toMatchObject({ result: { content: [{ text: 'task_repeated' }], isError: true } })
    }
    expect(proposals.list()).toEqual([])
  })

  it('propose_split with a bad shape is -32602 and stores nothing', () => {
    const { store, goalId, t1 } = plannerSeed()
    const proposals = createProposals(() => {})
    const tools = createMcpTools(() => store, proposals)
    for (const args of [
      {},
      { groups: [] },
      { groups: [{ taskIds: [], note: '' }] },
      { groups: [{ taskIds: [t1], note: 'x'.repeat(201) }] },
      { groups: [{ taskIds: [t1], note: 'a\u0007b' }] },
      { groups: Array.from({ length: 11 }, () => ({ taskIds: [t1], note: '' })) },
      { groups: [{ taskIds: [t1], note: '', extra: 1 }] },
      { groups: [{ taskIds: [t1], note: '' }], goalId: 'other' }
    ]) {
      expect(
        handleMcpRequest(tool('propose_split', args), plannerOf(goalId), tools, MCP_SERVER_NAME)
      ).toMatchObject({ error: { code: -32602 } })
    }
    expect(proposals.list()).toEqual([])
  })

  it('a worker token cannot call create_task', () => {
    const { store, goalId, t1 } = plannerSeed()
    const proposals = createProposals(() => {})
    const before = store.view()
    const tools = createMcpTools(() => store, proposals)
    for (const body of [
      tool('create_task', { title: 'From a worker' }),
      tool('list_tasks', {}),
      tool('propose_split', { groups: [{ taskIds: [t1], note: '' }] })
    ]) {
      expect(handleMcpRequest(body, worker, tools, MCP_SERVER_NAME)).toMatchObject({
        error: { code: -32602 }
      })
    }
    expect(store.view()).toEqual(before)
    expect(proposals.list()).toEqual([])
    void goalId
  })

  it('a planner cannot call mark_task_done', () => {
    const { store, goalId, t1 } = plannerSeed()
    store.linkMany([t1], 'planner-1')
    const tools = createMcpTools(
      () => store,
      createProposals(() => {})
    )
    expect(handleMcpRequest(call(t1), plannerOf(goalId), tools, MCP_SERVER_NAME)).toMatchObject({
      error: { code: -32602 }
    })
    expect(store.view().tasks.find((t) => t.id === t1)?.status).toBe('open')
  })

  it('logs codes only: a planner call never logs a title', () => {
    const { store, goalId } = plannerSeed()
    const lines: string[] = []
    const endpoint = createMcpEndpoint({
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      tokens: createGoalTokens(),
      tools: createMcpTools(
        () => store,
        createProposals(() => {})
      ),
      log: (l) => lines.push(l)
    })
    endpoint.handle(tool('list_tasks', {}), plannerOf(goalId))
    endpoint.handle(tool('create_task', { title: 'Secret plan' }), plannerOf(goalId))
    endpoint.handle(tool('create_task', { title: 'bad\ntitle' }), plannerOf(goalId))
    expect(lines).toEqual([
      '[claude-watcher][goals] route=mcp method=tools/call code=ok',
      '[claude-watcher][goals] route=mcp method=tools/call code=ok',
      '[claude-watcher][goals] route=mcp method=tools/call code=title_invalid'
    ])
  })
})
