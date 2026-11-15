// The memory store (spec 2026-11-11 memory §2, §3): the one object the rest of main uses to write
// memory items and find them. Every text change appends a version (newest = current) and never
// overwrites one. The item's basis is its current text's: an edit takes it from its evidence when
// extraction gives one, else from the writer (`WRITER_BASIS`); a restore brings back the restored
// version's, and a state or pin change keeps it. An extracted item keeps where its current text
// came from (`source_*`); an edit without evidence clears it. `batch` runs a whole save from a
// session in one transaction. The read side lives in `memorySearch.ts`, the row schemas in
// `memoryRows.ts`.
//
// Failures: a missing id, version or command is a refusal code (`MEMORY_ERROR.notFound`,
// `versionNotFound`, `commandNotFound`). Any other throw is SQLite or a row that failed its
// schema: a write rolls back, reports `write_failed` and throws `STORE_WRITE_FAILED`; a read logs
// and throws
// `MEMORY_ERROR.readFailed` with no storage report (the file opened; the caller shows the
// failure), never a result that looks real. Memory text is sensitive: logs carry `code=` only.
import { z } from 'zod'
import type { MemoryTwin } from '../../shared/ipc/contract'
import {
  MEMORY_BASES,
  MEMORY_ERROR,
  MEMORY_LIMITS,
  MemoryVersionSchema,
  type MemoryItem,
  type MemoryItemKind,
  type MemoryRow,
  type EpisodeText,
  type MemoryText,
  type MemoryVersion,
  type MemoryWriter
} from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { StorageReporter } from '../persistence/persistedBlob'
import type { FilterContext } from './filterSql'
import type { MemoryDb, SqlValue } from './memoryDb'
import type { RecallTerm } from './recallTerms'
import { CountRow, ItemRow, selectItems, type EpisodeRow } from './memoryRows'
import {
  agentSpecificsNoSource,
  browseItems,
  contextItems,
  extractScope,
  folderSpecifics,
  indexItems,
  recallItems,
  searchItems,
  shortIdClashes,
  specificFolders,
  twinIdsInScope,
  twinsOfItem,
  writerOfCurrent,
  type BrowseBy,
  type ContextGroup,
  type MemoryScope,
  type MemorySearchInput,
  type SessionContext
} from './memorySearch'

export type { FilterContext } from './filterSql'
export type { MemoryScope } from './memorySearch'

/** Where an extracted text came from: the transcript (null when not known), the entry, the
 *  quote. The path stays in main (D34): `MemoryItem.source` carries the other two. */
export type StoredSource = { path: string | null; entryId: string; quote: string }
export type MemoryEvidence = { basis: MemoryItem['basis']; source: StoredSource | null }

export type MemoryAdd = {
  text: MemoryText | EpisodeText
  workspaceId: string | null
  check: string | null
  basis: Basis
  origin: MemoryItem['origin']
  meta: MemoryItem['meta']
  source: StoredSource | null
}

export interface MemoryStore {
  add(input: MemoryAdd): MemoryItem
  /** `evidence` given: the item's basis and source come from it. Not given: basis from the
   *  writer (agent or extract → inferred, operator → stated) and the source is cleared. */
  edit(
    id: string,
    change: { text: MemoryText | EpisodeText; check: string | null; evidence?: MemoryEvidence },
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
  /** `last_seen_at = at` only: no version, `updated_at` unchanged. Unknown id: nothing. */
  touchSeen(id: string, at: number): void
  /** The basis and source of the CURRENT text: the item's and its newest version's basis, the
   *  three source columns. No new version, `updated_at` unchanged. */
  setEvidence(id: string, evidence: { basis: MemoryItem['basis']; source: StoredSource }): void
  /** To the state the item already has: no version, no date change, no `onChange`. */
  setState(
    id: string,
    state: 'active' | 'stale',
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
  /** An episode is never pinned: `MEMORY_ERROR.notFound`, as for an unknown id. */
  setPinned(id: string, pinned: boolean): MemoryItem
  /** Appends the text of the version at `versionAt`; when two versions share that `at`, the
   *  newest of them. */
  restore(id: string, versionAt: number): MemoryItem
  remove(id: string): void
  get(id: string): MemoryItem | null
  /** Newest first; `[0]` is the current text. */
  versions(id: string): MemoryVersion[]
  search(
    scope: MemoryScope,
    input: MemorySearchInput,
    ctx: FilterContext
  ): { rows: MemoryRow[]; total: number }
  /** Counts of active items in scope, largest first. `by: 'tag'` keys are tag ids: the caller
   *  names them. */
  browse(scope: MemoryScope, by: BrowseBy): { key: string; count: number }[]
  indexRows(
    workspaceId: string,
    folder: string
  ): {
    pinned: MemoryItem[]
    specificsHere: MemoryRow[]
    /** Active episodes of the folder (at, above or below it), the
     *  `EXTRACT_LIMITS.episodesInIndex` whose session ended last, each with its `endedAt`; `more`
     *  does not count them. */
    episodesHere: EpisodeRow[]
    more: number
  }
  /** The index's keys (spec 2026-11-14 memory context index §1): the active, unpinned specifics
   *  and facts of the workspace and global, each under the first reason it shares with `ctx`, per
   *  reason its first `MEMORY_LIMITS.indexReasonRows` and its total. */
  contextRows(workspaceId: string, ctx: SessionContext): ContextGroup[]
  /** The id starts (`MEMORY_LIMITS.shortIdChars`) two or more items of the workspace and global
   *  share. */
  shortIdClashes(workspaceId: string): string[]
  /** Recall (phase 3 addendum §6): the active, unpinned specifics and facts in scope, not in
   *  `excludeIds`, that two distinct terms or one exact term match (one FTS5 phrase per term, its
   *  newest 200 rows),
   *  by exact terms matched, terms matched, newest, id; the first `limit`. */
  recall(
    scope: MemoryScope,
    terms: readonly RecallTerm[],
    excludeIds: readonly string[],
    limit: number
  ): MemoryItem[]
  /** The folders of active specifics in scope not in `excludeIds`, by each folder's newest
   *  change, at most `limit`. A pinned specific counts on purpose (`recall` never returns one). */
  foldersWithSpecifics(scope: MemoryScope, excludeIds: readonly string[], limit: number): string[]
  /** Active specifics in scope whose folder is exactly one of `folders`, not in `excludeIds`,
   *  newest first, at most `limit`; `more` counts the rest. */
  specificsInFolders(
    scope: MemoryScope,
    folders: readonly string[],
    excludeIds: readonly string[],
    limit: number
  ): { rows: MemoryRow[]; more: number }
  /** The ids of the active specifics in scope that hold the same exact value as another one in
   *  their workspace and folder (`memoryTwins.ts`, the dialog's `Same value` flag). */
  twinIds(scope: MemoryScope): string[]
  /** The twins of `id`, newest first: the first `shown`, and how many more. None for an unknown
   *  id, a fact, an episode or a stale item. */
  twinsOf(id: string, shown: number): { twins: MemoryTwin[]; more: number }
  /** Active specifics `originSessionId` saved with the tool that have no source yet. */
  agentSpecificsWithoutSource(originSessionId: string): { id: string; value: string }[]
  /** Who wrote the newest version; null for an unknown id. */
  currentWriter(id: string): MemoryWriter | null
  /** At most `limit` active items of the workspace and global, in this order: saved by
   *  `originSessionId`, pinned, of `folder` (at, above or below it), newest. */
  scopeForExtract(
    workspaceId: string,
    folder: string | null,
    originSessionId: string,
    limit: number
  ): { id: string; kind: MemoryItemKind; head: string; body: string }[]
  /** One transaction around `work`: the store's own methods called inside write into it.
   *  Listeners hear once, after the commit (always: `work` may write rows the store does not see,
   *  such as commands). A throw that leaves `work` rolls everything back, reports `write_failed`
   *  and throws `STORE_WRITE_FAILED` (a refusal code passes through). There is no savepoint:
   *  `work` must not catch a store throw and carry on, since a caught throw keeps what that call
   *  already wrote. */
  batch<T>(work: () => T): T
  removeByWorkspace(workspaceId: string): number
  /** How many items `sessionId` saved (its origin), global ones included. "Saved" leaves out an
   *  item the operator wrote in that session (`/remember`, origin `operator`): it is the
   *  operator's own, and keeps the session id only as provenance (P3-C29). The same holds for the
   *  next two. */
  countBySession(sessionId: string): number
  /** Deletes every item `sessionId` saved, with its history: the operator asked for it in the
   *  session Delete confirm. Answers how many. */
  removeBySession(sessionId: string): number
  /** Marks every item `sessionId` saved `Session deleted` (a first date is kept). */
  markSessionDeleted(sessionId: string): number
  rebindSession(oldSessionId: string, newSessionId: string): void
  onChange(listener: () => void): () => void
}

const LOG_PREFIX = '[claude-watcher][memory]'
/** The items a session saved: its origin, but not what the operator wrote there (P3-C29). */
const SAVED_BY_SESSION = "origin_session_id = ? AND origin_by <> 'operator'"
/** Thrown untouched by `write` and `batch`; `readFailed` is not one (inside a write it is a failed
 *  write). `commandNotFound` comes from `memoryCommands.ts` run inside a `batch`. */
const REFUSALS: ReadonlySet<string> = new Set([
  MEMORY_ERROR.notFound,
  MEMORY_ERROR.versionNotFound,
  MEMORY_ERROR.commandNotFound
])
const FTS_TABLES = ['item_words', 'item_trigram'] as const
const TextRow = z.object({ basis: z.enum(MEMORY_BASES), head: z.string(), body: z.string() })
type Basis = MemoryItem['basis']

/** The basis of a text by who wrote it, for an edit with no evidence. An extraction edit that
 *  gives evidence takes its basis from it instead. */
const WRITER_BASIS: Readonly<Record<MemoryWriter, Basis>> = {
  agent: 'inferred',
  operator: 'stated',
  extract: 'inferred'
}

/** A text's head and body; `setState` hands it a whole item, which may be an episode. */
function textParts(text: MemoryText | EpisodeText): [head: string, body: string] {
  return text.kind === 'specific' ? [text.key, text.value] : [text.title, text.body]
}

/** An episode's end; null for every other kind. */
function endedAt(text: MemoryText | EpisodeText): number | null {
  return text.kind === 'episode' ? text.endedAt : null
}

const changedRows = (n: number): boolean => n > 0

/** The three source columns, in `source_path, source_entry, source_quote` order. */
function sourceParams(source: StoredSource | null): [SqlValue, SqlValue, SqlValue] {
  return source === null ? [null, null, null] : [source.path, source.entryId, source.quote]
}

export function createMemoryStore(deps: {
  db: MemoryDb
  now: () => number
  newId: () => string
  report: StorageReporter
  log: (line: string) => void
}): MemoryStore {
  const { db, now, newId, report, log } = deps
  const listeners = new Set<() => void>()
  /** Set while `batch` runs: a write inside it joins the batch's transaction and tells no one. */
  let inBatch = false

  function isRefusal(e: unknown): boolean {
    return e instanceof Error && REFUSALS.has(e.message)
  }

  function emit(): void {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        log(`${LOG_PREFIX} code=memory_listener_failed`)
      }
    }
  }

  /** One transaction: a refusal passes through; any other throw rolls back, reports and throws
   *  `STORE_WRITE_FAILED`. */
  function commit<T>(work: () => T): T {
    try {
      return db.transaction(work)
    } catch (e) {
      if (isRefusal(e)) throw e
      log(`${LOG_PREFIX} code=memory_write_failed`)
      report('write_failed')
      throw new Error(STORE_WRITE_FAILED)
    }
  }

  /** One transaction; listeners hear of it only once it committed and `changed` says so. */
  function write<T>(work: () => T, changed: (out: T) => boolean = () => true): T {
    // Inside a batch: its transaction, its failure handling and its one `emit`.
    if (inBatch) return work()
    const out = commit(work)
    if (changed(out)) emit()
    return out
  }

  function commitBatch<T>(work: () => T): T {
    inBatch = true
    try {
      return commit(work)
    } finally {
      inBatch = false
    }
  }

  /** No `report`: storage health's `read_failed` says the file could not be opened, and this
   *  file did open. The caller shows the thrown code. */
  function read<T>(work: () => T): T {
    try {
      return work()
    } catch (e) {
      if (isRefusal(e)) throw e
      log(`${LOG_PREFIX} code=${MEMORY_ERROR.readFailed}`)
      throw new Error(MEMORY_ERROR.readFailed)
    }
  }

  function findItem(id: string): MemoryItem | null {
    return db.get(`${selectItems()} WHERE item.id = ?`, ItemRow, [id])
  }

  function mustItem(id: string): MemoryItem {
    const item = findItem(id)
    if (item === null) throw new Error(MEMORY_ERROR.notFound)
    return item
  }

  function changes(): number {
    return db.get('SELECT changes() AS n', CountRow)?.n ?? 0
  }

  function appendVersion(
    id: string,
    at: number,
    by: MemoryWriter,
    basis: Basis,
    reason: string | null,
    [head, body]: [string, string]
  ): void {
    db.run(
      'INSERT INTO version (item_id, at, by, basis, reason, head, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, at, by, basis, reason, head, body]
    )
    // The indexes hold the current text only, keyed by the item's `rid`.
    for (const table of FTS_TABLES) {
      db.run(`DELETE FROM ${table} WHERE rowid = (SELECT rid FROM item WHERE id = ?)`, [id])
      db.run(
        `INSERT INTO ${table} (rowid, item_id, head, body) SELECT rid, id, ?, ? FROM item WHERE id = ?`,
        [head, body, id]
      )
    }
  }

  /** Deletes the matching items, their index rows and (ON DELETE CASCADE) their versions. */
  function deleteItems(where: string, params: readonly SqlValue[]): number {
    for (const table of FTS_TABLES) {
      db.run(`DELETE FROM ${table} WHERE rowid IN (SELECT rid FROM item WHERE ${where})`, params)
    }
    db.run(`DELETE FROM item WHERE ${where}`, params)
    return changes()
  }

  function update(id: string, set: string, params: readonly SqlValue[]): void {
    db.run(`UPDATE item SET ${set} WHERE id = ?`, [...params, id])
  }

  return {
    add: (input) =>
      write(() => {
        const id = newId()
        const at = now()
        const { folder, ...meta } = input.meta
        db.run(
          `INSERT INTO item (id, kind, workspace_id, state, pinned, basis, check_text, folder,
             origin_by, origin_session_id, origin_deleted_at, last_seen_at, created_at, updated_at,
             meta)
           VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            id,
            input.text.kind,
            input.workspaceId,
            input.basis,
            input.check,
            folder,
            input.origin.by,
            input.origin.sessionId,
            at,
            at,
            at,
            JSON.stringify(meta)
          ]
        )
        update(id, 'source_path = ?, source_entry = ?, source_quote = ?, ended_at = ?', [
          ...sourceParams(input.source),
          endedAt(input.text)
        ])
        appendVersion(id, at, input.origin.by, input.basis, null, textParts(input.text))
        return mustItem(id)
      }),

    edit: (id, change, by, reason) =>
      write(() => {
        // A kind never changes: an edit with the other kind finds no such item.
        if (mustItem(id).kind !== change.text.kind) throw new Error(MEMORY_ERROR.notFound)
        const at = now()
        const basis = change.evidence?.basis ?? WRITER_BASIS[by]
        update(
          id,
          `basis = ?, check_text = ?, updated_at = ?, last_seen_at = ?, source_path = ?,
           source_entry = ?, source_quote = ?, ended_at = ?`,
          [
            basis,
            change.check,
            at,
            at,
            ...sourceParams(change.evidence?.source ?? null),
            endedAt(change.text)
          ]
        )
        appendVersion(id, at, by, basis, reason, textParts(change.text))
        return mustItem(id)
      }),

    setState: (id, state, by, reason) =>
      write(
        () => {
          const current = mustItem(id)
          if (current.state === state) return { item: current, changed: false }
          const at = now()
          update(id, 'state = ?, updated_at = ?', [state, at])
          appendVersion(id, at, by, current.basis, reason, textParts(current))
          return { item: mustItem(id), changed: true }
        },
        (out) => out.changed
      ).item,

    touchSeen: (id, at) => {
      write(() => {
        update(id, 'last_seen_at = ?', [at])
        return changes()
      }, changedRows)
    },

    setEvidence: (id, evidence) => {
      write(() => {
        mustItem(id)
        update(id, 'basis = ?, source_path = ?, source_entry = ?, source_quote = ?', [
          evidence.basis,
          ...sourceParams(evidence.source)
        ])
        db.run(
          `UPDATE version SET basis = ? WHERE seq = (SELECT seq FROM version WHERE item_id = ?
             ORDER BY at DESC, seq DESC LIMIT 1)`,
          [evidence.basis, id]
        )
      })
    },

    setPinned: (id, pinned) =>
      write(() => {
        // An episode is never pinned (D30): it is never in the index in full.
        if (mustItem(id).kind === 'episode') throw new Error(MEMORY_ERROR.notFound)
        update(id, 'pinned = ?', [pinned ? 1 : 0])
        return mustItem(id)
      }),

    restore: (id, versionAt) =>
      write(() => {
        mustItem(id)
        const old = db.get(
          'SELECT basis, head, body FROM version WHERE item_id = ? AND at = ? ORDER BY seq DESC LIMIT 1',
          TextRow,
          [id, versionAt]
        )
        if (old === null) throw new Error(MEMORY_ERROR.versionNotFound)
        const at = now()
        update(id, 'basis = ?, updated_at = ?', [old.basis, at])
        appendVersion(id, at, 'operator', old.basis, null, [old.head, old.body])
        return mustItem(id)
      }),

    remove: (id) => {
      write(() => {
        mustItem(id)
        deleteItems('id = ?', [id])
      })
    },

    get: (id) => read(() => findItem(id)),

    versions: (id) =>
      read(() => {
        mustItem(id)
        return db.all(
          'SELECT at, by, basis, reason, head, body FROM version WHERE item_id = ? ORDER BY at DESC, seq DESC',
          MemoryVersionSchema,
          [id]
        )
      }),

    search: (scope, input, ctx) => read(() => searchItems(db, scope, input, ctx)),

    browse: (scope, by) => read(() => browseItems(db, scope, by)),

    indexRows: (workspaceId, folder) => read(() => indexItems(db, workspaceId, folder)),

    contextRows: (workspaceId, ctx) =>
      read(() => contextItems(db, workspaceId, ctx, MEMORY_LIMITS.indexReasonRows)),

    shortIdClashes: (workspaceId) => read(() => shortIdClashes(db, workspaceId)),

    recall: (scope, terms, excludeIds, limit) =>
      read(() => recallItems(db, scope, terms, excludeIds, limit)),

    foldersWithSpecifics: (scope, excludeIds, limit) =>
      read(() => specificFolders(db, scope, excludeIds, limit)),

    specificsInFolders: (scope, folders, excludeIds, limit) =>
      read(() => folderSpecifics(db, scope, folders, excludeIds, limit)),

    twinIds: (scope) => read(() => twinIdsInScope(db, scope)),

    twinsOf: (id, shown) => read(() => twinsOfItem(db, id, shown)),

    agentSpecificsWithoutSource: (originSessionId) =>
      read(() => agentSpecificsNoSource(db, originSessionId)),

    currentWriter: (id) => read(() => writerOfCurrent(db, id)),

    scopeForExtract: (workspaceId, folder, originSessionId, limit) =>
      read(() => extractScope(db, workspaceId, folder, originSessionId, limit)),

    batch: (work) => {
      // A batch inside a batch is part of it.
      if (inBatch) return work()
      const out = commitBatch(work)
      emit()
      return out
    },

    removeByWorkspace: (workspaceId) =>
      write(() => deleteItems('workspace_id = ?', [workspaceId]), changedRows),

    countBySession: (sessionId) =>
      read(
        () =>
          db.get(`SELECT COUNT(*) AS n FROM item WHERE ${SAVED_BY_SESSION}`, CountRow, [sessionId])
            ?.n ?? 0
      ),

    removeBySession: (sessionId) =>
      write(() => deleteItems(SAVED_BY_SESSION, [sessionId]), changedRows),

    markSessionDeleted: (sessionId) =>
      write(() => {
        // A session deleted again keeps its first date.
        db.run(
          `UPDATE item SET origin_deleted_at = ?
           WHERE ${SAVED_BY_SESSION} AND origin_deleted_at IS NULL`,
          [now(), sessionId]
        )
        return changes()
      }, changedRows),

    rebindSession: (oldSessionId, newSessionId) => {
      write(() => {
        db.run('UPDATE item SET origin_session_id = ? WHERE origin_session_id = ?', [
          newSessionId,
          oldSessionId
        ])
        return changes()
      }, changedRows)
    },

    onChange: (listener) => {
      // A wrapper, so the same function subscribed twice is two subscriptions.
      const entry = (): void => listener()
      listeners.add(entry)
      return () => listeners.delete(entry)
    }
  }
}
