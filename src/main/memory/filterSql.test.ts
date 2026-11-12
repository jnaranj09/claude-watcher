// One SQL clause per memory filter field (spec 2026-11-11 memory §2). These pin what each builder
// sends to SQLite; `memoryStore.search.test.ts` proves the clauses against a real database.
import { describe, expect, it } from 'vitest'
import { FILTER_SQL, type FilterContext } from './filterSql'

const ctx: FilterContext = {
  sessionFolder: '/work/app',
  tagIdsByName: (name) => (name === 'infra' ? ['t1', 't2'] : name === 'ops' ? ['t2'] : []),
  goalIdsByName: (name) => (name === 'ship' ? ['g1'] : [])
}
const noFolder: FilterContext = { ...ctx, sessionFolder: null }

describe('FILTER_SQL', () => {
  it('a folder is compared exactly, with no LIKE pattern', () => {
    expect(FILTER_SQL.folder('/w/100%_a\\b', ctx)).toEqual({
      sql: '(item.folder = ? OR substr(item.folder, 1, length(?)) = ?)',
      params: ['/w/100%_a\\b', '/w/100%_a\\b/', '/w/100%_a\\b/']
    })
  })

  it('a folder with a trailing slash matches the same folder', () => {
    expect(FILTER_SQL.folder('/work/app/', ctx)?.params).toEqual([
      '/work/app',
      '/work/app/',
      '/work/app/'
    ])
  })

  it('the root folder is itself and every absolute path under it', () => {
    expect(FILTER_SQL.folder('/', ctx)?.params).toEqual(['/', '/', '/'])
  })

  it('"here" is the session folder', () => {
    expect(FILTER_SQL.folder('here', ctx)?.params).toEqual([
      '/work/app',
      '/work/app/',
      '/work/app/'
    ])
  })

  it('"here" with no session folder matches nothing', () => {
    expect(FILTER_SQL.folder('here', noFolder)).toEqual({ sql: '0', params: [] })
  })

  it('a session is part of the saved session name, escaped', () => {
    expect(FILTER_SQL.session('50%', ctx)?.params).toEqual(['%50\\%%'])
  })

  it('tags match any id of any name, each id once', () => {
    expect(FILTER_SQL.tags(['infra', 'ops'], ctx)?.params).toEqual(['t1', 't2'])
  })

  it('tag names that resolve to no id match nothing', () => {
    expect(FILTER_SQL.tags(['gone'], ctx)).toEqual({ sql: '0', params: [] })
  })

  it('an empty tag list does not narrow', () => {
    expect(FILTER_SQL.tags([], ctx)).toBeNull()
  })

  it('a goal name that resolves to no id matches nothing', () => {
    expect(FILTER_SQL.goal('nope', ctx)).toEqual({ sql: '0', params: [] })
  })

  it('a goal name matches its ids', () => {
    expect(FILTER_SQL.goal('ship', ctx)?.params).toEqual(['g1'])
  })

  it('since starts at local midnight of that day', () => {
    expect(FILTER_SQL.since('2026-03-05', ctx)?.params).toEqual([
      new Date(2026, 2, 5, 0, 0, 0, 0).getTime()
    ])
  })

  it('until ends at the last millisecond of that local day', () => {
    expect(FILTER_SQL.until('2026-03-05', ctx)?.params).toEqual([
      new Date(2026, 2, 5, 23, 59, 59, 999).getTime()
    ])
  })

  it('a year under 100 is that year, not 19xx', () => {
    expect(FILTER_SQL.since('0050-01-01', ctx)?.params).toEqual([
      new Date('0050-01-01T00:00:00').getTime()
    ])
  })

  it('sessionDeleted true keeps only items of a deleted session; false does not narrow', () => {
    expect([
      FILTER_SQL.sessionDeleted(true, ctx)?.sql,
      FILTER_SQL.sessionDeleted(false, ctx)
    ]).toEqual(['item.origin_deleted_at IS NOT NULL', null])
  })

  it('includeStale false keeps active items only; true does not narrow', () => {
    expect([FILTER_SQL.includeStale(false, ctx)?.sql, FILTER_SQL.includeStale(true, ctx)]).toEqual([
      "item.state = 'active'",
      null
    ])
  })
})
