// The memory store (spec 2026-11-11 memory §2, §3): the one object the rest of main uses to write
// memory items and find them. Every text change appends a version (newest = current) and never
// overwrites one. A search narrows by scope and app metadata first (`filterSql.ts`), then ranks by
// the word index, then adds what only the trigram index finds.
//
// Failures: a missing id or version is a refusal code (`MEMORY_ERROR`). Any other throw is SQLite
// or a row that failed its schema: a write rolls back, reports `write_failed` and throws
// `STORE_WRITE_FAILED`; a read reports `read_failed` and throws `memory_read_failed`, never a
// result that looks real. Memory text is sensitive: logs carry `code=` only, never an error.
import { z } from 'zod'
import { MEMORY_FILTER_FIELDS, type MemoryFilters } from '../../shared/memory/filterFields'
import {
  MEMORY_BASES,
  MEMORY_ERROR,
  MEMORY_KINDS,
  MEMORY_STATES,
  MEMORY_WRITERS,
  MemoryItemSchema,
  MemoryRowSchema,
  MemoryVersionSchema,
  type MemoryItem,
  type MemoryRow,
  type MemoryText,
  type MemoryVersion,
  type MemoryWriter
} from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { StorageReporter } from '../persistence/persistedBlob'
import {
  FILTER_SQL,
  folderAbove,
  folderAtOrUnder,
  type FilterContext,
  type SqlClause
} from './filterSql'
import type { MemoryDb, SqlValue } from './memoryDb'

export type MemoryScope = { workspaceId: string; includeGlobal: boolean }
export type MemoryAdd = {
  text: MemoryText
  workspaceId: string | null
  check: string | null
  basis: MemoryItem['basis']
  origin: MemoryItem['origin']
  meta: MemoryItem['meta']
}
type BrowseBy = 'kind' | 'folder' | 'tag' | 'month'

export interface MemoryStore {
  add(input: MemoryAdd): MemoryItem
  edit(
    id: string,
    change: { text: MemoryText; check: string | null },
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
  setState(
    id: string,
    state: 'active' | 'stale',
    by: MemoryWriter,
    reason: string | null
  ): MemoryItem
  setPinned(id: string, pinned: boolean): MemoryItem
  restore(id: string, versionAt: number): MemoryItem
  remove(id: string): void
  get(id: string): MemoryItem | null
  /** Newest first; `[0]` is the current text. */
  versions(id: string): MemoryVersion[]
  search(
    scope: MemoryScope,
    input: {
      kind: MemoryItem['kind'] | null
      query: string | null
      filters: MemoryFilters
      offset: number
      limit: number
    },
    ctx: FilterContext
  ): { rows: MemoryRow[]; total: number }
  /** Counts of active items in scope, largest first. */
  browse(scope: MemoryScope, by: BrowseBy): { key: string; count: number }[]
  indexRows(
    workspaceId: string,
    folder: string
  ): { pinned: MemoryItem[]; specificsHere: MemoryRow[]; more: number }
  removeByWorkspace(workspaceId: string): number
  markSessionDeleted(sessionId: string): number
  rebindSession(oldSessionId: string, newSessionId: string): void
  onChange(listener: () => void): () => void
}

const LOG_PREFIX = '[claude-watcher][memory]'
const READ_FAILED = 'memory_read_failed'
const REFUSALS: ReadonlySet<string> = new Set(Object.values(MEMORY_ERROR))
const SPECIFICS_HERE_MAX = 50
/** The trigram index cannot match fewer characters than this. */
const TRIGRAM_MIN = 3
const FTS_TABLES = ['item_words', 'item_trigram'] as const

/** `item` and its current text. A version's `at` can repeat, so `rowid` breaks the tie. */
const ITEM_COLUMNS = `item.id, item.kind, item.workspace_id, item.state, item.pinned, item.basis,
  item.check_text, item.folder, item.origin_by, item.origin_session_id, item.origin_deleted_at,
  item.last_seen_at, item.created_at, item.updated_at, item.meta, cur.head, cur.body`
const CURRENT_JOIN = `JOIN version AS cur ON cur.rowid = (SELECT v.rowid FROM version AS v
  WHERE v.item_id = item.id ORDER BY v.at DESC, v.rowid DESC LIMIT 1)`
const NEWEST_FIRST = 'item.updated_at DESC, item.rowid DESC'
const ACTIVE: SqlClause = { sql: "item.state = 'active'", params: [] }

/** `meta` holds everything of `MemoryItem['meta']` but the folder, which is a column. */
const MetaJsonSchema = MemoryItemSchema.options[0].shape.meta.omit({ folder: true })
const MetaColumn = z
  .string()
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      // Becomes a row issue (path `meta`), which the caller logs as a failed read by code.
      ctx.addIssue({ code: 'custom', message: 'meta_not_json' })
      return z.NEVER
    }
  })
  .pipe(MetaJsonSchema)

const StoredRow = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  workspace_id: z.string().nullable(),
  state: z.enum(MEMORY_STATES),
  pinned: z.union([z.literal(0), z.literal(1)]),
  basis: z.enum(MEMORY_BASES),
  check_text: z.string().nullable(),
  folder: z.string().nullable(),
  origin_by: z.enum(MEMORY_WRITERS),
  origin_session_id: z.string().nullable(),
  origin_deleted_at: z.number().nullable(),
  last_seen_at: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
  meta: MetaColumn,
  head: z.string(),
  body: z.string()
})
type Stored = z.output<typeof StoredRow>

const ItemRow = StoredRow.transform((r): z.input<typeof MemoryItemSchema> => {
  const fields = {
    id: r.id,
    workspaceId: r.workspace_id,
    state: r.state,
    pinned: r.pinned === 1,
    basis: r.basis,
    check: r.check_text,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    origin: { by: r.origin_by, sessionId: r.origin_session_id },
    originDeletedAt: r.origin_deleted_at,
    meta: { folder: r.folder, ...r.meta }
  }
  return r.kind === 'specific'
    ? { kind: 'specific', key: r.head, value: r.body, ...fields }
    : { kind: 'fact', title: r.head, body: r.body, ...fields }
}).pipe(MemoryItemSchema)

const ListRow = StoredRow.transform(
  (r: Stored): MemoryRow => ({
    id: r.id,
    kind: r.kind,
    head: r.head,
    updatedAt: r.updated_at,
    basis: r.basis,
    state: r.state,
    pinned: r.pinned === 1,
    workspaceId: r.workspace_id,
    folder: r.folder,
    sessionName: r.meta.sessionName,
    tagIds: r.meta.tagIds,
    originDeletedAt: r.origin_deleted_at
  })
).pipe(MemoryRowSchema)

const CountRow = z.object({ n: z.number() })
const TextRow = z.object({ head: z.string(), body: z.string() })
const BucketRow = z.object({ key: z.string(), count: z.number() })

const BROWSE: Record<BrowseBy, { key: string; from: string }> = {
  kind: { key: 'item.kind', from: 'item' },
  folder: { key: 'item.folder', from: 'item' },
  tag: { key: 'tag.value', from: `item, json_each(item.meta, '$.tagIds') AS tag` },
  month: {
    key: `strftime('%Y-%m', item.updated_at / 1000, 'unixepoch', 'localtime')`,
    from: 'item'
  }
}

function textParts(text: MemoryText): [head: string, body: string] {
  return text.kind === 'specific' ? [text.key, text.value] : [text.title, text.body]
}

function and(clauses: readonly SqlClause[]): SqlClause {
  return {
    sql: clauses.map((c) => c.sql).join(' AND '),
    params: clauses.flatMap((c) => c.params)
  }
}

function scopeClause(scope: MemoryScope): SqlClause {
  return {
    sql: '(item.workspace_id = ? OR (? = 1 AND item.workspace_id IS NULL))',
    params: [scope.workspaceId, scope.includeGlobal ? 1 : 0]
  }
}

function filterClause<K extends keyof MemoryFilters>(
  name: K,
  filters: MemoryFilters,
  ctx: FilterContext
): SqlClause | null {
  const value = filters[name]
  return value == null ? null : FILTER_SQL[name](value, ctx)
}

/** Stale rows are left out unless the filters say `includeStale`. */
function filterClauses(filters: MemoryFilters, ctx: FilterContext): SqlClause[] {
  const withDefaults: MemoryFilters = { ...filters, includeStale: filters.includeStale ?? false }
  return MEMORY_FILTER_FIELDS.flatMap((f) => filterClause(f.name, withDefaults, ctx) ?? [])
}

/** Each whitespace-separated term as an FTS5 string (`"` doubled), so no operator character
 *  reaches `MATCH`. Terms are ANDed. */
function ftsQuery(terms: readonly string[]): string {
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
}

/** Rows the text matches: word-index hits (tier 0, by bm25), then rows only the trigram index
 *  finds (tier 1). A term under three characters is left out of the trigram query. */
function textHits(query: string): SqlClause | null {
  const terms = query.split(/\s+/).filter((t) => t !== '')
  if (terms.length === 0) return null
  const words = ftsQuery(terms)
  const wordsSql =
    'SELECT rowid AS item_rowid, 0 AS tier, bm25(item_words) AS rank FROM item_words WHERE item_words MATCH ?'
  const long = terms.filter((t) => [...t].length >= TRIGRAM_MIN)
  if (long.length === 0) return { sql: `WITH hit AS (${wordsSql})`, params: [words] }
  return {
    sql: `WITH hit AS (${wordsSql}
      UNION ALL
      SELECT rowid, 1, 0 FROM item_trigram WHERE item_trigram MATCH ?
        AND rowid NOT IN (SELECT rowid FROM item_words WHERE item_words MATCH ?))`,
    params: [words, ftsQuery(long), words]
  }
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

  function read<T>(work: () => T): T {
    try {
      return work()
    } catch (e) {
      if (isRefusal(e)) throw e
      log(`${LOG_PREFIX} code=${READ_FAILED}`)
      report('read_failed')
      throw new Error(READ_FAILED)
    }
  }

  function findItem(id: string): MemoryItem | null {
    return db.get(`SELECT ${ITEM_COLUMNS} FROM item ${CURRENT_JOIN} WHERE item.id = ?`, ItemRow, [
      id
    ])
  }

  function mustItem(id: string): MemoryItem {
    const item = findItem(id)
    if (item === null) throw new Error(MEMORY_ERROR.notFound)
    return item
  }

  function changes(): number {
    return db.get('SELECT changes() AS n', CountRow)?.n ?? 0
  }

  function count(where: SqlClause): number {
    return (
      db.get(`SELECT COUNT(*) AS n FROM item WHERE ${where.sql}`, CountRow, where.params)?.n ?? 0
    )
  }

  function appendVersion(
    id: string,
    at: number,
    by: MemoryWriter,
    reason: string | null,
    [head, body]: [string, string]
  ): void {
    db.run('INSERT INTO version (item_id, at, by, reason, head, body) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      at,
      by,
      reason,
      head,
      body
    ])
    // The indexes hold the current text only, keyed by the item's rowid.
    for (const table of FTS_TABLES) {
      db.run(`DELETE FROM ${table} WHERE rowid = (SELECT rowid FROM item WHERE id = ?)`, [id])
      db.run(
        `INSERT INTO ${table} (rowid, item_id, head, body) SELECT rowid, id, ?, ? FROM item WHERE id = ?`,
        [head, body, id]
      )
    }
  }

  function unindex(where: SqlClause): void {
    for (const table of FTS_TABLES) {
      db.run(
        `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM item WHERE ${where.sql})`,
        where.params
      )
    }
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
        appendVersion(id, at, input.origin.by, null, textParts(input.text))
        return mustItem(id)
      }),

    edit: (id, change, by, reason) =>
      write(() => {
        // A kind never changes: an edit with the other kind finds no such item.
        if (mustItem(id).kind !== change.text.kind) throw new Error(MEMORY_ERROR.notFound)
        const at = now()
        update(id, 'check_text = ?, updated_at = ?, last_seen_at = ?', [change.check, at, at])
        appendVersion(id, at, by, reason, textParts(change.text))
        return mustItem(id)
      }),

    setState: (id, state, by, reason) =>
      write(() => {
        const at = now()
        const current = mustItem(id)
        update(id, 'state = ?, updated_at = ?', [state, at])
        appendVersion(id, at, by, reason, textParts(current))
        return mustItem(id)
      }),

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
          'SELECT head, body FROM version WHERE item_id = ? AND at = ? ORDER BY rowid DESC LIMIT 1',
          TextRow,
          [id, versionAt]
        )
        if (old === null) throw new Error(MEMORY_ERROR.versionNotFound)
        const at = now()
        update(id, 'updated_at = ?', [at])
        appendVersion(id, at, 'operator', null, [old.head, old.body])
        return mustItem(id)
      }),

    remove: (id) => {
      write(() => {
        mustItem(id)
        const where = { sql: 'id = ?', params: [id] }
        unindex(where)
        // Its versions go with it (ON DELETE CASCADE).
        db.run('DELETE FROM item WHERE id = ?', [id])
      })
    },

    get: (id) => read(() => findItem(id)),

    versions: (id) =>
      read(() => {
        mustItem(id)
        return db.all(
          'SELECT at, by, reason, head, body FROM version WHERE item_id = ? ORDER BY at DESC, rowid DESC',
          MemoryVersionSchema,
          [id]
        )
      }),

    search: (scope, input, ctx) =>
      read(() => {
        const narrow = and([
          scopeClause(scope),
          ...(input.kind === null ? [] : [{ sql: 'item.kind = ?', params: [input.kind] }]),
          ...filterClauses(input.filters, ctx)
        ])
        const hits = input.query === null ? null : textHits(input.query)
        if (hits === null) {
          return {
            total: count(narrow),
            rows: db.all(
              `SELECT ${ITEM_COLUMNS} FROM item ${CURRENT_JOIN} WHERE ${narrow.sql}
               ORDER BY ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
              ListRow,
              [...narrow.params, input.limit, input.offset]
            )
          }
        }
        const fromHits = (columns: string): string =>
          `${hits.sql} SELECT ${columns} FROM hit JOIN item ON item.rowid = hit.item_rowid`
        const params = [...hits.params, ...narrow.params]
        const total =
          db.get(`${fromHits('COUNT(*) AS n')} WHERE ${narrow.sql}`, CountRow, params)?.n ?? 0
        const rows = db.all(
          `${fromHits(ITEM_COLUMNS)} ${CURRENT_JOIN} WHERE ${narrow.sql}
           ORDER BY hit.tier, hit.rank, ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
          ListRow,
          [...params, input.limit, input.offset]
        )
        return { total, rows }
      }),

    browse: (scope, by) =>
      read(() => {
        const { key, from } = BROWSE[by]
        const where = and([scopeClause(scope), ACTIVE])
        return db.all(
          `SELECT ${key} AS key, COUNT(*) AS count FROM ${from}
           WHERE ${where.sql} AND ${key} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`,
          BucketRow,
          where.params
        )
      }),

    indexRows: (workspaceId, folder) =>
      read(() => {
        const inScope = and([scopeClause({ workspaceId, includeGlobal: true }), ACTIVE])
        const pinned = db.all(
          `SELECT ${ITEM_COLUMNS} FROM item ${CURRENT_JOIN}
           WHERE ${inScope.sql} AND item.pinned = 1 ORDER BY ${NEWEST_FIRST}`,
          ItemRow,
          inScope.params
        )
        const near = folderAtOrUnder('item.folder', folder)
        const above = folderAbove('item.folder', folder)
        const here = and([
          inScope,
          {
            sql: "item.pinned = 0 AND item.kind = 'specific' AND item.folder IS NOT NULL",
            params: []
          },
          { sql: `(${near.sql} OR ${above.sql})`, params: [...near.params, ...above.params] }
        ])
        const specificsHere = db.all(
          `SELECT ${ITEM_COLUMNS} FROM item ${CURRENT_JOIN} WHERE ${here.sql}
           ORDER BY ${NEWEST_FIRST} LIMIT ?`,
          ListRow,
          [...here.params, SPECIFICS_HERE_MAX]
        )
        return {
          pinned,
          specificsHere,
          more: count(inScope) - pinned.length - specificsHere.length
        }
      }),

    removeByWorkspace: (workspaceId) =>
      write(() => {
        const where = { sql: 'workspace_id = ?', params: [workspaceId] }
        unindex(where)
        db.run(`DELETE FROM item WHERE ${where.sql}`, where.params)
        return changes()
      }),

    markSessionDeleted: (sessionId) =>
      write(() => {
        // A session deleted again keeps its first date.
        db.run(
          `UPDATE item SET origin_deleted_at = ?
           WHERE origin_session_id = ? AND origin_deleted_at IS NULL`,
          [now(), sessionId]
        )
        return changes()
      }),

    rebindSession: (oldSessionId, newSessionId) => {
      write(
        () => {
          db.run('UPDATE item SET origin_session_id = ? WHERE origin_session_id = ?', [
            newSessionId,
            oldSessionId
          ])
          return changes()
        },
        (changed) => changed > 0
      )
    },

    onChange: (listener) => {
      // A wrapper, so the same function subscribed twice is two subscriptions.
      const entry = (): void => listener()
      listeners.add(entry)
      return () => listeners.delete(entry)
    }
  }
}
