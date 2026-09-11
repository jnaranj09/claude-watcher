// Attention reminders — the one line under the Settings reminder rows. It uses the SAME math as
// main's scheduler (src/shared/attention/reminderSchedule.ts), so the line always matches the
// popups the operator will actually get. Kept out of Settings.tsx so that file exports only
// components.
import { reminderOffsetsMinutes } from '../../../../shared/attention/reminderSchedule'

export function reminderSummary(count: number, firstDelayMinutes: number): string {
  if (count === 0) return 'Off — one alert per permission prompt or question'
  const offsets = reminderOffsetsMinutes(count, firstDelayMinutes).map((m) => `+${m}`)
  return `For permission prompts and questions: ${offsets.join(', ')} min`
}
