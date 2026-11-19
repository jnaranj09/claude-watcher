// The composed fallback name near midnight in Europe/Berlin (`zone-berlin` project): the day is the
// local one. The day rule itself is tested in `formatDay.zone.test.ts`.
import { describe, expect, it } from 'vitest'
import { sessionGoalName } from './sessionGoal'

describe('sessionGoalName in Europe/Berlin', () => {
  it('runs in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('00:30 local on the 18th names the 18th, though UTC is still the 17th', () => {
    const at = new Date(2026, 10, 18, 0, 30).getTime()
    expect(sessionGoalName(null, '/home/u/proj', at)).toBe('proj 2026-11-18')
    expect(sessionGoalName(null, null, at)).toBe('Session 2026-11-18')
  })
})
