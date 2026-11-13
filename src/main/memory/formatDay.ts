// A local calendar day as 'YYYY-MM-DD', for the dates memory shows claude ("seen 2026-11-11"), and
// the count of local days between two times ("last seen 3 days ago").
// Main cannot import the renderer's `dayKey` (layers), so this is the main-side copy.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The LOCAL calendar day of `ms`, as 'YYYY-MM-DD'. */
export function formatDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DAY_MS = 86_400_000

/** The local calendar day of `ms` as a day number: a day across a DST change still counts one. */
function dayNumber(ms: number): number {
  const d = new Date(ms)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

/** Local calendar days from `then` to `now`; 0 when `then` is today or later. */
export function localDaysBetween(then: number, now: number): number {
  return Math.max(0, dayNumber(now) - dayNumber(then))
}
