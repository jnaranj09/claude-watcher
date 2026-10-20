// Which tools a grant gets, and the argument check of `mark_task_done` (spec 2026-10-19 goals).
import { describe, it, expect } from 'vitest'
import { createGoalsStore } from '../../persistence/goals'
import { createMcpTools, MARK_TASK_DONE } from './mcpTools'
import type { Grant } from './goalTokens'
import { createProposals } from '../proposals'

const worker: Grant = { sessionId: 's', workspaceId: 'w1', mode: 'worker' }

describe('goals MCP tools', () => {
  it('a worker gets mark_task_done with a strict taskId schema', () => {
    const tools = createMcpTools(
      () => createGoalsStore(),
      createProposals(() => {})
    )
    expect(tools.list(worker)).toEqual([
      expect.objectContaining({
        name: MARK_TASK_DONE,
        inputSchema: {
          type: 'object',
          properties: { taskId: expect.objectContaining({ type: 'string' }) },
          required: ['taskId'],
          additionalProperties: false
        }
      })
    ])
  })

  it('a taskId that is not a short non-empty string is invalid params, before the store', () => {
    const tools = createMcpTools(
      () => {
        throw new Error('store must not be read')
      },
      createProposals(() => {})
    )
    for (const args of [{ taskId: '' }, { taskId: 7 }, { taskId: 'x'.repeat(201) }, null]) {
      expect(tools.call(MARK_TASK_DONE, args, worker)).toEqual({ kind: 'invalid_params' })
    }
  })
})
