// Reducer behaviours the mutation run (StrykerJS) showed no test pinned: removal forgetting every
// per-session memory, the open-prompt bookkeeping per agent, the tool a waiting card shows, and
// the first event of a fresh session never throwing. Deterministic: injected `now()`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createReducer, type HookStatusChange } from './reducer'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const ID = 'mut00001-0000-4000-8000-000000000001'

function fresh(): ReturnType<typeof createReducer> {
  const r = createReducer({ now: () => 1, log: () => {} })
  r.upsertLaunched(launchedSession(ID))
  return r
}

type StatusChange = Extract<HookStatusChange, { kind: 'status' }>

function pre(toolUseId: string, toolName = 'Bash', agentId?: string): StatusChange {
  return {
    kind: 'status',
    status: toolName === 'AskUserQuestion' ? 'NeedsAttention' : 'Working',
    fromTool: true,
    toolName,
    toolUseId,
    ...(agentId === undefined ? {} : { agentId }),
    ...(toolName === 'AskUserQuestion' ? { opensPrompt: true as const } : {})
  }
}

function post(toolUseId: string, agentId?: string): HookStatusChange {
  return {
    kind: 'status',
    status: 'Working',
    fromTool: true,
    toolDone: true,
    toolUseId,
    ...(agentId === undefined ? {} : { agentId })
  }
}

function permissionRequest(toolName = 'Bash', agentId?: string): HookStatusChange {
  return {
    kind: 'status',
    status: 'NeedsPermission',
    toolName,
    opensPrompt: true,
    ...(agentId === undefined ? {} : { agentId })
  }
}

const NOTIFICATION: HookStatusChange = { kind: 'status', status: 'NeedsPermission' }
const KEY: HookStatusChange = { kind: 'status', status: 'Working', fromKey: true }
const ELICITATION: HookStatusChange = { kind: 'status', status: 'NeedsAttention', fromTool: true }

function stored(r: ReturnType<typeof createReducer>): ReturnType<typeof launchedSession> {
  const s = r.snapshotMap().get(ID)
  expect(s).toBeDefined()
  return s ?? launchedSession(ID)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reducer — the default log', () => {
  it('writes the path and code of an unknown-id hook to console.warn when no log is injected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createReducer({ now: () => 1 }).applyHookStatus('nobody', { kind: 'status', status: 'Working' })
    expect(warn).toHaveBeenCalledWith('[c9watch][reducer] dropped path=(hook) code=hook_unknown_id')
  })
})

describe('reducer — removal', () => {
  it('the removed delta carries the session name and project path of the removed card', () => {
    const r = createReducer({ now: () => 1 })
    r.upsertLaunched(launchedSession(ID, { sessionName: 'alpha', projectPath: '/p/alpha' }))
    const [delta] = r.applyHookStatus(ID, { kind: 'removed' })
    expect(delta?.event).toEqual({
      type: 'session.removed',
      id: ID,
      sessionName: 'alpha',
      projectPath: '/p/alpha'
    })
  })

  it('a re-launched id does not inherit the detail of its last PreToolUse before removal', () => {
    const r = fresh()
    r.applyHookStatus(ID, { ...pre('t1'), toolDetail: 'ls -la' })
    r.applyHookStatus(ID, { kind: 'removed' })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, permissionRequest())
    expect(stored(r).pendingToolDetail).toBeUndefined()
  })

  it('a re-launched id does not open a prompt for a PreToolUse sent before removal', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('t1'))
    r.applyHookStatus(ID, { kind: 'removed' })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, permissionRequest())
    r.applyHookStatus(ID, post('t1'))
    expect(stored(r).status).toBe('NeedsPermission')
  })

  it('a re-launched id does not keep the running work of a Stop sent before removal', () => {
    const r = fresh()
    r.applyHookStatus(ID, { kind: 'status', status: 'Working', taskIds: ['task-1'] })
    r.applyHookStatus(ID, { kind: 'removed' })
    r.upsertLaunched(launchedSession(ID))
    r.applyHookStatus(ID, { kind: 'status', status: 'WaitingForInput', interrupt: true })
    expect(stored(r).status).toBe('WaitingForInput')
  })
})

describe('reducer — the approval key while a question is open', () => {
  it('returns no delta for a key pressed while an AskUserQuestion prompt is open', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('q1', 'AskUserQuestion'))
    expect(r.applyHookStatus(ID, KEY)).toEqual([])
  })

  it('a key as the first event of a fresh session applies without throwing', () => {
    const r = fresh()
    expect(r.applyHookStatus(ID, KEY)).toHaveLength(1)
  })

  it('a question opened for a PreToolUse that already finished does not hold the key', () => {
    const r = fresh()
    r.applyHookStatus(ID, {
      kind: 'status',
      status: 'Working',
      fromTool: true,
      toolName: 'AskUserQuestion',
      toolUseId: 'q1'
    })
    r.applyHookStatus(ID, post('q1'))
    r.applyHookStatus(ID, {
      kind: 'status',
      status: 'NeedsAttention',
      toolName: 'AskUserQuestion',
      opensPrompt: true
    })
    expect(r.applyHookStatus(ID, KEY)).toHaveLength(1)
  })
})

describe('reducer — running work at the last Stop', () => {
  it('a permission prompt after a Stop with running work is NeedsPermission, not Working', () => {
    const r = fresh()
    r.applyHookStatus(ID, { kind: 'status', status: 'Working', taskIds: ['task-1'] })
    r.applyHookStatus(ID, permissionRequest())
    expect(stored(r).status).toBe('NeedsPermission')
  })
})

describe('reducer — first tool events of a fresh session', () => {
  it('a finished tool call as the first event of a fresh session applies without throwing', () => {
    const r = fresh()
    expect(r.applyHookStatus(ID, post('t1'))).toHaveLength(1)
  })

  it('a finished tool call from an agent with no earlier PreToolUse applies without throwing', () => {
    const r = fresh()
    r.applyHookStatus(ID, { kind: 'status', status: 'YourTurn' })
    expect(r.applyHookStatus(ID, post('t1', 'agent-x'))).toHaveLength(1)
  })

  it('a PermissionRequest with no earlier PreToolUse names its tool without throwing', () => {
    const r = fresh()
    r.applyHookStatus(ID, permissionRequest('Edit'))
    expect(stored(r).pendingToolName).toBe('Edit')
  })
})

describe('reducer — the tool a waiting card shows', () => {
  it('a NeedsAttention change that is not a tool event names no pending tool', () => {
    const r = fresh()
    r.applyHookStatus(ID, { kind: 'status', status: 'NeedsAttention', toolName: 'Bash' })
    expect(stored(r).pendingToolName).toBeUndefined()
  })

  it('a PermissionRequest for a new tool replaces the tool a waiting card shows', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('t1', 'Bash'))
    r.applyHookStatus(ID, permissionRequest('Bash'))
    r.applyHookStatus(ID, permissionRequest('Edit'))
    expect(stored(r).pendingToolName).toBe('Edit')
  })

  it('a Notification on a card waiting with no tool names the last PreToolUse', () => {
    const r = fresh()
    r.applyHookStatus(ID, NOTIFICATION)
    r.applyHookStatus(ID, pre('t1', 'Bash'))
    r.applyHookStatus(ID, NOTIFICATION)
    expect(stored(r).pendingToolName).toBe('Bash')
  })

  it('a PermissionRequest takes the detail of the PreToolUse, not of an earlier PermissionRequest', () => {
    const r = fresh()
    r.applyHookStatus(ID, { ...pre('t1', 'Bash'), toolDetail: 'ls' })
    r.applyHookStatus(ID, permissionRequest('Edit'))
    r.applyHookStatus(ID, permissionRequest('Bash'))
    expect(stored(r).pendingToolDetail).toBe('ls')
  })
})

describe('reducer — open prompts per agent', () => {
  it('a subagent PermissionRequest opens the prompt of its own agent PreToolUse', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('a1', 'Bash', 'agent-a'))
    r.applyHookStatus(ID, pre('b1', 'Bash', 'agent-b'))
    r.applyHookStatus(ID, permissionRequest('Bash', 'agent-a'))
    r.applyHookStatus(ID, post('a1', 'agent-a'))
    expect(stored(r).status).toBe('Working')
  })

  it('another call of the same agent finishing keeps that agent last PreToolUse', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('t1'))
    r.applyHookStatus(ID, pre('t2'))
    r.applyHookStatus(ID, post('t1'))
    r.applyHookStatus(ID, permissionRequest())
    r.applyHookStatus(ID, post('t2'))
    expect(stored(r).status).toBe('Working')
  })

  it('a tool event with no tool_use_id does not replace the agent last PreToolUse', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('t1'))
    r.applyHookStatus(ID, ELICITATION)
    r.applyHookStatus(ID, permissionRequest())
    r.applyHookStatus(ID, post('t1'))
    expect(stored(r).status).toBe('Working')
  })

  it('a parallel question opening while a card waits on permission keeps NeedsPermission', () => {
    const r = fresh()
    r.applyHookStatus(ID, pre('t1'))
    r.applyHookStatus(ID, permissionRequest())
    expect(r.applyHookStatus(ID, pre('q1', 'AskUserQuestion', 'agent-b'))).toEqual([])
  })
})

describe('reducer — the sticky ask with no origin reported', () => {
  it('a tool event keeps the ask open when the mod has reported no origin', () => {
    const r = fresh()
    r.applyHookStatus(ID, { kind: 'status', status: 'NeedsAttention', opensAsk: true })
    r.applyHookStatus(ID, pre('t1'))
    expect(stored(r).status).toBe('NeedsAttention')
  })
})
