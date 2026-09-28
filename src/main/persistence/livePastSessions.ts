// Live past-session records (UX-01, UX-02, UX-08 in docs/reports/2026-09-23-bug-hunt).
//
// A record used to be written only when a card LEFT the board (Archive, exit, quit, window close).
// A crash, SIGKILL, OOM kill or power loss runs none of those, so every live session vanished from
// Past sessions and the operator had to find the ids and run `claude --resume` by hand. Now the
// record is written while the card is still on the board, marked `live` (hidden from the dialog),
// and the next start turns a leftover one into a normal record.
//
// Fed from handleDelta — the one chokepoint every card change and removal passes through — and
// from the hook ingest, which is where claude's `transcript_path` arrives. It writes only when
// the record would change (name, folder, workspace, tags, transcript) or its `endedAt` is older
// than `refreshMs`, so a busy session costs at most one file write a minute.
//
// Never throws, never logs a record value.
import type { Session } from '../../shared/schemas/session'
import type { PastSession } from '../../shared/schemas/pastSession'
import { buildPastSessionRecord } from './pastSessionRecord'

/** The two store calls this needs — structurally satisfied by `PastSessionsStore`. */
export interface LivePastSessionsSeam {
  markLive(record: PastSession): void
  dropLive(id: string): void
}

/** How stale a live record's `endedAt` may get: the end time a crash leaves behind. */
export const LIVE_RECORD_REFRESH_MS = 60_000

export interface LivePastSessions {
  /** A launched card changed (or appeared): write its live record if it would differ. */
  onSession(session: Session): void
  /** A hook named this session's transcript. A new path is written at once. */
  notePath(session: Session, transcriptPath: string): void
  /** The card left the board. After an Archive the record is already ended (no-op); after a
   *  `/clear` rebind the old id's live record is dropped — the new id has its own. */
  onRemoved(sessionId: string): void
}

export function createLivePastSessions(deps: {
  /** Null until app-ready builds the store (a delta before then is a no-op). */
  store: () => LivePastSessionsSeam | null
  now: () => number
  refreshMs?: number
}): LivePastSessions {
  const refreshMs = deps.refreshMs ?? LIVE_RECORD_REFRESH_MS
  const written = new Map<string, { key: string; at: number }>()
  const paths = new Map<string, string>()

  function onSession(session: Session): void {
    const store = deps.store()
    if (store === null) return
    const now = deps.now()
    const record = buildPastSessionRecord(session, now)
    const path = paths.get(session.id)
    if (path !== undefined) record.transcriptPath = path
    const key = JSON.stringify([
      record.name,
      record.cwd,
      record.workspaceId,
      record.tagIds,
      record.launchedAt,
      path ?? null
    ])
    const last = written.get(session.id)
    if (last !== undefined && last.key === key && now - last.at < refreshMs) return
    store.markLive(record)
    written.set(session.id, { key, at: now })
  }

  return {
    onSession,
    notePath(session, transcriptPath) {
      if (transcriptPath.length === 0 || paths.get(session.id) === transcriptPath) return
      paths.set(session.id, transcriptPath)
      onSession(session)
    },
    onRemoved(sessionId) {
      written.delete(sessionId)
      paths.delete(sessionId)
      deps.store()?.dropLive(sessionId)
    }
  }
}
