// Past sessions (D-9) — the main-owned history of archived sessions. Own file
// (`claude-watcher-past-sessions.json`) so a corrupt history can never reset settings, templates
// or workspaces. NEVER log a record value (name = operator text, cwd = filesystem layout) — codes
// only. Claude's own files under ~/.claude are never touched by anything here (D-4).
//
// Memory (R50): each record's `memory` state lives in its own file
// (`claude-watcher-past-sessions-memory.json`, by record id), never inside a record, so the
// Past sessions file stays one an older build's `.strict()` record reads. `list` and `get` merge
// it back; an entry goes when its record goes (Forget, the cap, a cascade, `dropLive`).
import {
  EMPTY_PAST_SESSIONS_FILE,
  PAST_SESSIONS_FILE_VERSION,
  PAST_SESSIONS_MEMORY_FILE_VERSION,
  PAST_SESSIONS_HIDDEN_MAX,
  PAST_SESSIONS_MAX,
  PastSessionsFileSchema,
  PastSessionsMemoryFileSchema,
  type PastSession,
  type PastSessionMemory,
  type PastSessionsFile,
  type PastSessionsMemoryFile
} from '../../shared/schemas/pastSession'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore,
  reportNowhere,
  storageCodeForLoad,
  type StorageReporter
} from './persistedBlob'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'

export type PastSessionsBlobStore = PersistedBlobStore<PastSessionsFile>
export type PastSessionsMemoryBlobStore = PersistedBlobStore<PastSessionsMemoryFile>

export interface PastSessionsStoreOptions {
  blobStore?: PastSessionsBlobStore
  log?: (message: string) => void
  /** UX-06 / UX-07 — where a load problem or a background write failure is told (storageHealth.ts). */
  report?: StorageReporter
  /** R50: the file each record's `memory` state lives in. In memory when not given (tests,
   *  SMOKE). */
  memoryBlobStore?: PastSessionsMemoryBlobStore
  /** Where that file's load problem or refused write is told (store `past_sessions_memory`). */
  reportMemory?: StorageReporter
  /** A record can only be LISTED while its workspace exists (the delete cascade guarantees it).
   *  One that names a missing workspace — a hand-edited file, or a workspaces file that was
   *  corrupt and reset to Default — is KEPT in the file and hidden (UX-03): restoring the
   *  workspaces backup brings it back. index.ts wires it to the workspaces store; the default
   *  says every workspace exists. */
  workspaceExists?: (workspaceId: string) => boolean
  /** NEW-5 — does claude have a transcript for this session? A session that ends before its
   *  first prompt (claude writes the file then, not at startup) has no conversation to resume, so
   *  it gets no record. index.ts wires `pty/claudeTranscript.ts` (a known path, else a scan by
   *  id; fails open); the default says every transcript exists. */
  hasTranscript?: (sessionId: string, knownPath: string | undefined) => boolean
  /** Memory (spec 2026-11-11): a session the operator deleted (a Forget, or a card's Delete, which
   *  drops its record) has its memory save forgotten and keeps its memory items and commands,
   *  marked `Session deleted`. Called after every
   *  `remove` the disk kept, known id or not (a card deleted before its first prompt has no
   *  record); never by `removeByWorkspace` or the cap (see `onDropped`). Must not throw:
   *  index.ts wires `markSessionsDeletedInMemory`. */
  onRemove?: (sessionId: string) => void
  /** Memory: the ids of records that left WITHOUT a Forget, once their write is done: a workspace
   *  cascade's (the cascade deleted that workspace's items first, so only global ones are left to
   *  mark) and the cap's evictions (at load too). Their sessions' saves are forgotten and their
   *  items and commands marked `Session deleted`, like a Forget's. Never called with no id. Must not throw: index.ts wires
   *  `markSessionsDeletedInMemory`. */
  onDropped?: (sessionIds: readonly string[]) => void
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
  /** Sets a record's `memory` (live or ended), in the memory state file only. No record:
   *  nothing. A background write (a refused one reports `past_sessions_memory` `write_failed`). */
  setMemory(sessionId: string, memory: PastSessionMemory): void
  /** Idempotent. Returns the new list. */
  remove(id: string): PastSession[]
  /** Workspaces — delete every record in `workspaceId`. Called ONLY by the workspaces store's
   *  cascade, after a delete was allowed. Returns how many were removed; their ids go to
   *  `onDropped`. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][past-sessions]'

export function createPastSessionsStore(options: PastSessionsStoreOptions = {}): PastSessionsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<PastSessionsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const report = options.report ?? reportNowhere
  const workspaceExists = options.workspaceExists ?? ((): boolean => true)
  const hasTranscript = options.hasTranscript ?? ((): boolean => true)
  const memoryBlobStore =
    options.memoryBlobStore ?? createInMemoryBlobStore<PastSessionsMemoryFile>()
  const reportMemory = options.reportMemory ?? reportNowhere
  /** Records WITHOUT `memory`: what the Past sessions file holds. */
  const byId = new Map<string, PastSession>()
  /** R50: each record's `memory`, by record id. */
  const memoryById = new Map<string, PastSessionMemory>()
  /** The memory state file as last written: a change to the records only rewrites it when an
   *  entry went with its record. null: not written yet this run. */
  let memoryWritten: string | null = null
  /** Ids whose `memory` a load found inside the record (a file an earlier phase-2 build wrote).
   *  Until the state file holds it, the Past sessions file keeps it inline: a refused or
   *  interrupted state write never loses it, and the next load tries again. */
  const inlineUntilSaved = new Set<string>()
  let loading = true

  const loaded = loadPersistedOrReset<PastSessionsFile>({
    blobStore,
    parse: (raw) => PastSessionsFileSchema.parse(raw),
    fallback: () => EMPTY_PAST_SESSIONS_FILE,
    onProblem: (code) => {
      log(`${LOG_PREFIX} code=past_sessions_${code}`)
      report(storageCodeForLoad(code))
    }
  })
  const loadedMemory = loadPersistedOrReset<PastSessionsMemoryFile>({
    blobStore: memoryBlobStore,
    parse: (raw) => PastSessionsMemoryFileSchema.parse(raw),
    fallback: () => ({ version: PAST_SESSIONS_MEMORY_FILE_VERSION, records: {} }),
    onProblem: (code) => {
      log(`${LOG_PREFIX} code=past_sessions_memory_${code}`)
      reportMemory(storageCodeForLoad(code))
    }
  })
  for (const [id, memory] of Object.entries(loadedMemory.records)) memoryById.set(id, memory)
  let hidden = 0
  let recovered = 0
  let skipped = 0
  for (const loadedRecord of loaded.sessions) {
    // A file an earlier build of memory phase 2 wrote holds `memory` inside the record: it moves
    // to the state file, and the record is written back without it only once that file has it.
    const record = withoutMemory(loadedRecord)
    if (loadedRecord.memory !== undefined) {
      memoryById.set(record.id, loadedRecord.memory)
      inlineUntilSaved.add(record.id)
    }
    // UX-01 — nothing is on the board yet (one instance per profile), so a record still marked
    // live was left by a run that died without archiving it: it is a normal record now, ended at
    // the last time that run saw the card — unless claude never wrote its transcript (NEW-5).
    if (record.live === true && !hasConversation(record)) {
      skipped += 1
      continue
    }
    if (record.live === true) {
      recovered += 1
      byId.set(record.id, ended(record))
    } else {
      byId.set(record.id, record)
    }
    if (!workspaceExists(record.workspaceId)) hidden += 1
  }
  if (recovered > 0) log(`${LOG_PREFIX} code=past_sessions_recovered_live count=${recovered}`)
  if (skipped > 0) log(`${LOG_PREFIX} code=past_sessions_no_transcript_skipped count=${skipped}`)
  if (hidden > 0) log(`${LOG_PREFIX} code=past_sessions_hidden_unknown_workspace count=${hidden}`)
  const evictedAtLoad = trim()
  // The state file first: a migrated record is stripped only once its state is on disk.
  syncMemory()
  loading = false
  persistOrReport()
  dropped(evictedAtLoad)

  /** False only when claude surely has no transcript for the record. An ENDED record like that
   *  stays (Open answers `transcript_missing`, UX-08); only an archive and a crash-leftover live
   *  record ask. */
  function hasConversation(record: PastSession): boolean {
    return hasTranscript(record.id, record.transcriptPath)
  }

  /** Every record, hidden ones included — what the FILE holds. */
  function all(): PastSession[] {
    return [...byId.values()].sort(newestFirst)
  }

  /** A record as callers see it: with its `memory` when it has one, else no such key. */
  function shown(record: PastSession): PastSession {
    const memory = memoryById.get(record.id)
    return memory === undefined ? record : { ...record, memory: { ...memory } }
  }

  /** The memory state file follows the records: an entry whose record is gone is pruned. Written
   *  only when it changed. A refused write keeps the state for this run and reports it. */
  function syncMemory(): void {
    for (const id of memoryById.keys()) if (!byId.has(id)) memoryById.delete(id)
    const file: PastSessionsMemoryFile = {
      version: PAST_SESSIONS_MEMORY_FILE_VERSION,
      records: Object.fromEntries([...memoryById].sort(([a], [b]) => (a < b ? -1 : 1)))
    }
    const text = JSON.stringify(file)
    if (text === memoryWritten) return
    try {
      memoryBlobStore.write(file)
      memoryWritten = text
      if (inlineUntilSaved.size > 0) {
        inlineUntilSaved.clear()
        // The migrated state is on disk now: strip it from the records (the load writes next).
        if (!loading && !persist()) report('write_failed')
      }
    } catch {
      log(`${LOG_PREFIX} code=past_sessions_memory_write_failed`)
      reportMemory('write_failed')
    }
  }

  function persist(): boolean {
    try {
      const sessions = all().map((r) => (inlineUntilSaved.has(r.id) ? shown(r) : r))
      blobStore.write({ version: PAST_SESSIONS_FILE_VERSION, sessions })
      return true
    } catch {
      log(`${LOG_PREFIX} code=past_sessions_write_failed`)
      return false
    }
  }

  /** A dialog's Save / Delete (UX-06): undo the change and throw when the file write fails, so
   *  the dialog never says "saved" about a row the next start will not have. */
  function commit(undo: () => void): void {
    if (persist()) {
      syncMemory()
      return
    }
    undo()
    throw new Error(STORE_WRITE_FAILED)
  }

  /** Every other write: the change holds for this run, and storage health says it was not kept. */
  function persistOrReport(): void {
    if (!persist()) report('write_failed')
    syncMemory()
  }

  /** Records that left without a Forget, told after their write (`onDropped`). */
  function dropped(ids: readonly string[]): void {
    if (ids.length > 0) options.onDropped?.(ids)
  }

  function list(): PastSession[] {
    return all()
      .filter((r) => r.live !== true && workspaceExists(r.workspaceId))
      .map(shown)
  }

  function get(id: string): PastSession | null {
    const record = byId.get(id)
    if (record === undefined || !workspaceExists(record.workspaceId)) return null
    return shown(record)
  }

  /** Keep the newest `PAST_SESSIONS_MAX` ended VISIBLE records. A live one is never evicted: it
   *  is a session still running, and evicting it would lose it the moment the app dies. A HIDDEN
   *  one (UX-03, its workspace is gone) is not counted — a row the dialog cannot show must not
   *  evict one it can — and has its own `PAST_SESSIONS_HIDDEN_MAX`, oldest dropped, so the file
   *  stays bounded. Returns the ids it dropped. */
  function trim(): string[] {
    const endedRecords = all().filter((r) => r.live !== true)
    const visible = endedRecords.filter((r) => workspaceExists(r.workspaceId))
    const hiddenRecords = endedRecords.filter((r) => !workspaceExists(r.workspaceId))
    const staleVisible = visible.slice(PAST_SESSIONS_MAX)
    for (const stale of staleVisible) byId.delete(stale.id)
    if (staleVisible.length > 0) {
      log(`${LOG_PREFIX} code=past_sessions_trimmed count=${staleVisible.length}`)
    }
    const staleHidden = hiddenRecords.slice(PAST_SESSIONS_HIDDEN_MAX)
    for (const stale of staleHidden) byId.delete(stale.id)
    if (staleHidden.length > 0) {
      log(`${LOG_PREFIX} code=past_sessions_hidden_trimmed count=${staleHidden.length}`)
    }
    return [...staleVisible, ...staleHidden].map((r) => r.id)
  }

  /** The new record, keeping the transcript path an earlier write learned: the hook that
   *  carries it may not have reached this run yet (a resumed session writes the same file).
   *  An earlier `memory` stays in its own map until the new end sets its own (`setMemory`); a
   *  `memory` on the given record replaces it. */
  function merged(record: PastSession): PastSession {
    if (record.memory !== undefined) memoryById.set(record.id, { ...record.memory })
    const next: PastSession = { ...withoutMemory(record), tagIds: [...record.tagIds] }
    const known = byId.get(record.id)
    if (next.transcriptPath === undefined && known?.transcriptPath !== undefined) {
      next.transcriptPath = known.transcriptPath
    }
    return next
  }

  function archive(record: PastSession): PastSession[] {
    const next = ended(merged(record))
    if (!hasConversation(next)) {
      // NEW-5 — nothing to resume: `claude --resume` would say "no conversation found". Its live
      // record goes too, so a crash later cannot bring it back.
      log(`${LOG_PREFIX} code=past_sessions_no_transcript_skipped`)
      if (byId.delete(record.id)) persistOrReport()
      return list()
    }
    byId.set(record.id, next)
    const evicted = trim()
    persistOrReport()
    dropped(evicted)
    return list()
  }

  function markLive(record: PastSession): void {
    byId.set(record.id, { ...merged(record), live: true })
    persistOrReport()
  }

  function dropLive(id: string): void {
    if (byId.get(id)?.live !== true) return
    byId.delete(id)
    persistOrReport()
  }

  function setMemory(sessionId: string, memory: PastSessionMemory): void {
    if (!byId.has(sessionId)) return
    memoryById.set(sessionId, { ...memory })
    syncMemory()
  }

  function remove(id: string): PastSession[] {
    // Forget — the dialog's own action (UX-06): a record the disk kept must not vanish from it.
    const previous = byId.get(id)
    if (previous !== undefined && byId.delete(id)) commit(() => byId.set(id, previous))
    // After the commit: a refused write threw above, and the record and its items stay as they
    // were.
    options.onRemove?.(id)
    return list()
  }

  function removeByWorkspace(workspaceId: string): number {
    const removed: string[] = []
    for (const [id, record] of byId) {
      if (record.workspaceId === workspaceId) {
        byId.delete(id)
        removed.push(id)
      }
    }
    if (removed.length > 0) persistOrReport()
    dropped(removed)
    return removed.length
  }

  return { list, get, archive, markLive, dropLive, setMemory, remove, removeByWorkspace }
}

/** The record without its `memory`: what the Past sessions file holds (R50). */
function withoutMemory(record: PastSession): PastSession {
  const rest = { ...record }
  delete rest.memory
  return rest
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
