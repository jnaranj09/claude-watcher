// Past sessions (D-9) — the main-owned history of archived sessions. Own file
// (`claude-watcher-past-sessions.json`) so a corrupt history can never reset settings, templates
// or workspaces. NEVER log a record value (name = operator text, cwd = filesystem layout) — codes
// only. Claude's own files under ~/.claude are never touched by anything here (D-4).
import {
  EMPTY_PAST_SESSIONS_FILE,
  PAST_SESSIONS_FILE_VERSION,
  PAST_SESSIONS_MAX,
  PastSessionsFileSchema,
  type PastSession,
  type PastSessionsFile
} from '../../shared/schemas/pastSession'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore
} from './persistedBlob'

export type PastSessionsBlobStore = PersistedBlobStore<PastSessionsFile>

export interface PastSessionsStoreOptions {
  blobStore?: PastSessionsBlobStore
  log?: (message: string) => void
  /** A record can only be LISTED while its workspace exists (the delete cascade guarantees it).
   *  One that names a missing workspace — a hand-edited file, or a workspaces file that was
   *  corrupt and reset to Default — is KEPT in the file and hidden (UX-03): restoring the
   *  workspaces backup brings it back. index.ts wires it to the workspaces store; the default
   *  says every workspace exists. */
  workspaceExists?: (workspaceId: string) => boolean
}

export interface PastSessionsStore {
  /** What the dialog shows, newest first (`endedAt` desc; ties by id for a stable order): never
   *  a `live` record, never one whose workspace is gone. */
  list(): PastSession[]
  /** A listed record, or a live one (Open then answers `already_open`). Null for a hidden one. */
  get(id: string): PastSession | null
  /** Upsert by id (a resumed session that ends again overwrites its own record), then keep the
   *  `PAST_SESSIONS_MAX` newest. Returns the new list. Trusts its typed input: the removal
   *  chokepoint builds the record from main-owned session truth (pastSessionRecord.ts). */
  archive(record: PastSession): PastSession[]
  /** UX-01 — upsert the record of a card that is ON the board, marked `live`. Hidden from
   *  `list()`, never trimmed. A later `archive` of the same id overwrites it; a crash leaves it
   *  for the next start to turn into a normal record. */
  markLive(record: PastSession): void
  /** The card left WITHOUT an archive (a `/clear` rebind's old id): drop its record, but ONLY
   *  while it is still live — an archived or deleted one is not this call's to touch. */
  dropLive(id: string): void
  /** Idempotent. Returns the new list. */
  remove(id: string): PastSession[]
  /** Workspaces — delete every record in `workspaceId`. Called ONLY by the workspaces store's
   *  cascade, after a delete was allowed. Returns how many were removed. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][past-sessions]'

export function createPastSessionsStore(options: PastSessionsStoreOptions = {}): PastSessionsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<PastSessionsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const workspaceExists = options.workspaceExists ?? ((): boolean => true)
  const byId = new Map<string, PastSession>()

  const loaded = loadPersistedOrReset<PastSessionsFile>({
    blobStore,
    parse: (raw) => PastSessionsFileSchema.parse(raw),
    fallback: () => EMPTY_PAST_SESSIONS_FILE,
    onProblem: (code) => log(`${LOG_PREFIX} code=past_sessions_${code}`)
  })
  let hidden = 0
  let recovered = 0
  for (const record of loaded.sessions) {
    // UX-01 — nothing is on the board yet (one instance per profile), so a record still marked
    // live was left by a run that died without archiving it: it is a normal record now, ended at
    // the last time that run saw the card.
    if (record.live === true) {
      recovered += 1
      byId.set(record.id, ended(record))
    } else {
      byId.set(record.id, record)
    }
    if (!workspaceExists(record.workspaceId)) hidden += 1
  }
  if (recovered > 0) log(`${LOG_PREFIX} code=past_sessions_recovered_live count=${recovered}`)
  if (hidden > 0) log(`${LOG_PREFIX} code=past_sessions_hidden_unknown_workspace count=${hidden}`)
  trim()
  persist()

  /** Every record, hidden ones included — what the FILE holds. */
  function all(): PastSession[] {
    return [...byId.values()].sort(newestFirst)
  }

  function persist(): void {
    try {
      blobStore.write({ version: PAST_SESSIONS_FILE_VERSION, sessions: all() })
    } catch {
      log(`${LOG_PREFIX} code=past_sessions_write_failed`)
    }
  }

  function list(): PastSession[] {
    return all().filter((r) => r.live !== true && workspaceExists(r.workspaceId))
  }

  function get(id: string): PastSession | null {
    const record = byId.get(id)
    if (record === undefined || !workspaceExists(record.workspaceId)) return null
    return record
  }

  /** Keep the newest `PAST_SESSIONS_MAX` ended records. A live one is never evicted: it is a
   *  session still running, and evicting it would lose it the moment the app dies. */
  function trim(): void {
    const endedRecords = all().filter((r) => r.live !== true)
    for (const stale of endedRecords.slice(PAST_SESSIONS_MAX)) byId.delete(stale.id)
  }

  /** The new record, keeping the transcript path an earlier write learned: the hook that
   *  carries it may not have reached this run yet (a resumed session writes the same file). */
  function merged(record: PastSession): PastSession {
    const next: PastSession = { ...record, tagIds: [...record.tagIds] }
    const known = byId.get(record.id)?.transcriptPath
    if (next.transcriptPath === undefined && known !== undefined) next.transcriptPath = known
    return next
  }

  function archive(record: PastSession): PastSession[] {
    byId.set(record.id, ended(merged(record)))
    trim()
    persist()
    return list()
  }

  function markLive(record: PastSession): void {
    byId.set(record.id, { ...merged(record), live: true })
    persist()
  }

  function dropLive(id: string): void {
    if (byId.get(id)?.live !== true) return
    byId.delete(id)
    persist()
  }

  function remove(id: string): PastSession[] {
    if (byId.delete(id)) persist()
    return list()
  }

  function removeByWorkspace(workspaceId: string): number {
    let removed = 0
    for (const [id, record] of byId) {
      if (record.workspaceId === workspaceId) {
        byId.delete(id)
        removed += 1
      }
    }
    if (removed > 0) persist()
    return removed
  }

  return { list, get, archive, markLive, dropLive, remove, removeByWorkspace }
}

/** The record without its `live` mark. */
function ended(record: PastSession): PastSession {
  const rest = { ...record }
  delete rest.live
  return rest
}

function newestFirst(a: PastSession, b: PastSession): number {
  if (b.endedAt !== a.endedAt) return b.endedAt - a.endedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
