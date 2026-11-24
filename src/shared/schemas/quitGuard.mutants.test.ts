// Quit guard rules the mutation run (StrykerJS) found no node test covering: the push keeps its
// counts and every session row's fields.
import { describe, it, expect } from 'vitest'
import { QuitGuardPayloadSchema } from './quitGuard'

describe('QuitGuardPayloadSchema', () => {
  it('keeps the counts and the session rows of the push', () => {
    const payload = {
      total: 1,
      workingCount: 1,
      sessions: [{ id: 'sess-1', sessionName: 'proj', status: 'Working', column: 'working' }]
    }
    expect(QuitGuardPayloadSchema.parse(payload)).toEqual(payload)
  })
})
