// Attention reminders — the ONE place the reminder timing math lives. Pure; imported by main
// (the scheduler, src/main/kde/attentionReminders.ts) and by the renderer (the Settings helper
// line), so the popups and the line that describes them cannot disagree.
//
// Reminder k (1-based) waits first × 2^(k−1) minutes after reminder k−1 (reminder 0 = the moment
// the session became blocked). So reminder k lands first × (2^k − 1) minutes into the wait: with
// the defaults (first = 2) that is +2, +6, +14.
// [Source: docs/superpowers/specs/2026-09-10-attention-reminders-design.md D-2]

const MINUTE_MS = 60_000

/** The wait in ms before reminder `k` (1-based), measured from the previous reminder. */
export function reminderGapMs(k: number, firstDelayMinutes: number): number {
  return firstDelayMinutes * 2 ** (k - 1) * MINUTE_MS
}

/** Minutes from the start of the wait to each reminder, in order. A count of 0 → `[]`. */
export function reminderOffsetsMinutes(count: number, firstDelayMinutes: number): number[] {
  const offsets: number[] = []
  for (let k = 1; k <= count; k++) offsets.push(firstDelayMinutes * (2 ** k - 1))
  return offsets
}
