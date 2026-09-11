// Attention reminders — validate-at-source for the `attention:reminder` push (jsdom `unit`).
import { describe, it, expect } from 'vitest'
import { AttentionReminderSchema } from './watchDelta'

describe('AttentionReminderSchema — the attention:reminder push payload', () => {
  it('accepts a session id', () => {
    expect(AttentionReminderSchema.parse({ id: 'aaaa-1' })).toEqual({ id: 'aaaa-1' })
  })

  it.each([{ id: '' }, {}, { id: 7 }, null])('rejects %j', (bad) => {
    expect(AttentionReminderSchema.safeParse(bad).success).toBe(false)
  })
})
