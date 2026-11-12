// The read side of the memory store (spec 2026-11-11 memory §2, §3): search, browse and the rows
// of a session's memory index. Every read narrows by scope in SQL. A search narrows by scope and
// app metadata first (`filterSql.ts`), then ranks by the word index, then adds what only the
// trigram index finds. These functions throw on any SQLite or row failure; `memoryStore.ts` wraps
// them so a failure is never mistaken for a result.
import { z } from 'zod'
import { MEMORY_FILTER_FIELDS, type MemoryFilters } from '../../shared/memory/filterFields'
import type { MemoryItem, MemoryRow } from '../../shared/schemas/memory'
import {
  FILTER_SQL,
  folderAbove,
  folderAtOrUnder,
  type FilterContext,
  type SqlClause
} from './filterSql'
import type { MemoryDb } from './memoryDb'
import { CountRow, ItemRow, ListRow, NEWEST_FIRST, selectItems } from './memoryRows'

export type MemoryScope = { workspaceId: string; includeGlobal: boolean }
export type MemorySearchInput = {
  kind: MemoryItem['kind'] | null
  query: string | null
  filters: MemoryFilters
  offset: number
  limit: number
}
export type BrowseBy = 'kind' | 'folder' | 'tag' | 'month'

const SPECIFICS_HERE_MAX = 50
/** The trigram index cannot match fewer characters than this. */
const TRIGRAM_MIN = 3
const ACTIVE: SqlClause = { sql: "item.state = 'active'", params: [] }
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

/** Rows the text matches, by the item's `rid` (the indexes' rowid): word-index hits (tier 0, by
 *  bm25), then rows only the trigram index finds (tier 1). A term under three characters is left
 *  out of the trigram query. */
function textHits(query: string): SqlClause | null {
  const terms = query.split(/\s+/).filter((t) => t !== '')
  if (terms.length === 0) return null
  const words = ftsQuery(terms)
  const wordsSql =
    'SELECT rowid AS item_rid, 0 AS tier, bm25(item_words) AS rank FROM item_words WHERE item_words MATCH ?'
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

function count(db: MemoryDb, where: SqlClause): number {
  return db.get(`SELECT COUNT(*) AS n FROM item WHERE ${where.sql}`, CountRow, where.params)?.n ?? 0
}

export function searchItems(
  db: MemoryDb,
  scope: MemoryScope,
  input: MemorySearchInput,
  ctx: FilterContext
): { rows: MemoryRow[]; total: number } {
  const narrow = and([
    scopeClause(scope),
    ...(input.kind === null ? [] : [{ sql: 'item.kind = ?', params: [input.kind] }]),
    ...filterClauses(input.filters, ctx)
  ])
  const hits = input.query === null ? null : textHits(input.query)
  if (hits === null) {
    return {
      total: count(db, narrow),
      rows: db.all(
        `${selectItems()} WHERE ${narrow.sql} ORDER BY ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
        ListRow,
        [...narrow.params, input.limit, input.offset]
      )
    }
  }
  const fromHits = 'hit JOIN item ON item.rid = hit.item_rid'
  const params = [...hits.params, ...narrow.params]
  const total =
    db.get(
      `${hits.sql} SELECT COUNT(*) AS n FROM ${fromHits} WHERE ${narrow.sql}`,
      CountRow,
      params
    )?.n ?? 0
  const rows = db.all(
    `${hits.sql} ${selectItems(fromHits)} WHERE ${narrow.sql}
     ORDER BY hit.tier, hit.rank, ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
    ListRow,
    [...params, input.limit, input.offset]
  )
  return { total, rows }
}

export function browseItems(
  db: MemoryDb,
  scope: MemoryScope,
  by: BrowseBy
): { key: string; count: number }[] {
  const { key, from } = BROWSE[by]
  const where = and([scopeClause(scope), ACTIVE])
  return db.all(
    `SELECT ${key} AS key, COUNT(*) AS count FROM ${from}
     WHERE ${where.sql} AND ${key} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1`,
    BucketRow,
    where.params
  )
}

/** A pinned specific is listed once, under `pinned`; `more` counts every other active item. */
export function indexItems(
  db: MemoryDb,
  workspaceId: string,
  folder: string
): { pinned: MemoryItem[]; specificsHere: MemoryRow[]; more: number } {
  const inScope = and([scopeClause({ workspaceId, includeGlobal: true }), ACTIVE])
  const pinned = db.all(
    `${selectItems()} WHERE ${inScope.sql} AND item.pinned = 1 ORDER BY ${NEWEST_FIRST}`,
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
    `${selectItems()} WHERE ${here.sql} ORDER BY ${NEWEST_FIRST} LIMIT ?`,
    ListRow,
    [...here.params, SPECIFICS_HERE_MAX]
  )
  return {
    pinned,
    specificsHere,
    more: count(db, inScope) - pinned.length - specificsHere.length
  }
}
