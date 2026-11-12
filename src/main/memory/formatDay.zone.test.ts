// The local day near midnight in Europe/Berlin (`zone-berlin` project, vitest.config.ts): the UTC
// and local days differ there, so a formatter built on `toISOString` fails the first case.
import { describe, expect, it } from 'vitest'
import { formatDay } from './formatDay'

describe('formatDay in Europe/Berlin', () => {
  it('runs in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('00:30 local on the 12th reads as the 12th, though UTC is still the 11th', () => {
    expect(formatDay(new Date(2026, 10, 12, 0, 30).getTime())).toBe('2026-11-12')
  })

  it('23:30 local on the 11th reads as the 11th', () => {
    expect(formatDay(new Date(2026, 10, 11, 23, 30).getTime())).toBe('2026-11-11')
  })

  it('pads month and day', () => {
    expect(formatDay(new Date(2026, 2, 5, 12).getTime())).toBe('2026-03-05')
  })
})
