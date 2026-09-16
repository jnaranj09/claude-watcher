// Programmatic API — the ONE place a board session becomes a wire session.
//
// `Session` is the reducer's full truth: it carries `firstPrompt`, `latestMessage` and
// `pendingToolInput` (the operator's prompts, claude's prose, a tool's arguments). `ApiSession`
// carries none of that. Narrowing in one function is what makes that a guarantee instead of a
// habit — and the `.strict()` safeParse is what makes the guarantee survive a NEW field being
// added to `Session` later: an extra key fails the parse, so the leak shows up as a dropped
// session in a test, never as content on the wire.
//
// A session with no column yet projects to NULL rather than to a guessed position: the tracker
// places a session, and a card at an invented column with an invented `enteredColumnAt` would
// sort wrong on the client's board for as long as it lived.
//
// Both failures return null, but they are NOT the same event and a caller holding the null cannot
// tell them apart — which is why the log lives here. "Not placed in a column yet" is benign and
// transient (it happens on every launch, and the next delta fixes it), so it is SILENT: logging it
// would bury the other one. A strict-parse rejection is the DRIFT the schema exists to catch — a
// session that no longer fits the shape the wire promises — so it logs a `code=` and nothing else:
// the rejected input carries a `projectPath` and a session name, and a ZodError stringifies its
// input, so neither the error nor the issue path may be logged.
// [src/shared/schemas/api.ts (why strict); .claude/rules/zod-boundaries.md]
import type { Column, SessionUpdatedEvent } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import { ApiSessionSchema, type ApiSession } from '../../shared/schemas/api'

/** The board position, read from the Story-1.2 attention tracker. */
export interface ApiSessionSource {
  columnOf(id: string): Column | undefined
  enteredColumnAt(id: string): number | undefined
}

/** The one fixed line either projection logs. No path, no value — see the file header. */
const PROJECTION_FAILED = '[claude-watcher][api] code=session_projection_failed'

/** STATE ONLY: no pendingToolInput / latestMessage / firstPrompt / pid. Null until the tracker
 *  has placed the session in a column (silent), or when the strict parse rejects the session
 *  (logged by code). Validated with the strict schema so a new Session field can never leak by
 *  accident. `log` is optional so a caller that only wants the value need not pass one. */
export function projectApiSession(
  session: Session,
  source: ApiSessionSource,
  log?: (line: string) => void
): ApiSession | null {
  const column = source.columnOf(session.id)
  const enteredColumnAt = source.enteredColumnAt(session.id)
  if (column === undefined || enteredColumnAt === undefined) return null
  const r = ApiSessionSchema.safeParse({
    id: session.id,
    sessionName: session.sessionName,
    status: session.status,
    column,
    enteredColumnAt,
    workspaceId: session.workspaceId,
    tagIds: session.tagIds,
    projectPath: session.projectPath,
    // `exactOptionalPropertyTypes`: spread the key in only when it exists — an explicit
    // `pendingToolName: undefined` is a different thing from an absent one to both TS and the
    // strict schema.
    ...(session.pendingToolName !== undefined ? { pendingToolName: session.pendingToolName } : {})
  })
  if (!r.success) {
    log?.(PROJECTION_FAILED)
    return null
  }
  return r.data
}

/** The same projection from an already-enriched delta: the event carries the tracker's column
 *  and `enteredColumnAt` itself, so no source is needed — which means its ONLY null is the
 *  strict-parse rejection, and it is always logged. */
export function projectApiSessionFromEvent(
  event: SessionUpdatedEvent,
  log?: (line: string) => void
): ApiSession | null {
  const r = ApiSessionSchema.safeParse({
    id: event.id,
    sessionName: event.sessionName,
    status: event.status,
    column: event.column,
    enteredColumnAt: event.enteredColumnAt,
    workspaceId: event.workspaceId,
    tagIds: event.tagIds,
    projectPath: event.projectPath,
    ...(event.pendingToolName !== undefined ? { pendingToolName: event.pendingToolName } : {})
  })
  if (!r.success) {
    log?.(PROJECTION_FAILED)
    return null
  }
  return r.data
}
