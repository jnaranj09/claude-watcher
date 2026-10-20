// The two goals hand-offs watchFeed.ts makes: an archive records whether the session had
// `mark_task_done`, and the hook server gets the goals endpoint.
import { describe, it, expect, vi } from 'vitest'
import { hookServerMcp, recordRemoval } from './goalWiring'
import type { Session } from '../../shared/schemas/session'
import type { McpEndpoint } from '../goals/mcp/mcpEndpoint'

const session: Session = {
  id: 'sess-1',
  status: 'WaitingForInput',
  projectPath: '/home/op/api',
  pid: 9,
  sessionName: 'billing api',
  workspaceId: 'w1',
  tagIds: [],
  templateId: null,
  launchedAt: 100,
  latestMessage: '',
  pendingToolInput: '',
  pendingToolDetail: ''
}

describe('recordRemoval', () => {
  function rig(markDone: boolean): {
    store: { archive: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
    markDoneFor: ReturnType<typeof vi.fn<(id: string) => boolean>>
    deps: Parameters<typeof recordRemoval>[0]
  } {
    const store = { archive: vi.fn(), remove: vi.fn() }
    const markDoneFor = vi.fn((id: string) => id === 'sess-1' && markDone)
    return {
      store,
      markDoneFor,
      deps: { pastSessions: store, tokens: { markDoneFor }, now: () => 500 }
    }
  }

  it('an archive of a session that had the done tool records tasksMarkDone', () => {
    const { store, deps } = rig(true)
    recordRemoval(deps, 'archive', 'sess-1', session)
    expect(store.archive).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-1', endedAt: 500, tasksMarkDone: true })
    )
  })

  it('an archive of any other session records no tasksMarkDone', () => {
    const { store, deps } = rig(false)
    recordRemoval(deps, 'archive', 'sess-1', session)
    expect(store.archive).toHaveBeenCalledTimes(1)
    expect(store.archive.mock.calls[0]?.[0]).not.toHaveProperty('tasksMarkDone')
  })

  it('a delete asks nothing of the tokens and removes the record', () => {
    const { store, markDoneFor, deps } = rig(true)
    recordRemoval(deps, 'delete', 'sess-1', session)
    expect(store.remove).toHaveBeenCalledWith('sess-1')
    expect(markDoneFor).not.toHaveBeenCalled()
  })
})

describe('hookServerMcp', () => {
  it('hands the hook server the endpoint and a log sink', () => {
    const endpoint: McpEndpoint = { resolve: vi.fn(() => null), handle: vi.fn(() => null) }
    const log = vi.fn()
    const { mcp } = hookServerMcp(endpoint, log)
    expect(mcp.resolve).toBe(endpoint.resolve)
    expect(mcp.handle).toBe(endpoint.handle)
    mcp.log('line')
    expect(log).toHaveBeenCalledWith('line')
  })
})
