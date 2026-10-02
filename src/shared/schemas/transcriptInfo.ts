// Resume by id — ONE line of claude's transcript (`<configDir>/projects/*/<id>.jsonl`), read only
// for the folder and the title (pty/claudeTranscriptInfo.ts). claude's shape, not ours:
// `.passthrough()`, every field optional, so a new claude line type passes; a known key with the
// wrong type fails the LINE (it is skipped), never the file. Field names checked on real
// transcripts 2026-10-02: `cwd` on user/assistant/attachment lines, `customTitle` on
// `type:"custom-title"`, `aiTitle` on `type:"ai-title"`. NEVER log a parsed value: cwd is the
// filesystem layout, a title is conversation content.
import { z } from 'zod'

export const TranscriptInfoLineSchema = z
  .object({
    type: z.string().optional(),
    cwd: z.string().min(1).optional(),
    customTitle: z.string().min(1).optional(),
    aiTitle: z.string().min(1).optional()
  })
  .passthrough()
export type TranscriptInfoLine = z.infer<typeof TranscriptInfoLineSchema>
