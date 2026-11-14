// The memory store's twin reads (the Memory dialog's `Same value` flag, `memoryTwins.ts`): which
// active specifics in scope hold the same exact value as another one in their workspace and
// folder, and the twins of one item. Real `:memory:` db.
import { beforeEach, describe, expect, it } from 'vitest'
import { MEMORY_ERROR, type MemoryItem, type MemoryText } from '../../shared/schemas/memory'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryScope, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
const scope: MemoryScope = { workspaceId: 'w1', includeGlobal: true }

let clock: number
let ids: number
let db: MemoryDb
let store: MemoryStore

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  clock = NOW
  ids = 0
  store = createMemoryStore({
    db,
    now: () => clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
})

type Extra = { folder?: string | null; workspaceId?: string | null }

/** Each add is one second after the last, so `updatedAt` orders them. */
function add(text: MemoryText, extra: Extra = {}): MemoryItem {
  clock += 1000
  const { workspaceId = 'w1', folder = null } = extra
  return store.add({
    text,
    workspaceId,
    check: null,
    basis: 'stated',
    origin: { by: 'agent', sessionId: 's1' },
    meta: {
      folder,
      sessionName: null,
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: []
    },
    source: null
  })
}

function specific(key: string, value: string): MemoryText {
  return { kind: 'specific', key, value }
}

function fact(title: string, body: string): MemoryText {
  return { kind: 'fact', title, body }
}

describe('twins', () => {
  // 1
  it('twinIds lists the active specifics in scope that have a twin', () => {
    const a = add(specific('API port', '9281'), { folder: '/work/app' })
    const b = add(specific('port of the api', '9281'), { folder: '/work/app' })
    add(specific('web port', '9281'), { folder: '/work/web' })
    add(fact('9281', '9281'), { folder: '/work/app' })
    add(specific('elsewhere a', '9281'), { workspaceId: 'w2', folder: '/work/app' })
    add(specific('elsewhere b', '9281'), { workspaceId: 'w2', folder: '/work/app' })
    expect(store.twinIds(scope).sort()).toEqual([a.id, b.id].sort())
  })
  // 2
  it('a global pair is listed only with Include global', () => {
    const a = add(specific('vpn a', 'vpn.acme.test'), { workspaceId: null })
    const b = add(specific('vpn b', 'vpn.acme.test'), { workspaceId: null })
    expect(store.twinIds({ workspaceId: 'w1', includeGlobal: true }).sort()).toEqual(
      [a.id, b.id].sort()
    )
    expect(store.twinIds({ workspaceId: 'w1', includeGlobal: false })).toEqual([])
  })
  // 3
  it('twinsOf names the twins newest first, and nothing for an unknown id, a fact or a stale item', () => {
    const a = add(specific('API port', '9281'))
    const b = add(specific('port of the api', '9281'))
    const d = add(specific('the api port', '9281'))
    const note = add(fact('9281', '9281'))
    expect(store.twinsOf(a.id, 5).twins.map((t) => [t.id, t.key])).toEqual([
      [d.id, 'the api port'],
      [b.id, 'port of the api']
    ])
    expect(store.twinsOf(a.id, 5).twins[0]?.updatedAt).toBe(d.updatedAt)
    store.setState(d.id, 'stale', 'operator', null)
    expect([
      store.twinsOf('nope', 5).twins,
      store.twinsOf(note.id, 5).twins,
      store.twinsOf(d.id, 5).twins
    ]).toEqual([[], [], []])
    expect(store.twinsOf(a.id, 5).twins.map((t) => t.id)).toEqual([b.id])
  })
  // 4 (Review Focus 4)
  it('an edit to another value, a stale mark or a delete clears the flag on both', () => {
    const pair = (): [string, string] => [
      add(specific('API port', '9281')).id,
      add(specific('port of the api', '9281')).id
    ]
    const [a1, b1] = pair()
    store.edit(b1, { text: specific('port of the api', '9282'), check: null }, 'operator', null)
    expect([store.twinIds(scope), store.twinsOf(a1, 5).twins]).toEqual([[], []])
    store.remove(a1)
    store.remove(b1)
    const [a2, b2] = pair()
    store.setState(b2, 'stale', 'operator', null)
    expect([store.twinIds(scope), store.twinsOf(a2, 5).twins]).toEqual([[], []])
    store.remove(a2)
    store.remove(b2)
    const [a3, b3] = pair()
    store.remove(b3)
    expect([store.twinIds(scope), store.twinsOf(a3, 5).twins]).toEqual([[], []])
  })
  // 5
  it('a failed twin read throws memory_read_failed, never an empty answer', () => {
    add(specific('API port', '9281'))
    db.close()
    expect(() => store.twinIds(scope)).toThrow(MEMORY_ERROR.readFailed)
    expect(() => store.twinsOf('m1', 5).twins).toThrow(MEMORY_ERROR.readFailed)
  })
  // 6 (review M-2)
  it("twinsOf reads only the specifics of the item's own workspace and folder", () => {
    // The same value in another folder and another workspace: the rule would drop them anyway, so
    // only the size of the read shows whether the SQL kept them out.
    const read: number[] = []
    const watched: MemoryDb = {
      run: (sql, params) => db.run(sql, params),
      get: (sql, schema, params) => db.get(sql, schema, params),
      all: (sql, schema, params) => {
        const rows = db.all(sql, schema, params)
        if (sql.includes('cur.head, cur.body')) read.push(rows.length)
        return rows
      },
      transaction: (work) => db.transaction(work),
      close: () => db.close()
    }
    const seen = createMemoryStore({
      db: watched,
      now: () => clock,
      newId: () => `m${++ids}`,
      report: () => undefined,
      log: () => undefined
    })
    const a = add(specific('API port', '9281'), { folder: '/work/app' })
    add(specific('port of the api', '9281'), { folder: '/work/app' })
    add(specific('web port', '9281'), { folder: '/work/web' })
    add(specific('no folder port', '9281'))
    add(specific('elsewhere', '9281'), { workspaceId: 'w2', folder: '/work/app' })
    expect(seen.twinsOf(a.id, 5).twins.map((t) => t.key)).toEqual(['port of the api'])
    expect(read).toEqual([2])
  })
})
