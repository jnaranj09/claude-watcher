import { describe, it, expect } from 'vitest'
import { reminderSummary } from './reminderSummary'

describe('reminderSummary — the line under the reminder rows', () => {
  it('names the statuses and the times, for the defaults', () => {
    expect(reminderSummary(3, 2)).toBe('For permission prompts and questions: +2, +6, +14 min')
  })

  it('a single reminder', () => {
    expect(reminderSummary(1, 5)).toBe('For permission prompts and questions: +5 min')
  })

  it('Off says what still happens', () => {
    expect(reminderSummary(0, 2)).toBe('Off — one alert per permission prompt or question')
  })
})
