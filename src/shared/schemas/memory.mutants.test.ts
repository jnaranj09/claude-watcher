// Memory schema rules the mutation run (StrykerJS) showed no test pinned: the one-line and
// multi-line text helpers, the activity actions, the command list's offset and the save result's
// outcome and reason.
import { describe, it, expect } from 'vitest'
import {
  MemoryTextSchema,
  MemoryActivitySchema,
  MemoryCommandsListSchema,
  MemoryExtractResultSchema
} from './memory'

const NO_COUNTS = { specifics: 0, facts: 0, tasks: 0, episodes: 0 }

describe('memory text', () => {
  it('a fact title and body are trimmed', () => {
    const fact = MemoryTextSchema.parse({ kind: 'fact', title: '  Port  ', body: '  9281\n  ' })
    expect(fact).toEqual({ kind: 'fact', title: 'Port', body: '9281' })
  })

  it('a blank fact body is refused', () => {
    expect(MemoryTextSchema.safeParse({ kind: 'fact', title: 'Port', body: ' \n ' }).success).toBe(
      false
    )
  })
})

describe('MemoryActivitySchema', () => {
  it.each(['saved', 'updated', 'marked_stale'])('accepts an entry whose action is %s', (action) => {
    const activity = {
      injected: null,
      entries: [{ at: 1, action, tool: 'memory_save', itemId: 'm1', reason: null }],
      recall: null
    }
    expect(MemoryActivitySchema.safeParse(activity).success).toBe(true)
  })
})

describe('MemoryCommandsListSchema', () => {
  it('accepts an offset past the first page', () => {
    const list = { workspaceId: 'default', query: null, offset: 50, limit: 50 }
    expect(MemoryCommandsListSchema.safeParse(list).success).toBe(true)
  })
})

describe('MemoryExtractResultSchema', () => {
  it.each([
    ['nothing new', { outcome: 'nothing', reason: null }],
    ['a too-old claude', { outcome: 'failed', reason: 'claude_version' }]
  ])('accepts a result for %s', (_case, part) => {
    const result = { sessionName: 'proj', trigger: 'end', counts: NO_COUNTS, ...part }
    expect(MemoryExtractResultSchema.safeParse(result).success).toBe(true)
  })
})
