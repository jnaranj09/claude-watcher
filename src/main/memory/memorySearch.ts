// The read side of the memory store (spec 2026-11-11 memory §2, §3): search, browse and the rows
// of a session's memory index. Every read narrows by scope in SQL. A search narrows by scope and
// app metadata first (`filterSql.ts`), then ranks by the word index, then adds what only the
// trigram index finds. The reads extraction needs (memory phase 2: the scope shown to the model,
// the specifics a session saved without a source, who wrote an item's current text) live here
// too, and so do the reads recall needs while a session runs (phase 3 addendum §6): the items a
// prompt's terms name, the folders that hold saved keys, and the keys of a folder. These functions throw on any SQLite or row failure; `memoryStore.ts` wraps them so a
// failure is never mistaken for a result.
import { z } from 'zod'
import { MEMORY_FILTER_FIELDS, type MemoryFilters } from '../../shared/memory/filterFields'
import {
  MEMORY_ITEM_KINDS,
  MEMORY_WRITERS,
  type MemoryItem,
  type MemoryItemKind,
  type MemoryRow,
  type MemoryWriter
} from '../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../shared/schemas/memoryExtract'
import {
  FILTER_SQL,
  folderAbove,
  folderAtOrUnder,
  type FilterContext,
  type SqlClause
} from './filterSql'
import type { MemoryDb, SqlValue } from './memoryDb'
import {
  CountRow,
  CURRENT_JOIN,
  EpisodeListRow,
  ItemRow,
  ListRow,
  NEWEST_ENDED_FIRST,
  NEWEST_FIRST,
  selectItems,
  type EpisodeRow
} from './memoryRows'
import type { RecallTerm } from './recallTerms'

export type MemoryScope = { workspaceId: string; includeGlobal: boolean }
export type MemorySearchInput = {
  kind: MemoryItemKind | null
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
/** Row ids one recall term may bring: its newest, so a new item behind many old ones on a common
 *  term still counts that term. */
const RECALL_HITS_PER_TERM = 200
const RECALLABLE: SqlClause = {
  sql: "item.pinned = 0 AND item.kind IN ('specific', 'fact')",
  params: []
}
const SPECIFIC: SqlClause = { sql: "item.kind = 'specific'", params: [] }
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

/** `item.folder` is `folder`, above it or below it on a path boundary. */
function relatedFolder(folder: string): SqlClause {
  const near = folderAtOrUnder('item.folder', folder)
  const above = folderAbove('item.folder', folder)
  return { sql: `(${near.sql} OR ${above.sql})`, params: [...near.params, ...above.params] }
}

/** Active, unpinned items of one kind whose folder is related to `folder`, newest first. */
function hereOfKind<T>(
  db: MemoryDb,
  inScope: SqlClause,
  kind: MemoryItemKind,
  folder: string,
  limit: number,
  read: { row: z.ZodType<T>; order: string }
): T[] {
  const here = and([
    inScope,
    { sql: 'item.pinned = 0 AND item.kind = ? AND item.folder IS NOT NULL', params: [kind] },
    relatedFolder(folder)
  ])
  return db.all(`${selectItems()} WHERE ${here.sql} ORDER BY ${read.order} LIMIT ?`, read.row, [
    ...here.params,
    limit
  ])
}

/** A pinned specific is listed once, under `pinned`; `more` counts every other active item (an
 *  episode is never pinned, so it is never listed twice). */
export function indexItems(
  db: MemoryDb,
  workspaceId: string,
  folder: string
): {
  pinned: MemoryItem[]
  specificsHere: MemoryRow[]
  episodesHere: EpisodeRow[]
  more: number
} {
  const inScope = and([scopeClause({ workspaceId, includeGlobal: true }), ACTIVE])
  const pinned = db.all(
    `${selectItems()} WHERE ${inScope.sql} AND item.pinned = 1 ORDER BY ${NEWEST_FIRST}`,
    ItemRow,
    inScope.params
  )
  const specificsHere = hereOfKind(db, inScope, 'specific', folder, SPECIFICS_HERE_MAX, {
    row: ListRow,
    order: NEWEST_FIRST
  })
  // Episodes by the day their session ended: a catch-up or a state change never reorders them.
  const episodesHere = hereOfKind(db, inScope, 'episode', folder, EXTRACT_LIMITS.episodesInIndex, {
    row: EpisodeListRow,
    order: NEWEST_ENDED_FIRST
  })
  return {
    pinned,
    specificsHere,
    episodesHere,
    more: count(db, inScope) - pinned.length - specificsHere.length - episodesHere.length
  }
}

const ScopeRow = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_ITEM_KINDS),
  head: z.string(),
  body: z.string()
})

/** At most `limit` active items of the workspace and global, in this order: saved by
 *  `originSessionId`, pinned, of `folder` (at, above or below it), newest (D19). */
export function extractScope(
  db: MemoryDb,
  workspaceId: string,
  folder: string | null,
  originSessionId: string,
  limit: number
): { id: string; kind: MemoryItemKind; head: string; body: string }[] {
  const inScope = and([scopeClause({ workspaceId, includeGlobal: true }), ACTIVE])
  // No folder: no item is "of this folder", so that rank is left out (SQLite refuses a constant
  // ORDER BY term).
  const here = folder === null ? null : relatedFolder(folder)
  const hereRank = here === null ? '' : `(item.folder IS NOT NULL AND ${here.sql}) DESC,`
  return db.all(
    `SELECT item.id, item.kind, cur.head, cur.body FROM item ${CURRENT_JOIN}
     WHERE ${inScope.sql}
     ORDER BY item.origin_session_id IS ? DESC, item.pinned DESC, ${hereRank} ${NEWEST_FIRST}
     LIMIT ?`,
    ScopeRow,
    [...inScope.params, originSessionId, ...(here?.params ?? []), limit]
  )
}

const SpecificValueRow = z.object({ id: z.string(), value: z.string() })

/** Active specifics `originSessionId` saved with the tool (origin `agent`) that have no source
 *  yet, oldest first. */
export function agentSpecificsNoSource(
  db: MemoryDb,
  originSessionId: string
): { id: string; value: string }[] {
  return db.all(
    `SELECT item.id, cur.body AS value FROM item ${CURRENT_JOIN}
     WHERE item.kind = 'specific' AND item.state = 'active' AND item.origin_by = 'agent'
       AND item.origin_session_id = ? AND item.source_quote IS NULL
     ORDER BY item.created_at, item.rid`,
    SpecificValueRow,
    [originSessionId]
  )
}

const WriterRow = z.object({ by: z.enum(MEMORY_WRITERS) })

/** Who wrote the newest version; null for an unknown id. */
export function writerOfCurrent(db: MemoryDb, id: string): MemoryWriter | null {
  return (
    db.get(
      'SELECT by FROM version WHERE item_id = ? ORDER BY at DESC, seq DESC LIMIT 1',
      WriterRow,
      [id]
    )?.by ?? null
  )
}

/** `column` is one of `values`, each a parameter. `IN` compares with `=`: never a pattern. An
 *  empty list is allowed in SQLite (`IN ()` matches nothing, `NOT IN ()` everything). */
function inList(column: string, values: readonly SqlValue[], negate = false): SqlClause {
  return {
    sql: `${column} ${negate ? 'NOT IN' : 'IN'} (${values.map(() => '?').join(', ')})`,
    params: [...values]
  }
}

function notIdIn(ids: readonly string[]): SqlClause {
  return inList('item.id', ids, true)
}

const RecallHitRow = z.object({ id: z.string(), updated_at: z.number() })
type RecallTally = { exact: number; distinct: number; updatedAt: number }

/** Exact terms matched (more first), terms matched (more first), newest, id. */
function byRecallRank([aId, a]: [string, RecallTally], [bId, b]: [string, RecallTally]): number {
  return (
    b.exact - a.exact ||
    b.distinct - a.distinct ||
    b.updatedAt - a.updatedAt ||
    (aId < bId ? -1 : aId > bId ? 1 : 0)
  )
}

/** The active, unpinned specifics and facts in scope the terms name: one FTS5 phrase per term
 *  (its newest `RECALL_HITS_PER_TERM` rows). An item qualifies with two distinct terms matched,
 *  or one exact term. The first `limit` by rank, as whole items. */
export function recallItems(
  db: MemoryDb,
  scope: MemoryScope,
  terms: readonly RecallTerm[],
  excludeIds: readonly string[],
  limit: number
): MemoryItem[] {
  const where = and([scopeClause(scope), ACTIVE, RECALLABLE, notIdIn(excludeIds)])
  const exactOf = new Map<string, boolean>()
  for (const t of terms) exactOf.set(t.term, (exactOf.get(t.term) ?? false) || t.exact)
  const tally = new Map<string, RecallTally>()
  for (const [term, exact] of exactOf) {
    const hits = db.all(
      `SELECT item.id, item.updated_at FROM item_words JOIN item ON item.rid = item_words.rowid
       WHERE item_words MATCH ? AND ${where.sql} ORDER BY item.updated_at DESC, item.id LIMIT ?`,
      RecallHitRow,
      [ftsQuery([term]), ...where.params, RECALL_HITS_PER_TERM]
    )
    for (const hit of hits) {
      const t = tally.get(hit.id) ?? { exact: 0, distinct: 0, updatedAt: hit.updated_at }
      tally.set(hit.id, { ...t, exact: t.exact + (exact ? 1 : 0), distinct: t.distinct + 1 })
    }
  }
  const winners = [...tally]
    .filter(([, t]) => t.distinct >= 2 || t.exact >= 1)
    .sort(byRecallRank)
    .slice(0, limit)
    .map(([id]) => id)
  const items = db.all(`${selectItems()} WHERE ${inList('item.id', winners).sql}`, ItemRow, winners)
  const byId = new Map(items.map((item) => [item.id, item]))
  return winners.flatMap((id) => byId.get(id) ?? [])
}

const FolderRow = z.object({ folder: z.string() })

/** The folders of active specifics in scope not in `excludeIds`, by each folder's newest
 *  `updated_at`, at most `limit`. A pinned specific counts on purpose: one the index cut at its
 *  ceiling is not in `excludeIds`, and its folder is the only way back to it. */
export function specificFolders(
  db: MemoryDb,
  scope: MemoryScope,
  excludeIds: readonly string[],
  limit: number
): string[] {
  const where = and([scopeClause(scope), ACTIVE, SPECIFIC, notIdIn(excludeIds)])
  return db
    .all(
      `SELECT item.folder AS folder FROM item WHERE ${where.sql} AND item.folder IS NOT NULL
       GROUP BY item.folder ORDER BY MAX(item.updated_at) DESC, item.folder LIMIT ?`,
      FolderRow,
      [...where.params, limit]
    )
    .map((r) => r.folder)
}

/** Active specifics in scope whose folder EQUALS one of `folders` (never at or under it), not in
 *  `excludeIds`, newest first, at most `limit`; `more` counts the rest. */
export function folderSpecifics(
  db: MemoryDb,
  scope: MemoryScope,
  folders: readonly string[],
  excludeIds: readonly string[],
  limit: number
): { rows: MemoryRow[]; more: number } {
  const where = and([
    scopeClause(scope),
    ACTIVE,
    SPECIFIC,
    inList('item.folder', folders),
    notIdIn(excludeIds)
  ])
  const rows = db.all(
    `${selectItems()} WHERE ${where.sql} ORDER BY ${NEWEST_FIRST} LIMIT ?`,
    ListRow,
    [...where.params, limit]
  )
  return { rows, more: count(db, where) - rows.length }
}
