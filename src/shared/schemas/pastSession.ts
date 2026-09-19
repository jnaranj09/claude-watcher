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
    endedAt: z.number().int().nonnegative()
  })
  .strict()
export type PastSession = z.infer<typeof PastSessionSchema>

/** `past-sessions:forget` and `past-sessions:open` args. */
export const PastSessionForgetSchema = z.object({ id: PastSessionIdSchema })
export type PastSessionForgetRequest = z.infer<typeof PastSessionForgetSchema>
export const PastSessionOpenSchema = z.object({ id: PastSessionIdSchema })
export type PastSessionOpenRequest = z.infer<typeof PastSessionOpenSchema>

export const PAST_SESSIONS_FILE_VERSION = 1 as const
/** Newest first; the 201st archive drops the oldest (D-9). */
export const PAST_SESSIONS_MAX = 200

export const PastSessionsFileSchema = z.object({
  version: z.literal(PAST_SESSIONS_FILE_VERSION),
  sessions: z.array(PastSessionSchema)
})
export type PastSessionsFile = z.infer<typeof PastSessionsFileSchema>

export const EMPTY_PAST_SESSIONS_FILE: PastSessionsFile = {
  version: PAST_SESSIONS_FILE_VERSION,
  sessions: []
}
