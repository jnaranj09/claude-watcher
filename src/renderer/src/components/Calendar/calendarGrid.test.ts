import { describe, it, expect } from 'vitest'
import { addMonths, monthOf, monthWeeks, sameDayInMonth, shiftDay } from './calendarGrid'

describe('calendarGrid', () => {
  it('October 2026 starts on a Thursday in a Monday-first week', () => {
    const weeks = monthWeeks({ year: 2026, month: 9 })
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04'
    ])
    expect(
      weeks
        .at(-1)
        ?.filter((d) => d !== null)
        .at(-1)
    ).toBe('2026-10-31')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('addMonths crosses a year', () => {
    expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })

  it('shiftDay moves by calendar days', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('monthOf reads a day key', () => {
    expect(monthOf('2026-10-14')).toEqual({ year: 2026, month: 9 })
  })

  it('sameDayInMonth keeps the day number, or falls back to the last day', () => {
    expect(sameDayInMonth('2026-10-14', { year: 2026, month: 8 })).toBe('2026-09-14')
    expect(sameDayInMonth('2026-03-31', { year: 2026, month: 1 })).toBe('2026-02-28')
  })
})
