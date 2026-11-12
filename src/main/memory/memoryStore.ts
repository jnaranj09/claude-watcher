// The memory store (spec 2026-11-11 memory §2, §3): the one object the rest of main uses to write
// memory items and find them. Every text change appends a version (newest = current) and never
// overwrites one. The item's basis is its current text's: an edit takes it from the writer
// (`WRITER_BASIS`), a restore brings back the restored version's, and a state or pin change keeps
// it. The read side lives in `memorySearch.ts`, the row schemas in `memoryRows.ts`.
//
// Failures: a missing id or version is a refusal code (`MEMORY_ERROR.notFound`,
// `versionNotFound`). Any other throw is SQLite or a row that failed its schema: a write rolls
// back, reports `write_failed` and throws `STORE_WRITE_FAILED`; a read logs and throws
// `MEMORY_ERROR.readFailed` with no storage report (the file opened; the caller shows the
// failure), never a result that looks real. Memory text is sensitive: logs carry `code=` only.
import { z } from 'zod'
import {
  MEMORY_BASES,
  MEMORY_ERROR,
  MemoryVersionSchema,
  type MemoryItem,
  type MemoryRow,
  type MemoryText,
  type MemoryVersion,
  type MemoryWriter
} from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { StorageReporter } from '../persistence/persistedBlob'
import type { FilterContext } from './filterSql'
import type { MemoryDb, SqlValue } from './memoryDb'
import { CountRow, ItemRow, selectItems } from './memoryRows'
import {
  browseItems,
  indexItems,
  searchItems,
  type BrowseBy,
  type MemoryScope,
  type MemorySearchInput
} from './memorySearch'

export type { FilterContext } from './filterSql'
export type { MemoryScope } from './memorySearch'

export type MemoryAdd = {
  text: MemoryText
  workspaceId: string | null
  check: string | null
  basis: Basis
  origin: MemoryItem['origin']
  meta: MemoryItem['meta']
}

export interface MemoryStore {
  add(input: MemoryAdd): MemoryItem
  edit(
    id: string,
    change: { text: MemoryText; check: string | null },
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
  /** To the state the item already has: no version, no date change, no `onChange`. */
  setState(
    id: string,
    state: 'active' | 'stale',
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
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
  ): { pinned: MemoryItem[]; specificsHere: MemoryRow[]; more: number }
  removeByWorkspace(workspaceId: string): number
  /** How many items `sessionId` saved (its origin), global ones included. */
  countBySession(sessionId: string): number
  /** Deletes every item `sessionId` saved, with its history: the operator asked for it in the
   *  session Delete confirm. Answers how many. */
  removeBySession(sessionId: string): number
  markSessionDeleted(sessionId: string): number
  rebindSession(oldSessionId: string, newSessionId: string): void
  onChange(listener: () => void): () => void
}

const LOG_PREFIX = '[claude-watcher][memory]'
/** Thrown untouched by `write`; `readFailed` is not one (inside a write it is a failed write). */
const REFUSALS: ReadonlySet<string> = new Set([MEMORY_ERROR.notFound, MEMORY_ERROR.versionNotFound])
const FTS_TABLES = ['item_words', 'item_trigram'] as const
const TextRow = z.object({ basis: z.enum(MEMORY_BASES), head: z.string(), body: z.string() })
type Basis = MemoryItem['basis']

/** The basis of a text by who wrote it. `extract` is inferred until phase 2 refines it. */
const WRITER_BASIS: Readonly<Record<MemoryWriter, Basis>> = {
  agent: 'inferred',
  operator: 'stated',
  extract: 'inferred'
}

function textParts(text: MemoryText): [head: string, body: string] {
  return text.kind === 'specific' ? [text.key, text.value] : [text.title, text.body]
}

const changedRows = (n: number): boolean => n > 0

export function createMemoryStore(deps: {
  db: MemoryDb
  now: () => number
  newId: () => string
  report: StorageReporter
  log: (line: string) => void
}): MemoryStore {
  const { db, now, newId, report, log } = deps
  const listeners = new Set<() => void>()

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

  /** One transaction; listeners hear of it only once it committed and `changed` says so. */
  function write<T>(work: () => T, changed: (out: T) => boolean = () => true): T {
    let out: T
    try {
      out = db.transaction(work)
    } catch (e) {
      if (isRefusal(e)) throw e
      log(`${LOG_PREFIX} code=memory_write_failed`)
      report('write_failed')
      throw new Error(STORE_WRITE_FAILED)
    }
    if (changed(out)) emit()
    return out
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
        appendVersion(id, at, input.origin.by, input.basis, null, textParts(input.text))
        return mustItem(id)
      }),

    edit: (id, change, by, reason) =>
      write(() => {
        // A kind never changes: an edit with the other kind finds no such item.
        if (mustItem(id).kind !== change.text.kind) throw new Error(MEMORY_ERROR.notFound)
        const at = now()
        const basis = WRITER_BASIS[by]
        update(id, 'basis = ?, check_text = ?, updated_at = ?, last_seen_at = ?', [
          basis,
          change.check,
          at,
          at
        ])
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

    setPinned: (id, pinned) =>
      write(() => {
        mustItem(id)
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

    removeByWorkspace: (workspaceId) =>
      write(() => deleteItems('workspace_id = ?', [workspaceId]), changedRows),

    countBySession: (sessionId) =>
      read(
        () =>
          db.get('SELECT COUNT(*) AS n FROM item WHERE origin_session_id = ?', CountRow, [
            sessionId
          ])?.n ?? 0
      ),

    removeBySession: (sessionId) =>
      write(() => deleteItems('origin_session_id = ?', [sessionId]), changedRows),

    markSessionDeleted: (sessionId) =>
      write(() => {
        // A session deleted again keeps its first date.
        db.run(
          `UPDATE item SET origin_deleted_at = ?
           WHERE origin_session_id = ? AND origin_deleted_at IS NULL`,
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
