// The claude TRANSCRIPT-LINE adapter — the second external Zod boundary of the app.
//
// Claude Code appends one JSON object per line to the session transcript named by every
// hook payload's `transcript_path`. The app reads that file for two things:
//
//   1. THE TURN WAS INTERRUPTED (PROBE-VERIFIED on claude 2.1.250, 2026-08-27). Pressing
//      Esc emits NO hook at all — not `Stop`, not `Notification`, nothing, not even after
//      90s. The transcript is the only place it is recorded, and it lands there the
//      instant it happens (`hooks/transcriptSignal.ts`).
//   2. SAVING MEMORY FROM A SESSION (memory phase 2): the conversation itself — prompts,
//      tool calls and tool results — read past the bytes already saved.
//
// FAIL-CLOSED, DROP-QUIETLY. A transcript holds many entry types the app does not care
// about, so an unparseable or uninteresting line is simply DROPPED — it yields no signal
// and never poisons the session. That is the fail-closed posture for this boundary: the
// worst case is a missed signal, never a wrong one, and never a crash.
//
// NEVER-LOG-THE-VALUE, EMPHATICALLY. This file is the most sensitive input in the app: a
// transcript contains the operator's entire conversation — prompts, file contents, tool
// output, assistant prose. NOTHING here is ever logged, not a path, not a value, not a
// ZodError (which stringifies its input). [.claude/rules/zod-boundaries.md]

import { z } from 'zod'

/**
 * One transcript line: the fields the interrupt watcher reads, plus the keys saving memory from
 * a session reads (memory phase 2).
 *
 * `message.content` is POLYMORPHIC — a plain string for simple messages, an array of
 * parts (`{ type, text }`) for structured ones. Both observed live; accept both and do
 * NOT narrow to one. `.passthrough()` throughout so claude's many other fields ride along
 * untouched and a new entry type never fails the line.
 *
 * The memory keys are LOOSE on purpose (`z.unknown().optional()`): no new key can fail a line,
 * so the interrupt watcher never loses one to them. Their reader narrows each key where it reads
 * it, and skips a part or line whose key has another type there, never here.
 */
const LooseKey = z.unknown().optional()

const ContentPartSchema = z
  .object({
    text: z.string().optional(),
    type: LooseKey,
    id: LooseKey,
    name: LooseKey,
    input: LooseKey,
    tool_use_id: LooseKey,
    is_error: LooseKey,
    content: LooseKey
  })
  .passthrough()

export const TranscriptEntrySchema = z
  .object({
    type: z.string().optional(), // 'user' | 'assistant' | many others; NOT enum-locked
    sessionId: z.string().optional(), // matches the hook `session_id` when present
    uuid: LooseKey,
    isSidechain: LooseKey,
    isMeta: LooseKey,
    isCompactSummary: LooseKey,
    promptSource: LooseKey,
    toolUseResult: LooseKey,
    message: z
      .object({
        content: z.union([z.string(), z.array(ContentPartSchema)]).optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>

/**
 * Flatten a transcript entry's polymorphic content to plain text, or `null` when it
 * carries none. Array parts are joined so a multi-part message reads as one string.
 */
export function transcriptText(entry: TranscriptEntry): string | null {
  const content = entry.message?.content
  if (content === undefined) return null
  if (typeof content === 'string') return content
  return content.map((part) => part.text ?? '').join('')
}
