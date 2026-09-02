// Transcript signals — the PURE reader that turns one transcript line into the two facts
// no Claude Code hook reports.
//
// WHY THIS EXISTS. Pressing Esc fires NO hook whatsoever — probe-verified twice on claude
// 2.1.250 (2026-08-27), with both `command` and `http` hooks: 12 events captured before
// the keypress, 12 after, and no `idle_prompt` notification even after 90s of sitting
// interrupted. Without this reader the card keeps whatever the last tool event said
// (`Working`) until the operator next uses the session.
// This used to also read `<task-notification>` blocks to learn when background work
// finished. That is gone: the `Stop` payload states it outright in `background_tasks`
// (see backgroundTasks.ts), so reconstructing it here was wasted machinery. The interrupt
// is the ONE fact with no hook of any kind behind it, so this module now does one job.
//
// PURE + TOTAL: no I/O, no logging (a transcript line is the most sensitive input in the
// app — it holds the operator's whole conversation), and it NEVER throws. Anything
// unrecognized yields `null` and the line is dropped. The worst case is a MISSED signal,
// never a wrong one. [.claude/rules/zod-boundaries.md]

import { TranscriptEntrySchema, transcriptText } from '../../shared/schemas/transcriptEntry'

export type TranscriptSignalResult = { kind: 'interrupted' }

/**
 * The exact interrupt markers claude writes. Counted across the local transcript corpus:
 * 47 plain, 36 for-tool-use.
 *
 * MATCHED WHOLE, NEVER AS A SUBSTRING. The same corpus contains sessions that merely
 * DISCUSS interrupts (this feature was designed in one), and a substring match would flip
 * those sessions to idle in the middle of a real turn.
 */
const INTERRUPT_MARKERS: ReadonlySet<string> = new Set([
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]'
])

/** A completed `<task-notification>` block: the wrapper, a task id, and a completed
 *  status. All three are required — an INTERMEDIATE monitor event carries the wrapper and
 *  the id but NO completed status, and the monitor is still armed at that point. */

/**
 * Read one raw (already `JSON.parse`d) transcript line and return the signal it carries,
 * or `null` for the overwhelming majority of lines that carry none.
 */
export function transcriptSignal(raw: unknown): TranscriptSignalResult | null {
  const parsed = TranscriptEntrySchema.safeParse(raw)
  if (!parsed.success) return null // drop quietly — never log, never throw

  const entry = parsed.data
  // Both signals are delivered as `user` entries (claude injects them into the
  // conversation). Ignoring other types stops an assistant message that QUOTES a marker
  // from firing it.
  if (entry.type !== 'user') return null

  const text = transcriptText(entry)
  if (text === null) return null

  if (INTERRUPT_MARKERS.has(text.trim())) return { kind: 'interrupted' }

  return null
}
