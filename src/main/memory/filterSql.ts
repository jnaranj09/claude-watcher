// One SQL clause per memory filter field (spec 2026-11-11 memory §2, "one filter registry"). The
// mapped type over `MemoryFilterName` makes a field added to `MEMORY_FILTER_FIELDS` without a
// builder here a compile error. Every clause reads the `item` table under that alias and passes
// values as parameters, never in the SQL text. A clause of `null` does not narrow; `NOTHING`
// matches no row (a name that resolves to no id must not match everything).
import type { MemoryFilterName, MemoryFilters } from '../../shared/memory/filterFields'
import type { SqlValue } from './memoryDb'

/** What the store's caller knows that the database does not. */
export interface FilterContext {
  /** What "here" means; null → "here" matches nothing. */
  sessionFolder: string | null
  tagIdsByName(name: string): string[]
  goalIdsByName(name: string): string[]
}

export interface SqlClause {
  sql: string
  params: SqlValue[]
}

const NOTHING: SqlClause = { sql: '0', params: [] }

/** Escapes LIKE's wildcards and the escape character itself; pair with `ESCAPE '\'`. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** `column` is `folder` or anywhere under it, on a path boundary (`/a/b` holds `/a/b/c`, not
 *  `/a/bc`). A trailing slash is ignored; the root `/` holds every absolute path. */
export function folderAtOrUnder(column: string, folder: string): SqlClause {
  const base = folder.replace(/\/+$/, '')
  return {
    sql: `(${column} = ? OR ${column} LIKE ? ESCAPE '\\')`,
    params: [base === '' ? '/' : base, `${likeEscape(base)}/%`]
  }
}

/** `column` is a folder that holds `folder` (an ancestor, on a path boundary). */
export function folderAbove(column: string, folder: string): SqlClause {
  const escaped = `replace(replace(replace(rtrim(${column}, '/'), '\\', '\\\\'), '%', '\\%'), '_', '\\_')`
  return { sql: `(? LIKE ${escaped} || '/%' ESCAPE '\\')`, params: [folder.replace(/\/+$/, '')] }
}

function idsIn(expression: string, ids: readonly string[]): SqlClause {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return NOTHING
  return { sql: `${expression} IN (${unique.map(() => '?').join(', ')})`, params: unique }
}

/** A `YYYY-MM-DD` (already validated by `MemoryFiltersSchema`) as a LOCAL time on that day. */
function localDay(day: string, hours: [number, number, number, number]): number {
  const at = new Date(0)
  at.setFullYear(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
  at.setHours(...hours)
  return at.getTime()
}

export const FILTER_SQL: {
  [K in MemoryFilterName]: (
    value: NonNullable<MemoryFilters[K]>,
    ctx: FilterContext
  ) => SqlClause | null
} = {
  folder: (value, ctx) => {
    const folder = value === 'here' ? ctx.sessionFolder : value
    return folder === null ? NOTHING : folderAtOrUnder('item.folder', folder)
  },
  session: (part) => ({
    sql: `json_extract(item.meta, '$.sessionName') LIKE ? ESCAPE '\\'`,
    params: [`%${likeEscape(part)}%`]
  }),
  tags: (names, ctx) => {
    if (names.length === 0) return null
    const ids = names.flatMap((name) => ctx.tagIdsByName(name))
    const match = idsIn('tag.value', ids)
    if (match === NOTHING) return NOTHING
    return {
      sql: `EXISTS (SELECT 1 FROM json_each(item.meta, '$.tagIds') AS tag WHERE ${match.sql})`,
      params: match.params
    }
  },
  since: (day) => ({ sql: 'item.updated_at >= ?', params: [localDay(day, [0, 0, 0, 0])] }),
  until: (day) => ({ sql: 'item.updated_at <= ?', params: [localDay(day, [23, 59, 59, 999])] }),
  goal: (name, ctx) => idsIn(`json_extract(item.meta, '$.goalId')`, ctx.goalIdsByName(name)),
  sessionDeleted: (only) =>
    only ? { sql: 'item.origin_deleted_at IS NOT NULL', params: [] } : null,
  includeStale: (include) => (include ? null : { sql: "item.state = 'active'", params: [] })
}
