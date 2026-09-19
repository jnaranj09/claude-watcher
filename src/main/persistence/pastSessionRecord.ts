// Past sessions (D-7) — the ONE place a board session becomes an archive record. Field by field,
// never a spread: `Session` carries prompts, claude's prose and a tool's input, and none of that
// may reach the history file. The strict PastSessionSchema is the second guard.
import type { Session } from '../../shared/schemas/session'
import type { PastSession } from '../../shared/schemas/pastSession'

export function buildPastSessionRecord(session: Session, endedAt: number): PastSession {
  return {
    id: session.id, // claude's LATEST id — adoptCard re-keys the card on /clear (D-8)
    name: session.sessionName,
    cwd: session.projectPath,
    workspaceId: session.workspaceId,
    tagIds: [...session.tagIds],
    launchedAt: session.launchedAt ?? endedAt,
    endedAt
  }
}
