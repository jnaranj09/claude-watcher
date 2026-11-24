// Watch push rules the mutation run (StrykerJS) showed no test pinned: the status push and the
// focused-terminal push keep their fields, and a terminal id up to 200 characters is accepted.
import { describe, it, expect } from 'vitest'
import { WatchStatusSchema, ViewFocusedTerminalSchema } from './watchDelta'

describe('WatchStatusSchema', () => {
  it('keeps the reconnecting flag', () => {
    expect(WatchStatusSchema.parse({ reconnecting: true })).toEqual({ reconnecting: true })
  })
})

describe('ViewFocusedTerminalSchema', () => {
  it('keeps a terminal id of several characters', () => {
    expect(ViewFocusedTerminalSchema.parse({ terminalId: 'term-1' })).toEqual({
      terminalId: 'term-1'
    })
  })

  it('accepts a terminal id of exactly 200 characters', () => {
    expect(ViewFocusedTerminalSchema.safeParse({ terminalId: 't'.repeat(200) }).success).toBe(true)
  })
})
