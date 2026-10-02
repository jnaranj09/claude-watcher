// Past sessions (D-7) — the archived-session record and its file/IPC boundaries. OUR shape:
// `.strict()` (state only — no prompt, no latestMessage, no pendingToolInput, no pid; the same
// rule as the API's ApiSession). NEVER log a record value: `name` is operator text and `cwd` is
// the filesystem layout — log issue path + code only.
import { z } from 'zod'
import { SessionNameSchema } from './launch'
import { WorkspaceIdSchema } from './workspace'

/** Not `.uuid()` — existence is the store's call (`not_found`), same reasoning as TemplateIdSchema. */
export const PastSessionIdSchema = z.string().min(1)

export const PastSessionSchema = z
  .object({
    /** Claude's LATEST session id (D-8) — a `/clear` re-keys the card, and the archive writes
     *  the id the card ended under, so Open resumes the current conversation. */
    id: PastSessionIdSchema,
    /** The card name when it left the board. */
    name: SessionNameSchema,
    /** The launch folder — `claude --resume` runs there. */
    cwd: z.string().min(1),
    /** Tied by id, never by name: a workspace rename changes nothing; a workspace delete
     *  cascades (the store's `removeByWorkspace`). */
    workspaceId: WorkspaceIdSchema,
    /** `.default([])` is the additive-field rule: a record written without it must still load. */
    tagIds: z.array(z.string().min(1)).default([]),
    launchedAt: z.number().int().nonnegative(),
    /** For a `live` record: the last time main saw the card (refreshed at most once a minute),
     *  which becomes the end time if the app dies without archiving it (UX-01). */
    endedAt: z.number().int().nonnegative(),
    /** Present (and `true`) ONLY while the card is on the board (UX-01, UX-02). Written at launch
     *  so a crash, SIGKILL or power loss still leaves a record; the next start turns it into a
     *  normal one. The dialog never lists a live record and the 200 cap never evicts one.
     *  Optional, not `.default(false)`: absent = ended, and the file stays version 1. */
    live: z.literal(true).optional(),
    /** Claude's own transcript for this id, from the hook payload's `transcript_path` (UX-08).
     *  Open refuses with `transcript_missing` when it is gone. A record without it (older
     *  records, or a session no hook ever reached) is not checked. Never logged. */
    transcriptPath: z.string().min(1).optional()
  })
  .strict()
export type PastSession = z.infer<typeof PastSessionSchema>

/** `past-sessions:forget` and `past-sessions:open` args. */
export const PastSessionForgetSchema = z.object({ id: PastSessionIdSchema })
export type PastSessionForgetRequest = z.infer<typeof PastSessionForgetSchema>
export const PastSessionOpenSchema = z.object({ id: PastSessionIdSchema })
export type PastSessionOpenRequest = z.infer<typeof PastSessionOpenSchema>

/** UX-10 — `past-sessions:resume-terminal`: resume what a DEAD terminal last ran. Only the
 *  terminal id crosses: main resolves the session id from its own launch record. */
export const PastSessionResumeTerminalSchema = z.object({ terminalId: z.string().min(1) }).strict()
export type PastSessionResumeTerminalRequest = z.infer<typeof PastSessionResumeTerminalSchema>

/** A claude session id as claude writes it (`--session-id`, `<id>.jsonl`). Case-insensitive: a
 *  paste may be upper case. Also the transcript lookup's guard (claudeTranscript.ts): it never
 *  builds a path from anything else. */
export const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `past-sessions:import` — Resume by id: a claude session the app did not launch. Only the id
 *  and the ACTIVE workspace cross; main reads the folder and the name from claude's transcript.
 *  The renderer trims; a padded id fails here. */
export const PastSessionImportSchema = z
  .object({
    id: z.string().regex(CLAUDE_SESSION_ID_PATTERN),
    workspaceId: WorkspaceIdSchema
  })
  .strict()
export type PastSessionImportRequest = z.infer<typeof PastSessionImportSchema>

export const PAST_SESSIONS_FILE_VERSION = 1 as const
/** Newest first; the 201st archive drops the oldest (D-9). */
export const PAST_SESSIONS_MAX = 200
/** UX-03 — records whose workspace is gone are HIDDEN and kept for a workspaces-backup restore.
 *  They do not count toward `PAST_SESSIONS_MAX` (a row the dialog cannot show must never evict one
 *  it can), so they carry their own cap: past it the oldest hidden record is dropped. */
export const PAST_SESSIONS_HIDDEN_MAX = 200

export const PastSessionsFileSchema = z.object({
  version: z.literal(PAST_SESSIONS_FILE_VERSION),
  sessions: z.array(PastSessionSchema)
})
export type PastSessionsFile = z.infer<typeof PastSessionsFileSchema>

export const EMPTY_PAST_SESSIONS_FILE: PastSessionsFile = {
  version: PAST_SESSIONS_FILE_VERSION,
  sessions: []
}
