// Past sessions (D-7) — the ONE place a board session becomes an archive record. Field by field,
// never a spread: `Session` carries prompts, claude's prose and a tool's input, and none of that
// may reach the history file. The strict PastSessionSchema is the second guard.
import type { Session } from '../../shared/schemas/session'
import type { PastSession } from '../../shared/schemas/pastSession'
import type { RemovalReason } from '../pty/launchRemoval'

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

/** The narrow past-sessions WRITE seam this decision needs — `archive`/`remove` only, structurally
 *  satisfied by `PastSessionsStore` (persistence/pastSessions.ts). Nullable, mirroring
 *  `pastSessionsStore` in index.ts (never-crash: no store yet ⇒ the decision is still made, just
 *  nothing is written). */
export interface PastSessionsWriteSeam {
  archive(record: PastSession): unknown
  remove(id: string): unknown
}

/**
 * Past sessions (D-3) — the PURE reason → history decision, extracted out of index.ts's
 * `removeLaunchedSession` so it is unit-testable without Electron (index.ts wiring itself is not
 * node-testable). `archive` writes the record built by `buildPastSessionRecord` — but ONLY when
 * `stored` is defined: a late SessionEnd for a card that already left the board must write no
 * record and log nothing (a quiet no-op, not an error). `delete` writes no record and removes any
 * earlier one for `sessionId` instead (D-4: the app's own record only, never claude's files). A
 * null `store` (no store yet) is a no-op either way — never-crash.
 */
export function applyRemovalReason(
  reason: RemovalReason,
  sessionId: string,
  stored: Session | undefined,
  store: PastSessionsWriteSeam | null,
  endedAt: number
): void {
  if (reason === 'archive') {
    if (stored !== undefined) store?.archive(buildPastSessionRecord(stored, endedAt))
  } else {
    store?.remove(sessionId)
  }
}
