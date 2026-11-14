// The memory store's recall reads (phase 3 addendum §6): the items a prompt's terms name, the
// folders that hold saved keys, and the keys of a folder. Real `:memory:` db.
import { beforeEach, describe, expect, it } from 'vitest'
import type { EpisodeText, MemoryItem, MemoryText } from '../../shared/schemas/memory'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryScope, type MemoryStore } from './memoryStore'
import { recallTerms } from './recallTerms'

const NOW = 1_762_800_000_000
const scope: MemoryScope = { workspaceId: 'w1', includeGlobal: true }

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

type Extra = { folder?: string | null; workspaceId?: string | null }

/** Each add is one second after the last, so `updatedAt` orders them. */
function add(text: MemoryText | EpisodeText, extra: Extra = {}): MemoryItem {
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

function addEpisode(title: string, body: string): MemoryItem {
  return add({ kind: 'episode', title, body, endedAt: clock })
}

const port = (): MemoryItem => add(specific('staging port', '9281'))
const notes = (): MemoryItem => add(fact('deploy notes', 'the staging deploy uses blue green'))

describe('recall', () => {
  it('two plain terms qualify an item, one does not', () => {
    const a = port()
    notes()
    expect(store.recall(scope, recallTerms('which staging port?'), [], 3).map((i) => i.id)).toEqual(
      [a.id]
    )
  })

  it('one exact term qualifies an item', () => {
    const a = port()
    expect(store.recall(scope, recallTerms('is it 9281'), [], 3).map((i) => i.id)).toEqual([a.id])
  })

  it('never returns a pinned, stale, excluded, out-of-scope item or an episode; returns a global one', () => {
    const pinned = port()
    store.setPinned(pinned.id, true)
    const stale = port()
    store.setState(stale.id, 'stale', 'operator', null)
    add(specific('staging port', '9281'), { workspaceId: 'w2' })
    const excluded = port()
    addEpisode('staging port 9281', 'moved the staging port to 9281')
    const global = add(specific('staging port', '9281'), { workspaceId: null })
    expect(
      store.recall(scope, recallTerms('staging port 9281'), [excluded.id], 3).map((i) => i.id)
    ).toEqual([global.id])
  })

  it('orders by exact matches, then terms matched, then newest, and stops at the limit', () => {
    const one = add(specific('staging host', 'app.acme.test')) // 1 exact + staging
    const two = add(specific('staging port', '9281')) // 1 exact + staging + port
    const plain = add(fact('staging port notes', 'ask the team')) // staging + port, no exact
    const terms = recallTerms('staging port 9281 app.acme.test')
    expect(store.recall(scope, terms, [], 3).map((i) => i.id)).toEqual([two.id, one.id, plain.id])
    expect(store.recall(scope, terms, [], 2).map((i) => i.id)).toEqual([two.id, one.id])
  })

  it('a term given twice counts once', () => {
    port()
    const twice = [
      { term: 'staging', exact: false },
      { term: 'staging', exact: false }
    ]
    expect(store.recall(scope, twice, [], 3)).toEqual([])
  })

  it('between equal matches the newest comes first', () => {
    const old = port()
    const newer = port()
    expect(store.recall(scope, recallTerms('staging port'), [], 3).map((i) => i.id)).toEqual([
      newer.id,
      old.id
    ])
  })

  it('more terms matched rank before newest when exact matches are equal', () => {
    const older = add(specific('staging port', '9281')) // 1 exact + staging
    const newer = add(specific('other key', '9281')) // 1 exact
    expect(store.recall(scope, recallTerms('staging 9281'), [], 3).map((i) => i.id)).toEqual([
      older.id,
      newer.id
    ])
  })

  it('between equal matches and the same change time the lower id comes first', () => {
    const first = port()
    clock -= 1000
    const second = port()
    expect(store.recall(scope, recallTerms('staging port'), [], 3).map((i) => i.id)).toEqual([
      first.id,
      second.id
    ])
  })

  it('an item that matches two common terms is found when it is the newest', () => {
    for (let i = 0; i < 250; i++) add(fact(`staging note ${i}`, 'x'))
    for (let i = 0; i < 250; i++) add(fact(`port note ${i}`, 'x'))
    const a = add(specific('staging port', 'blue'))
    expect(store.recall(scope, recallTerms('staging port'), [], 3).map((i) => i.id)).toEqual([a.id])
  })

  it('a term brings its 200 newest rows: an item behind 200 newer ones loses that term', () => {
    const a = add(specific('staging port', 'blue'))
    for (let i = 0; i < 199; i++) add(fact(`staging note ${i}`, 'x'))
    expect(store.recall(scope, recallTerms('staging port'), [], 3).map((i) => i.id)).toEqual([a.id])
    add(fact('staging note last', 'x'))
    expect(store.recall(scope, recallTerms('staging port'), [], 3)).toEqual([])
  })

  it('a prompt of operator characters returns the item its plain terms match', () => {
    const a = add(specific('deploy near', 'b:c'))
    expect(
      store.recall(scope, recallTerms('"a*" (b:c) -deploy NEAR "x" OR ^y'), [], 3).map((i) => i.id)
    ).toEqual([a.id])
  })
})

describe('folders', () => {
  it('foldersWithSpecifics lists folders that still hold an unlisted specific, newest first', () => {
    const a = add(specific('k1', 'v'), { folder: '/work/app' })
    add(specific('k2', 'v'), { folder: '/work/other' })
    add(fact('t', 'b'), { folder: '/work/facts-only' })
    expect(store.foldersWithSpecifics(scope, [], 200)).toEqual(['/work/other', '/work/app'])
    expect(store.foldersWithSpecifics(scope, [a.id], 200)).toEqual(['/work/other'])
  })

  it('foldersWithSpecifics leaves out a folder whose only specific is stale or out of scope', () => {
    const stale = add(specific('k1', 'v'), { folder: '/work/stale' })
    store.setState(stale.id, 'stale', 'operator', null)
    add(specific('k2', 'v'), { folder: '/work/w2', workspaceId: 'w2' })
    const global = add(specific('k3', 'v'), { folder: '/work/global', workspaceId: null })
    expect(store.foldersWithSpecifics(scope, [], 200)).toEqual([global.meta.folder])
  })

  it('foldersWithSpecifics skips a specific with no folder', () => {
    add(specific('k1', 'v'))
    add(specific('k2', 'v'), { folder: '/work/app' })
    expect(store.foldersWithSpecifics(scope, [], 200)).toEqual(['/work/app'])
  })

  it('foldersWithSpecifics counts a pinned specific on purpose: the index may have cut it', () => {
    const a = add(specific('k1', 'v'), { folder: '/work/app' })
    store.setPinned(a.id, true)
    expect(store.foldersWithSpecifics(scope, [], 200)).toEqual(['/work/app'])
  })

  it('foldersWithSpecifics stops at the limit', () => {
    add(specific('k1', 'v'), { folder: '/work/a' })
    add(specific('k2', 'v'), { folder: '/work/b' })
    expect(store.foldersWithSpecifics(scope, [], 1)).toEqual(['/work/b'])
  })

  it('specificsInFolders leaves out an excluded, stale or out-of-scope specific and a fact', () => {
    const kept = add(specific('k1', 'v'), { folder: '/work/app' })
    const excluded = add(specific('k2', 'v'), { folder: '/work/app' })
    const stale = add(specific('k3', 'v'), { folder: '/work/app' })
    store.setState(stale.id, 'stale', 'operator', null)
    add(specific('k4', 'v'), { folder: '/work/app', workspaceId: 'w2' })
    add(fact('t', 'b'), { folder: '/work/app' })
    expect(store.specificsInFolders(scope, ['/work/app'], [excluded.id], 10)).toEqual({
      rows: [expect.objectContaining({ id: kept.id })],
      more: 0
    })
  })

  it('specificsInFolders lists newest first', () => {
    const old = add(specific('k1', 'v'), { folder: '/work/app' })
    const newer = add(specific('k2', 'v'), { folder: '/work/b' })
    expect(
      store.specificsInFolders(scope, ['/work/app', '/work/b'], [], 10).rows.map((r) => r.id)
    ).toEqual([newer.id, old.id])
  })

  it('specificsInFolders of no folder is empty', () => {
    add(specific('k1', 'v'), { folder: '/work/app' })
    expect(store.specificsInFolders(scope, [], [], 10)).toEqual({ rows: [], more: 0 })
  })

  it('specificsInFolders compares folders exactly', () => {
    const a = add(specific('k1', 'v'), { folder: '/work/app' })
    add(specific('k2', 'v'), { folder: '/work/app-old' })
    add(specific('k3', 'v'), { folder: '/work/a_p' })
    add(specific('k4', 'v'), { folder: '/work/app/sub' })
    expect(store.specificsInFolders(scope, ['/work/app'], [], 10).rows.map((r) => r.id)).toEqual([
      a.id
    ])
    expect(
      store.specificsInFolders(scope, ['/work/a%p', '/work/a_p'], [], 10).rows.map((r) => r.head)
    ).toEqual(['k3'])
  })

  it('specificsInFolders counts what the limit left out', () => {
    for (let i = 0; i < 4; i++) add(specific(`k${i}`, 'v'), { folder: '/work/app' })
    expect(store.specificsInFolders(scope, ['/work/app'], [], 3)).toMatchObject({ more: 1 })
  })
})
