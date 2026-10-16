// Day windows across a clock change (spec 2026-10-16 §1). Runs in the `zone-berlin` project
// (vitest.config.ts), so the zone is Europe/Berlin on every machine: Oct 25 2026 has 25 hours there
// and Mar 29 2026 has 23. A window built by adding 24 h fails both.
import { describe, it, expect } from 'vitest'
import { dayWindow } from './sessionFilters'

const HOUR = 3_600_000

describe('dayWindow in a zone with clock changes', () => {
  it('runs in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('the day the clocks go back is 25 hours long', () => {
    const { start, end } = dayWindow('2026-10-25')
    expect(end - start).toBe(25 * HOUR)
  })

  it('the day the clocks go forward is 23 hours long', () => {
    const { start, end } = dayWindow('2026-03-29')
    expect(end - start).toBe(23 * HOUR)
  })
})
