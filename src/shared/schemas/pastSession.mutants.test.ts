// Past session rules the mutation run (StrykerJS) showed no test pinned: every memory state a
// record can hold, and an imported id anchored at its start.
import { describe, it, expect } from 'vitest'
import { PastSessionMemorySchema, PastSessionImportSchema } from './pastSession'

describe('PastSessionMemorySchema', () => {
  it.each(['saving', 'nothing', 'failed', 'off'])('accepts the memory state %s', (state) => {
    const memory = { state, specifics: 0, facts: 0, tasks: 0, episodes: 0, episodeId: null }
    expect(PastSessionMemorySchema.safeParse(memory).success).toBe(true)
  })
})

describe('PastSessionImportSchema', () => {
  it('refuses an id with text before the claude session id', () => {
    const r = PastSessionImportSchema.safeParse({
      id: 'x0b1c2d3e-0000-4000-8000-000000000001',
      workspaceId: 'default'
    })
    expect(r.success).toBe(false)
  })
})
