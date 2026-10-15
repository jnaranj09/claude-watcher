// Attention reminders — the timing math (`shared-node` project; pure).
// Spec: docs/superpowers/specs/2026-09-10-attention-reminders-design.md D-2.
import { describe, it, expect } from 'vitest'
import { reminderGapMs, reminderOffsetsMinutes } from './reminderSchedule'

const MIN = 60_000

describe('reminderOffsetsMinutes — minutes from the start of the wait to each reminder', () => {
  it('the defaults (3 reminders, first after 2 min) land at +2, +6, +14', () => {
    expect(reminderOffsetsMinutes(3, 2)).toEqual([2, 6, 14])
  })

  it('a count of 0 means no reminders', () => {
    expect(reminderOffsetsMinutes(0, 2)).toEqual([])
  })

  it('every gap doubles the one before', () => {
    expect(reminderOffsetsMinutes(5, 1)).toEqual([1, 3, 7, 15, 31])
  })

  it('a single reminder lands at the first delay', () => {
    expect(reminderOffsetsMinutes(1, 15)).toEqual([15])
  })
})

describe('reminderGapMs — the wait before reminder k, measured from the previous one', () => {
  it('gap k is first × 2^(k−1) minutes', () => {
    expect(reminderGapMs(1, 2)).toBe(2 * MIN)
    expect(reminderGapMs(2, 2)).toBe(4 * MIN)
    expect(reminderGapMs(3, 2)).toBe(8 * MIN)
  })

  it('the gaps add up to the offsets (the scheduler and the helper line can never disagree)', () => {
    for (const first of [1, 2, 5, 10, 15]) {
      for (let count = 1; count <= 5; count++) {
        let sum = 0
        for (let k = 1; k <= count; k++) sum += reminderGapMs(k, first)
        expect(sum).toBe((reminderOffsetsMinutes(count, first).at(-1) ?? 0) * MIN)
      }
    }
  })
})
