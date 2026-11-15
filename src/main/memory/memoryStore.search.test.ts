// The memory store's read side (spec 2026-11-11 memory §2, §3): scope and filters narrow first,
// then the word index ranks, then the trigram index adds exact pieces. Real `:memory:` db.
import { beforeEach, describe, expect, it } from 'vitest'
import type { MemoryFilters } from '../../shared/memory/filterFields'
import type { EpisodeText, MemoryItem, MemoryText } from '../../shared/schemas/memory'
import type { FilterContext } from './filterSql'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryScope, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
const scope: MemoryScope = { workspaceId: 'w1', includeGlobal: true }
const ctx: FilterContext = {
  sessionFolder: '/work/app',
  tagIdsByName: (name) => (name === 'infra' ? ['t1'] : []),
  goalIdsByName: (name) => (name === 'ship' ? ['g1'] : [])
}

let clock: number
let ids: number
let store: MemoryStore

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  clock = NOW
  ids = 0
  store = createMemoryStore({
    db: open.db,
    now: () => clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
})

type Extra = Partial<MemoryItem['meta']> & { workspaceId?: string | null; sessionId?: string }

/** Each add is one second after the last, so `updatedAt` orders them. */
function add(text: MemoryText | EpisodeText, extra: Extra = {}): MemoryItem {
  clock += 1000
  const { workspaceId = 'w1', sessionId = 's1', ...meta } = extra
  return store.add({
    text,
    workspaceId,
    check: null,
    basis: 'stated',
    origin: { by: 'agent', sessionId },
    meta: {
      folder: null,
      sessionName: null,
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: [],
      ...meta
    },
    source: null
  })
}

function specific(key: string, value = 'v'): MemoryText {
  return { kind: 'specific', key, value }
}

function search(
  query: string | null,
  filters: MemoryFilters = {},
  page = { offset: 0, limit: 20 }
): ReturnType<MemoryStore['search']> {
  return store.search(scope, { kind: null, query, filters, ...page }, ctx)
}

function heads(query: string | null, filters: MemoryFilters = {}): string[] {
  return search(query, filters).rows.map((r) => r.head)
}

describe('query', () => {
  it.each(['port" OR (', 'a*', 'key:value', '-x', '""'])(
    'a query of %j returns without throwing',
    (q) => {
      add(specific('port'))
      expect(() =>
        store.search(scope, { kind: null, query: q, filters: {}, offset: 0, limit: 20 }, ctx)
      ).not.toThrow()
    }
  )

  it('an operator word in the query is a plain word, not an operator', () => {
    add(specific('port'))
    add(specific('host'))
    expect(heads('port OR host')).toEqual([])
  })

  it('finds a value by three characters from its middle', () => {
    add({ kind: 'specific', key: 'min claude for the mod', value: 'v2.1.304' })
    expect(heads('1.30')).toEqual(['min claude for the mod'])
  })

  it('a term under three characters is not sent to the trigram index', () => {
    add({ kind: 'specific', key: 'mod', value: 'v2.1.304' })
    add({ kind: 'specific', key: 'other', value: 'zz' })
    // "1.30" alone reaches the trigram index; "zz" is left out of it, so only the word index
    // could require it, and it does not hold "1.30".
    expect(heads('zz 1.30')).toEqual(['mod'])
  })

  it('word matches come first by rank, then trigram-only matches newest first', () => {
    add(specific('older piece', 'abcport9'))
    add(specific('port', 'port port port'))
    add(specific('port once', 'nothing'))
    add(specific('newer piece', 'xyzport1'))
    expect(heads('port')).toEqual(['port', 'port once', 'newer piece', 'older piece'])
  })

  it('with no query, rows come newest first', () => {
    add(specific('a'))
    add(specific('b'))
    add(specific('c'))
    expect(heads(null)).toEqual(['c', 'b', 'a'])
  })

  it('a query of only spaces is no query', () => {
    add(specific('a'))
    expect(heads('   ')).toEqual(['a'])
  })

  it('a fact row carries its current body', () => {
    add({ kind: 'fact', title: 'deploy', body: 'migrate first\nthen restart' })
    expect(
      store.search(scope, { kind: 'fact', query: null, filters: {}, offset: 0, limit: 5 }, ctx)
        .rows[0]?.body
    ).toBe('migrate first\nthen restart')
  })

  it('finds the current text, not an old version', () => {
    const { id } = add(specific('port', '9280'))
    store.edit(id, { text: specific('port', '9281'), check: null }, 'agent', null)
    expect([heads('9280'), heads('9281')]).toEqual([[], ['port']])
  })

  it('a removed item is not found', () => {
    const { id } = add(specific('port', '9280'))
    store.remove(id)
    expect(heads('9280')).toEqual([])
  })
})

describe('scope, kind, stale and pages', () => {
  it('a text query keeps to the scope', () => {
    add(specific('port', '9281'))
    add(specific('their port', '9281'), { workspaceId: 'w2' })
    expect(search('9281')).toMatchObject({ total: 1, rows: [{ head: 'port' }] })
  })

  it('a trigram-only query keeps to the scope', () => {
    add(specific('mine', 'v2.1.304'))
    add(specific('theirs', 'v2.1.304'), { workspaceId: 'w2' })
    expect(heads('1.30')).toEqual(['mine'])
  })

  it('scope is the workspace plus global when asked', () => {
    add(specific('mine'))
    add(specific('global'), { workspaceId: null })
    add(specific('theirs'), { workspaceId: 'w2' })
    expect(heads(null)).toEqual(['global', 'mine'])
    expect(
      store
        .search(
          { workspaceId: 'w1', includeGlobal: false },
          { kind: null, query: null, filters: {}, offset: 0, limit: 20 },
          ctx
        )
        .rows.map((r) => r.head)
    ).toEqual(['mine'])
  })

  it('the kind narrows the rows', () => {
    add(specific('a'))
    add({ kind: 'fact', title: 'b', body: 'x' })
    expect(
      store
        .search(scope, { kind: 'fact', query: null, filters: {}, offset: 0, limit: 20 }, ctx)
        .rows.map((r) => r.head)
    ).toEqual(['b'])
  })

  it('stale rows are left out unless includeStale', () => {
    const { id } = add(specific('old'))
    add(specific('new'))
    store.setState(id, 'stale', 'agent', null)
    expect([heads(null), heads(null, { includeStale: true }).sort()]).toEqual([
      ['new'],
      ['new', 'old']
    ])
  })

  it('total counts every match and rows is the page', () => {
    for (const k of ['a', 'b', 'c', 'd', 'e']) add(specific(k))
    expect(search(null, {}, { offset: 1, limit: 2 })).toMatchObject({
      total: 5,
      rows: [{ head: 'd' }, { head: 'c' }]
    })
  })

  it('total holds past the last page', () => {
    add(specific('a'))
    expect(search(null, {}, { offset: 10, limit: 2 })).toEqual({ total: 1, rows: [] })
  })

  it('total counts word and trigram matches together', () => {
    add(specific('port'))
    add(specific('x', 'abcport'))
    add(specific('unrelated'))
    expect(search('port', {}, { offset: 0, limit: 1 }).total).toBe(2)
  })

  it('a row carries its list fields', () => {
    add(specific('port', '9280'), { folder: '/work/app', sessionName: 'build', tagIds: ['t1'] })
    expect(search(null).rows[0]).toEqual({
      id: 'm1',
      kind: 'specific',
      head: 'port',
      body: '9280',
      updatedAt: NOW + 1000,
      basis: 'stated',
      state: 'active',
      pinned: false,
      workspaceId: 'w1',
      folder: '/work/app',
      sessionName: 'build',
      tagIds: ['t1'],
      originDeletedAt: null
    })
  })
})

describe('filters', () => {
  it('a folder matches itself and below on a path boundary', () => {
    add(specific('self'), { folder: '/a/b' })
    add(specific('below'), { folder: '/a/b/c' })
    add(specific('sibling'), { folder: '/a/bc' })
    expect(heads(null, { folder: '/a/b' })).toEqual(['below', 'self'])
  })

  it('a folder with % and _ in its name matches only itself', () => {
    add(specific('a'), { folder: '/work/100%_done' })
    add(specific('b'), { folder: '/work/100x_done' })
    // Below a look-alike folder: only a wildcard pattern match reaches it.
    add(specific('c'), { folder: '/work/100x_done/src' })
    expect(heads(null, { folder: '/work/100%_done' })).toEqual(['a'])
  })

  it('a folder matches by exact case', () => {
    add(specific('lower'), { folder: '/work/app/x' })
    add(specific('upper'), { folder: '/work/App/x' })
    expect(heads(null, { folder: '/work/App' })).toEqual(['upper'])
  })

  it('the root folder matches every absolute folder', () => {
    add(specific('a'), { folder: '/a' })
    add(specific('b'), { folder: '/b/c' })
    expect(heads(null, { folder: '/' })).toEqual(['b', 'a'])
  })

  it('"here" is the session folder', () => {
    add(specific('here'), { folder: '/work/app' })
    add(specific('there'), { folder: '/work/other' })
    expect(heads(null, { folder: 'here' })).toEqual(['here'])
  })

  it('"here" with no session folder matches nothing', () => {
    add(specific('here'), { folder: '/work/app' })
    expect(
      store.search(
        scope,
        { kind: null, query: null, filters: { folder: 'here' }, offset: 0, limit: 20 },
        { ...ctx, sessionFolder: null }
      ).total
    ).toBe(0)
  })

  it('a session matches part of the saved session name', () => {
    add(specific('a'), { sessionName: 'Build the API' })
    add(specific('b'), { sessionName: 'docs' })
    expect(heads(null, { session: 'the api' })).toEqual(['a'])
  })

  it('tags match an item with any of their ids', () => {
    add(specific('tagged'), { tagIds: ['x', 't1'] })
    add(specific('untagged'))
    expect(heads(null, { tags: ['infra'] })).toEqual(['tagged'])
  })

  it('a tag name that resolves to no id matches nothing', () => {
    add(specific('tagged'), { tagIds: ['t1'] })
    expect(heads(null, { tags: ['gone'] })).toEqual([])
  })

  it('lists an item whose tag and goal ids are unknown', () => {
    add(specific('orphan'), { tagIds: ['gone'], goalId: 'gone-goal' })
    expect(heads(null)).toEqual(['orphan'])
  })

  it('a goal matches the items of its ids', () => {
    add(specific('goal'), { goalId: 'g1' })
    add(specific('none'))
    expect([heads(null, { goal: 'ship' }), heads(null, { goal: 'nope' })]).toEqual([['goal'], []])
  })

  it('sessionDeleted keeps only items of a deleted session', () => {
    add(specific('gone'), { sessionId: 's-gone' })
    add(specific('live'))
    store.markSessionDeleted('s-gone')
    expect(heads(null, { sessionDeleted: true })).toEqual(['gone'])
  })

  it('filters narrow before the text query', () => {
    add(specific('port'), { folder: '/a' })
    add(specific('port'), { folder: '/b' })
    expect(search('port', { folder: '/a' }).rows.map((r) => r.folder)).toEqual(['/a'])
  })
})

describe('browse', () => {
  it('counts by kind', () => {
    add(specific('a'))
    add(specific('b'))
    add({ kind: 'fact', title: 'c', body: 'x' })
    expect(store.browse(scope, 'kind')).toEqual([
      { key: 'specific', count: 2 },
      { key: 'fact', count: 1 }
    ])
  })

  it('counts by folder and by tag, in scope, active only', () => {
    add(specific('a'), { folder: '/a', tagIds: ['t1', 't2'] })
    add(specific('b'), { folder: '/a', tagIds: ['t1'] })
    add(specific('c'), { folder: '/b', workspaceId: 'w2' })
    const { id } = add(specific('d'), { folder: '/z' })
    store.setState(id, 'stale', 'agent', null)
    expect([store.browse(scope, 'folder'), store.browse(scope, 'tag')]).toEqual([
      [{ key: '/a', count: 2 }],
      [
        { key: 't1', count: 2 },
        { key: 't2', count: 1 }
      ]
    ])
  })
})

describe('indexRows', () => {
  it('pinned holds every pinned active item of the workspace or global', () => {
    store.setPinned(add(specific('mine')).id, true)
    store.setPinned(add(specific('global'), { workspaceId: null }).id, true)
    store.setPinned(add(specific('theirs'), { workspaceId: 'w2' }).id, true)
    const stale = add(specific('stale'))
    store.setPinned(stale.id, true)
    store.setState(stale.id, 'stale', 'agent', null)
    expect(store.indexRows('w1', '/work').pinned.map((i) => i.id)).toEqual(['m2', 'm1'])
  })

  it('active counts every active item of the workspace and global, pinned and episodes included', () => {
    add(specific('here'), { folder: '/work/app' })
    add(specific('global'), { workspaceId: null })
    add(specific('theirs'), { workspaceId: 'w2' })
    store.setPinned(add(specific('pinned')).id, true)
    store.setState(add(specific('stale')).id, 'stale', 'agent', null)
    add({ kind: 'episode', title: 'a run', body: 'x', endedAt: NOW }, { folder: '/work/app' })
    expect(store.indexRows('w1', '/work/app').active).toBe(4)
  })
})

describe('contextRows (the index keys) on the folder rules', () => {
  const BARE = { folder: '/work/app', taskIds: [], goalId: null, templateId: null, tagIds: [] }
  const placed = (folder = '/work/app'): Record<string, string[]> =>
    Object.fromEntries(
      store.contextRows('w1', { ...BARE, folder }).map((g) => [g.reason, g.rows.map((r) => r.head)])
    )

  it('the folder, above and below it on a path boundary, each its own group, facts included', () => {
    add(specific('above'), { folder: '/work' })
    add(specific('self'), { folder: '/work/app' })
    add(specific('below'), { folder: '/work/app/src' })
    add(specific('sibling'), { folder: '/work/apple' })
    add({ kind: 'fact', title: 'fact here', body: 'x' }, { folder: '/work/app' })
    expect(placed()).toEqual({
      folder: ['fact here', 'self'],
      folder_above: ['above'],
      folder_below: ['below']
    })
  })

  it('a group hands over at most 40 rows and counts them all', () => {
    for (let i = 0; i < 52; i++) add(specific(`k${i}`), { folder: '/work/app' })
    const [group] = store.contextRows('w1', BARE)
    expect([group?.rows.length, group?.rows[0]?.head, group?.total]).toEqual([40, 'k51', 52])
  })

  it('keeps to the workspace and global', () => {
    add(specific('mine'), { folder: '/work/app' })
    add(specific('global'), { folder: '/work/app', workspaceId: null })
    add(specific('theirs'), { folder: '/work/app', workspaceId: 'w2' })
    expect(placed()).toEqual({ folder: ['global', 'mine'] })
  })

  it('matches folders above and below by exact case', () => {
    add(specific('upper above'), { folder: '/Work' })
    add(specific('upper below'), { folder: '/work/App/src' })
    add(specific('above'), { folder: '/work' })
    expect(placed()).toEqual({ folder_above: ['above'] })
  })

  it('a key carries its current value', () => {
    const { id } = add(specific('port', '9280'), { folder: '/work/app' })
    store.edit(id, { text: specific('port', '9281'), check: null }, 'agent', null)
    expect(store.contextRows('w1', BARE)[0]?.rows.map((r) => r.body)).toEqual(['9281'])
  })

  it('the root folder is above every folder', () => {
    add(specific('root'), { folder: '/' })
    expect(placed()).toEqual({ folder_above: ['root'] })
  })

  it('a pinned item is listed once, under pinned', () => {
    store.setPinned(add(specific('pinned'), { folder: '/work/app' }).id, true)
    const out = store.indexRows('w1', '/work/app')
    expect([out.pinned.length, store.contextRows('w1', BARE), out.active]).toEqual([1, [], 1])
  })
})
