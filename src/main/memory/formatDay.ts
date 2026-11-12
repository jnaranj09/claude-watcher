// A local calendar day as 'YYYY-MM-DD', for the dates memory shows claude ("seen 2026-11-11").
// Main cannot import the renderer's `dayKey` (layers), so this is the main-side copy.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The LOCAL calendar day of `ms`, as 'YYYY-MM-DD'. */
export function formatDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
