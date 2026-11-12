// The memory IPC handler bodies (spec 2026-11-11 memory): each parses its `.strict()` request once,
// stamps the operator as the writer, and lets the store's codes through unchanged. Real `:memory:`
// db; the operator's dialog opens any item it listed, so no handler checks a scope.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_ERROR, type MemoryText } from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { createMemoryIpcHandlers, MEMORY_UNAVAILABLE, type MemoryIpcHandlers } from './memoryIpc'
import type { MemoryNames } from './memoryNames'
import { createMemoryStore, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
const PORT: MemoryText = { kind: 'specific', key: 'API port', value: '9280' }
const NOTE: MemoryText = { kind: 'fact', title: 'Deploys', body: 'Tag first, then deploy.' }

let db: MemoryDb
let store: MemoryStore
let activity: MemoryActivityLog
let names: MemoryNames
let h: MemoryIpcHandlers

function openDb(): MemoryDb {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  return open.db
}

beforeEach(() => {
  db = openDb()
  let ids = 0
  // Each write a millisecond later, so two versions never share an `at`.
  let clock = NOW
  store = createMemoryStore({
    db,
    now: () => ++clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
  activity = createMemoryActivity()
  names = {
    tagIdsByName: vi.fn((_w: string, name: string) => (name === 'infra' ? ['t1'] : [])),
    goalIdsByName: vi.fn((): string[] => [])
  }
  h = createMemoryIpcHandlers({ store: () => store, names, activity })
})

const LIST = {
  workspaceId: 'w1',
  includeGlobal: true,
  kind: 'specific',
  query: null,
  filters: {},
  offset: 0,
  limit: 50
} as const

function create(text: MemoryText = PORT, workspaceId: string | null = 'w1'): string {
  return h.create({ workspaceId, text, check: null }).id
}

describe('create', () => {
  it('stamps the operator as the writer, basis stated, with empty meta', () => {
    const item = h.create({ workspaceId: 'w1', text: PORT, check: 'curl :9280' })
    expect(item).toMatchObject({
      kind: 'specific',
      key: 'API port',
      workspaceId: 'w1',
      basis: 'stated',
      check: 'curl :9280',
      origin: { by: 'operator', sessionId: null },
      meta: {
        folder: null,
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      }
    })
  })

  it('refuses an extra key (a basis or an origin never comes from the renderer)', () => {
    expect(() =>
      h.create({ workspaceId: 'w1', text: PORT, check: null, basis: 'observed' })
    ).toThrow()
  })
})

describe('list', () => {
  it('passes scope, kind, query, filters and the page to the search', () => {
    const search = vi.spyOn(store, 'search')
    create()
    create(NOTE)
    create({ kind: 'specific', key: 'Elsewhere', value: '1' }, 'w2')
    const out = h.list({
      ...LIST,
      query: 'port',
      filters: { tags: ['infra'] },
      offset: 0,
      limit: 10
    })
    const [scope, input, ctx] = search.mock.calls[0] ?? []
    expect(scope).toEqual({ workspaceId: 'w1', includeGlobal: true })
    expect(input).toEqual({
      kind: 'specific',
      query: 'port',
      filters: { tags: ['infra'] },
      offset: 0,
      limit: 10
    })
    expect(ctx?.sessionFolder).toBeNull()
    expect(ctx?.tagIdsByName('infra')).toEqual(['t1'])
    expect(names.tagIdsByName).toHaveBeenCalledWith('w1', 'infra')
    ctx?.goalIdsByName('Ship')
    expect(names.goalIdsByName).toHaveBeenCalledWith('w1', 'Ship')
    // The item has no tag, so the tag filter narrows it out.
    expect(out).toEqual({ rows: [], total: 0 })
  })

  it('answers the rows of the asked kind in the asked workspace', () => {
    const id = create()
    create(NOTE)
    create({ kind: 'specific', key: 'Elsewhere', value: '1' }, 'w2')
    const out = h.list(LIST)
    expect(out.total).toBe(1)
    expect(out.rows.map((r) => r.id)).toEqual([id])
  })

  it('refuses an extra key, a limit over 100 and a negative offset', () => {
    expect(() => h.list({ ...LIST, folder: '/x' })).toThrow()
    expect(() => h.list({ ...LIST, limit: 101 })).toThrow()
    expect(() => h.list({ ...LIST, limit: -1 })).toThrow()
    expect(() => h.list({ ...LIST, offset: -1 })).toThrow()
  })
})

describe('get', () => {
  it('answers the item and its versions, newest first', () => {
    const id = create()
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null })
    const out = h.get({ id })
    expect(out.item).toMatchObject({ id, value: '9281' })
    expect(out.versions.map((v) => v.body)).toEqual(['9281', '9280'])
  })

  it('throws memory_not_found for an unknown id', () => {
    expect(() => h.get({ id: 'nope' })).toThrow(MEMORY_ERROR.notFound)
  })

  it('refuses an extra key', () => {
    expect(() => h.get({ id: create(), extra: 1 })).toThrow()
  })
})

describe('edit', () => {
  it('appends a version written by the operator with no reason', () => {
    const id = create()
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null })
    const [newest] = store.versions(id)
    expect(newest).toMatchObject({ by: 'operator', reason: null, body: '9281' })
  })

  it('refuses an extra key', () => {
    expect(() =>
      h.edit({ id: create(), text: PORT, check: null, reason: 'operator prose' })
    ).toThrow()
  })
})

describe('setState, setPinned, restore', () => {
  it('marks stale as the operator and pins', () => {
    const id = create()
    const edit = vi.spyOn(store, 'setState')
    expect(h.setState({ id, state: 'stale' }).state).toBe('stale')
    expect(edit).toHaveBeenCalledWith(id, 'stale', 'operator', null)
    expect(h.setPinned({ id, pinned: true }).pinned).toBe(true)
  })

  it('restores an older version as a new one', () => {
    const id = create()
    const [first] = store.versions(id)
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null })
    expect(h.restore({ id, versionAt: first?.at ?? 0 })).toMatchObject({ value: '9280' })
  })

  it('each refuses an extra key', () => {
    const id = create()
    expect(() => h.setState({ id, state: 'stale', by: 'agent' })).toThrow()
    expect(() => h.setPinned({ id, pinned: true, extra: 1 })).toThrow()
    expect(() => h.restore({ id, versionAt: NOW, extra: 1 })).toThrow()
  })

  it('each throws memory_not_found for an unknown id, unchanged', () => {
    const id = 'nope'
    expect(() => h.setState({ id, state: 'stale' })).toThrow(MEMORY_ERROR.notFound)
    expect(() => h.setPinned({ id, pinned: true })).toThrow(MEMORY_ERROR.notFound)
    expect(() => h.restore({ id, versionAt: NOW })).toThrow(MEMORY_ERROR.notFound)
  })

  it('restore throws memory_version_not_found for a time no version has, unchanged', () => {
    const id = create()
    expect(() => h.restore({ id, versionAt: 1 })).toThrow(MEMORY_ERROR.versionNotFound)
  })
})

describe('remove', () => {
  it('deletes the item', () => {
    const id = create()
    h.remove({ id })
    expect(store.get(id)).toBeNull()
  })

  it('throws memory_not_found for an unknown id', () => {
    expect(() => h.remove({ id: 'nope' })).toThrow(MEMORY_ERROR.notFound)
  })

  it('refuses an extra key and deletes nothing', () => {
    const id = create()
    expect(() => h.remove({ id, extra: 1 })).toThrow()
    expect(store.get(id)).not.toBeNull()
  })
})

describe('activity', () => {
  it("answers the session's activity record", () => {
    activity.injected('s1', { chars: 40, itemIds: ['m1'] })
    expect(h.activity({ sessionId: 's1' })).toEqual({
      injected: { tokens: 10, itemIds: ['m1'] },
      entries: []
    })
  })

  it('answers an empty record for a session with nothing recorded', () => {
    expect(h.activity({ sessionId: 's9' })).toEqual({ injected: null, entries: [] })
  })

  it('refuses an extra key', () => {
    expect(() => h.activity({ sessionId: 's1', extra: 1 })).toThrow()
  })
})

describe('while memory is off (no store)', () => {
  it('every handler but activity throws memory_unavailable', () => {
    const off = createMemoryIpcHandlers({ store: () => null, names, activity })
    const id = { id: 'm1' }
    const calls: (() => unknown)[] = [
      () => off.list(LIST),
      () => off.get(id),
      () => off.create({ workspaceId: 'w1', text: PORT, check: null }),
      () => off.edit({ ...id, text: PORT, check: null }),
      () => off.setState({ ...id, state: 'stale' }),
      () => off.setPinned({ ...id, pinned: true }),
      () => off.remove(id),
      () => off.restore({ ...id, versionAt: NOW })
    ]
    for (const call of calls) expect(call).toThrow(MEMORY_UNAVAILABLE)
  })

  it('activity still answers from the in-memory record, and still parses its argument', () => {
    const off = createMemoryIpcHandlers({ store: () => null, names, activity })
    activity.injected('s1', { chars: 8, itemIds: ['m1'] })
    expect(off.activity({ sessionId: 's1' })).toEqual({
      injected: { tokens: 2, itemIds: ['m1'] },
      entries: []
    })
    expect(off.activity({ sessionId: 's9' })).toEqual({ injected: null, entries: [] })
    expect(() => off.activity({ sessionId: 's1', extra: 1 })).toThrow()
  })
})

describe('a write the disk refuses', () => {
  it('surfaces as store_write_failed, unchanged', () => {
    const id = create()
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('SQLITE_FULL')
    })
    expect(() => h.edit({ id, text: { ...PORT, value: '9281' }, check: null })).toThrow(
      STORE_WRITE_FAILED
    )
    expect(() => h.remove({ id })).toThrow(STORE_WRITE_FAILED)
  })
})
