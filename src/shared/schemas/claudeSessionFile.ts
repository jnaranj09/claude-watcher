// The claude PER-PROCESS SESSION RECORD adapter — the third external Zod boundary of the app.
//
// Claude Code (verified on 2.1.257, 2026-09-01) keeps one JSON file per running process at
// `~/.claude/sessions/<pid>.json`, rewritten whenever the process's state changes. It carries
// the process's CURRENT session id — which is the ONE fact no hook ever states: when the
// operator runs `/clear`, the same process keeps running under a NEW id, and the only place
// claude records "pid P is now session B" is this file. The session-rebind guard
// (src/main/hooks/sessionRebind.ts) reads it to move a launched terminal's card onto the new
// id with an EXACT proof, instead of the cwd-plus-time-window heuristic.
//
// The app reads TWO fields and nothing else. `.passthrough()` keeps the rest (cwd, name,
// status, socket path, …) so a claude addition never fails the record, while a malformation of
// the two keys the app depends on fails CLOSED (the record is ignored; no adoption happens).
//
// NEVER LOG THE VALUE. The file holds the operator's cwd and session name; a ZodError
// stringifies its input. Consumers return `null` and stay silent.
// [.claude/rules/zod-boundaries.md]

import { z } from 'zod'

export const ClaudeSessionFileSchema = z
  .object({
    /** The recording process's pid. Must agree with the file name (`<pid>.json`). */
    pid: z.number().int().positive(),
    /** The session id this process CURRENTLY runs under (the identity key). */
    sessionId: z.string().min(1)
  })
  .passthrough()

export type ClaudeSessionFile = z.infer<typeof ClaudeSessionFileSchema>

/**
 * Total, never-throwing parse of an already-`JSON.parse`d value. `null` for anything that is
 * not a well-formed record — the caller treats that as "no proof" and never logs why.
 */
export function parseClaudeSessionFile(raw: unknown): ClaudeSessionFile | null {
  const result = ClaudeSessionFileSchema.safeParse(raw)
  return result.success ? result.data : null
}
