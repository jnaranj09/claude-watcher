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
  /** A record can only name a workspace that exists (the delete cascade guarantees it). A
   *  hand-edited file that says otherwise is dropped on load, by code. index.ts wires it to the
   *  workspaces store; the default says every workspace exists. */
  workspaceExists?: (workspaceId: string) => boolean
}

export interface PastSessionsStore {
  /** Newest first (`endedAt` desc; ties by id for a stable order). */
  list(): PastSession[]
  get(id: string): PastSession | null
  /** Upsert by id (a resumed session that ends again overwrites its own record), then keep the
   *  `PAST_SESSIONS_MAX` newest. Returns the new list. Trusts its typed input: the removal
   *  chokepoint builds the record from main-owned session truth (pastSessionRecord.ts). */
  archive(record: PastSession): PastSession[]
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
  let dropped = 0
  for (const record of loaded.sessions) {
    if (!workspaceExists(record.workspaceId)) {
      dropped += 1
      continue
    }
    byId.set(record.id, record)
  }
  if (dropped > 0)
    log(`${LOG_PREFIX} code=past_sessions_dropped_unknown_workspace count=${dropped}`)
  trim()
  persist()

  function persist(): void {
    try {
      blobStore.write({ version: PAST_SESSIONS_FILE_VERSION, sessions: list() })
    } catch {
      log(`${LOG_PREFIX} code=past_sessions_write_failed`)
    }
  }

  function list(): PastSession[] {
    return [...byId.values()].sort(newestFirst)
  }

  function get(id: string): PastSession | null {
    return byId.get(id) ?? null
  }

  /** Keep the newest `PAST_SESSIONS_MAX`. */
  function trim(): void {
    for (const stale of list().slice(PAST_SESSIONS_MAX)) byId.delete(stale.id)
  }

  function archive(record: PastSession): PastSession[] {
    byId.set(record.id, { ...record, tagIds: [...record.tagIds] })
    trim()
    persist()
    return list()
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

  return { list, get, archive, remove, removeByWorkspace }
}

function newestFirst(a: PastSession, b: PastSession): number {
  if (b.endedAt !== a.endedAt) return b.endedAt - a.endedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
