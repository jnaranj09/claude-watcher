// The Calendar's pure date maths: Monday-first month grids over LOCAL day keys ('YYYY-MM-DD').
// Built from calendar fields (`new Date(y, m, d)`), never by adding 24 h.
import { dayKey, dayWindow } from '../../lib/sessionFilters'

export interface MonthRef {
  year: number
  /** 0-11. */
  month: number
}

/** How far back the month arrows go (spec 2026-10-16, `[AGENT]`). */
export const CALENDAR_BACK_MONTHS = 12

export function monthOf(day: string): MonthRef {
  const d = new Date(dayWindow(day).start)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function addMonths(m: MonthRef, n: number): MonthRef {
  const d = new Date(m.year, m.month + n, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(dayWindow(day).start)
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime())
}

/** Rows of 7 day keys, Monday first; `null` pads the first and last week. */
export function monthWeeks(m: MonthRef): (string | null)[][] {
  const first = new Date(m.year, m.month, 1)
  const lead = (first.getDay() + 6) % 7 // Monday = 0
  const days = new Date(m.year, m.month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) cells.push(dayKey(new Date(m.year, m.month, d).getTime()))
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** The same day number in month `m`, or that month's last day when it is shorter (PageUp/Down). */
export function sameDayInMonth(day: string, m: MonthRef): string {
  const last = new Date(m.year, m.month + 1, 0).getDate()
  const d = Math.min(Number(day.slice(8)), last)
  return dayKey(new Date(m.year, m.month, d).getTime())
}

export function monthTitle(m: MonthRef): string {
  return new Date(m.year, m.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })
}
