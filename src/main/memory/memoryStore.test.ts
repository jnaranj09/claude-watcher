// The memory store's write side (spec 2026-11-11 memory §2): every change keeps a version, a
// missing id is a refusal code, and a SQLite failure rolls back and reports. Real `:memory:` db.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { MEMORY_ERROR, type MemoryText } from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { StorageReporter } from '../persistence/persistedBlob'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryAdd, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
const SECRET = 'secret-9281'

let db: MemoryDb
let clock: number
let ids: number
let lines: string[]
let report: Mock<StorageReporter>
let store: MemoryStore

function openDb(): MemoryDb {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  return open.db
}

function makeStore(on: MemoryDb): MemoryStore {
  return createMemoryStore({
    db: on,
    now: () => clock,
    newId: () => `m${++ids}`,
    report,
    log: (line) => {
      lines.push(line)
    }
  })
}

beforeEach(() => {
  db = openDb()
  clock = NOW
  ids = 0
  lines = []
  report = vi.fn<StorageReporter>()
  store = makeStore(db)
})

function input(text: MemoryText, over: Partial<MemoryAdd> = {}): MemoryAdd {
  return {
    text,
    workspaceId: 'w1',
    check: null,
    basis: 'stated',
    origin: { by: 'operator', sessionId: 's1' },
    meta: {
      folder: '/work/app',
      sessionName: 'build',
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: []
    },
    ...over
  }
}

const PORT: MemoryText = { kind: 'specific', key: 'API port', value: '9280' }

/** A db whose writes throw once `armed` holds, with database text in the message. */
function failingDb(armed: { on: boolean }): MemoryDb {
  return {
    ...db,
    run: (sql, params) => {
      if (armed.on && sql.includes('item_trigram')) throw new Error(`disk I/O error ${SECRET}`)
      db.run(sql, params)
    }
  }
}

/** A db whose reads throw, with database text in the message. */
function unreadableDb(): MemoryDb {
  const fail = (): never => {
    throw new Error(`database disk image is malformed ${SECRET}`)
  }
  return { ...db, all: fail, get: fail }
}

describe('add and get', () => {
  it('add returns the item it saved, with its first version', () => {
    const item = store.add(input(PORT))
    expect(item).toMatchObject({
      id: 'm1',
      kind: 'specific',
      key: 'API port',
      value: '9280',
      workspaceId: 'w1',
      state: 'active',
      pinned: false,
      basis: 'stated',
      createdAt: NOW,
      updatedAt: NOW,
      lastSeenAt: NOW,
      origin: { by: 'operator', sessionId: 's1' },
      originDeletedAt: null,
      meta: { folder: '/work/app', sessionName: 'build' }
    })
    expect(store.get('m1')).toEqual(item)
  })

  it('a fact keeps its title and body', () => {
    const item = store.add(input({ kind: 'fact', title: 'Deploys', body: 'line one\nline two' }))
    expect(store.get(item.id)).toMatchObject({
      kind: 'fact',
      title: 'Deploys',
      body: 'line one\nline two'
    })
  })

  it('get of an unknown id is null', () => {
    expect(store.get('nope')).toBeNull()
  })
})

describe('versions', () => {
  it('an edit keeps the old value in history with its reason', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    store.edit(
      id,
      { text: { kind: 'specific', key: 'API port', value: '9281' }, check: null },
      'agent',
      'another tool uses 9280'
    )
    expect(store.versions(id).map((v) => v.body)).toEqual(['9281', '9280'])
    expect(store.versions(id)[0]).toMatchObject({
      at: NOW + 1000,
      by: 'agent',
      reason: 'another tool uses 9280'
    })
  })

  it('an edit changes the current text, the check and the update date', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    const item = store.edit(
      id,
      { text: { kind: 'specific', key: 'API port', value: '9281' }, check: 'ss -ltn' },
      'agent',
      null
    )
    expect(item).toMatchObject({
      value: '9281',
      check: 'ss -ltn',
      updatedAt: NOW + 1000,
      createdAt: NOW
    })
  })

  it('an edit with the other kind is refused as not found', () => {
    const { id } = store.add(input(PORT))
    expect(() =>
      store.edit(id, { text: { kind: 'fact', title: 't', body: 'b' }, check: null }, 'agent', null)
    ).toThrow(MEMORY_ERROR.notFound)
    expect(store.versions(id)).toHaveLength(1)
  })

  it('an edit of an unknown id is refused as not found', () => {
    expect(() => store.edit('nope', { text: PORT, check: null }, 'agent', null)).toThrow(
      MEMORY_ERROR.notFound
    )
  })

  it('setState appends a version with its reason', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    expect(store.setState(id, 'stale', 'agent', 'port moved').state).toBe('stale')
    expect(store.versions(id).map((v) => [v.by, v.reason, v.body])).toEqual([
      ['agent', 'port moved', '9280'],
      ['operator', null, '9280']
    ])
  })

  it('setState to the state the item has appends nothing and keeps its date', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    expect(store.setState(id, 'active', 'agent', 'still right')).toMatchObject({
      state: 'active',
      updatedAt: NOW
    })
    expect(store.versions(id)).toHaveLength(1)
  })

  it('setPinned changes the pin without a version', () => {
    const { id } = store.add(input(PORT))
    expect(store.setPinned(id, true).pinned).toBe(true)
    expect(store.versions(id)).toHaveLength(1)
  })

  it('restore appends the old text as the newest version', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    store.edit(
      id,
      { text: { kind: 'specific', key: 'API port', value: '9281' }, check: null },
      'operator',
      null
    )
    clock += 1000
    expect(store.restore(id, NOW)).toMatchObject({ value: '9280', updatedAt: NOW + 2000 })
    expect(store.versions(id).map((v) => v.body)).toEqual(['9280', '9281', '9280'])
  })

  it('restore of a missing version is refused', () => {
    const { id } = store.add(input(PORT))
    expect(() => store.restore(id, NOW + 5)).toThrow(MEMORY_ERROR.versionNotFound)
  })

  it.each<[string, (s: MemoryStore) => unknown]>([
    ['setState', (s) => s.setState('nope', 'stale', 'agent', null)],
    ['setPinned', (s) => s.setPinned('nope', true)],
    ['restore', (s) => s.restore('nope', NOW)],
    ['remove', (s) => s.remove('nope')],
    ['versions', (s) => s.versions('nope')]
  ])('%s on an unknown id is refused as not found', (_name, call) => {
    expect(() => call(store)).toThrow(MEMORY_ERROR.notFound)
  })
})

describe('basis follows the writer of the current text', () => {
  const NEW_PORT: MemoryText = { kind: 'specific', key: 'API port', value: '9281' }

  it('an agent edit of a stated item makes it inferred', () => {
    const { id } = store.add(input(PORT))
    expect(store.edit(id, { text: NEW_PORT, check: null }, 'agent', null).basis).toBe('inferred')
    expect(store.get(id)?.basis).toBe('inferred')
  })

  it('an operator edit of an inferred item makes it stated', () => {
    const { id } = store.add(input(PORT, { basis: 'inferred' }))
    expect(store.edit(id, { text: NEW_PORT, check: null }, 'operator', null).basis).toBe('stated')
  })

  it('an extract edit makes the item inferred', () => {
    const { id } = store.add(input(PORT))
    expect(store.edit(id, { text: NEW_PORT, check: null }, 'extract', null).basis).toBe('inferred')
  })

  it('each version keeps the basis of its own text', () => {
    const { id } = store.add(input(PORT))
    clock += 1000
    store.edit(id, { text: NEW_PORT, check: null }, 'agent', null)
    expect(store.versions(id).map((v) => [v.body, v.basis])).toEqual([
      ['9281', 'inferred'],
      ['9280', 'stated']
    ])
  })

  it('restore brings back the basis of the restored version with its text', () => {
    const { id } = store.add(input(PORT, { basis: 'inferred' }))
    clock += 1000
    store.edit(id, { text: NEW_PORT, check: null }, 'operator', null)
    clock += 1000
    expect(store.restore(id, NOW).basis).toBe('inferred')
    expect(store.versions(id)[0]).toMatchObject({ body: '9280', basis: 'inferred' })
  })

  it('setState and setPinned keep the basis', () => {
    const { id } = store.add(input(PORT, { basis: 'inferred' }))
    expect(store.setState(id, 'stale', 'operator', null).basis).toBe('inferred')
    expect(store.setPinned(id, true).basis).toBe('inferred')
    expect(store.versions(id)[0]).toMatchObject({ basis: 'inferred' })
  })
})

describe('remove and cascades', () => {
  it('remove deletes the item and its history', () => {
    const { id } = store.add(input(PORT))
    store.remove(id)
    expect(store.get(id)).toBeNull()
    expect(() => store.versions(id)).toThrow(MEMORY_ERROR.notFound)
  })

  it('deleting a workspace removes its items and keeps global ones', () => {
    store.add(input(PORT))
    store.add(input(PORT))
    const global = store.add(input(PORT, { workspaceId: null }))
    const other = store.add(input(PORT, { workspaceId: 'w2' }))
    expect(store.removeByWorkspace('w1')).toBe(2)
    expect([
      store.get('m1'),
      store.get('m2'),
      store.get(global.id)?.id,
      store.get(other.id)?.id
    ]).toEqual([null, null, global.id, other.id])
  })

  it('counts the items a session saved and removes them with their history, others kept', () => {
    const { id } = store.add(input(PORT))
    store.add(input(PORT, { workspaceId: null }))
    const other = store.add(input(PORT, { origin: { by: 'agent', sessionId: 's2' } }))
    const byHand = store.add(input(PORT, { origin: { by: 'operator', sessionId: null } }))
    expect(store.countBySession('s1')).toBe(2)
    expect(store.removeBySession('s1')).toBe(2)
    expect(store.countBySession('s1')).toBe(0)
    expect(store.get(id)).toBeNull()
    expect(() => store.versions(id)).toThrow(MEMORY_ERROR.notFound)
    expect([store.get(other.id)?.id, store.get(byHand.id)?.id]).toEqual([other.id, byHand.id])
  })

  it('a removed session no longer matches a search for its items', () => {
    store.add(input(PORT))
    store.removeBySession('s1')
    const found = store.search(
      { workspaceId: 'w1', includeGlobal: true },
      { kind: 'specific', query: 'API port', filters: {}, offset: 0, limit: 10 },
      { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }
    )
    expect(found).toEqual({ rows: [], total: 0 })
  })

  it('marks every item of a deleted session and keeps it', () => {
    const { id } = store.add(input(PORT))
    store.add(input(PORT))
    store.add(input(PORT, { origin: { by: 'agent', sessionId: 's2' } }))
    clock += 1000
    expect(store.markSessionDeleted('s1')).toBe(2)
    expect(store.get(id)?.originDeletedAt).toBe(NOW + 1000)
    expect(store.get('m3')?.originDeletedAt).toBeNull()
  })

  it('a session deleted again keeps its first date', () => {
    const { id } = store.add(input(PORT))
    store.markSessionDeleted('s1')
    clock += 1000
    expect(store.markSessionDeleted('s1')).toBe(0)
    expect(store.get(id)?.originDeletedAt).toBe(NOW)
  })

  it('rebindSession moves the items of the old session id to the new one', () => {
    const { id } = store.add(input(PORT))
    store.rebindSession('s1', 's9')
    expect(store.get(id)?.origin.sessionId).toBe('s9')
  })
})

describe('onChange', () => {
  it('fires once after every committed write', () => {
    const listener = vi.fn()
    store.onChange(listener)
    const { id } = store.add(input(PORT))
    store.edit(id, { text: PORT, check: null }, 'agent', null)
    store.setState(id, 'stale', 'agent', null)
    store.setPinned(id, true)
    store.restore(id, NOW)
    store.markSessionDeleted('s1')
    store.rebindSession('s1', 's2')
    store.remove(id)
    store.add(input(PORT))
    store.removeByWorkspace('w1')
    expect(listener).toHaveBeenCalledTimes(10)
  })

  it('removeBySession fires once, and countBySession never does', () => {
    store.add(input(PORT))
    store.add(input(PORT))
    const listener = vi.fn()
    store.onChange(listener)
    store.countBySession('s1')
    expect(listener).not.toHaveBeenCalled()
    store.removeBySession('s1')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it.each<[string, (s: MemoryStore) => unknown]>([
    ['rebindSession', (s) => s.rebindSession('nobody', 's2')],
    ['removeByWorkspace', (s) => s.removeByWorkspace('w-none')],
    ['markSessionDeleted', (s) => s.markSessionDeleted('nobody')],
    ['removeBySession', (s) => s.removeBySession('nobody')],
    ['setState to the same state', (s) => s.setState('m1', 'active', 'agent', null)]
  ])('%s that changed no row does not fire', (_name, call) => {
    store.add(input(PORT))
    const listener = vi.fn()
    store.onChange(listener)
    call(store)
    expect(listener).not.toHaveBeenCalled()
  })

  it('a refused write does not fire', () => {
    const listener = vi.fn()
    store.onChange(listener)
    expect(() => store.remove('nope')).toThrow(MEMORY_ERROR.notFound)
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops after unsubscribe', () => {
    const listener = vi.fn()
    store.onChange(listener)()
    store.add(input(PORT))
    expect(listener).not.toHaveBeenCalled()
  })

  it('a listener that throws is logged by code and the write stands', () => {
    store.onChange(() => {
      throw new Error(SECRET)
    })
    const { id } = store.add(input(PORT))
    expect(store.get(id)).not.toBeNull()
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_listener_failed'])
  })
})

describe('SQLite failures', () => {
  it('a failed write rolls back, reports write_failed and throws STORE_WRITE_FAILED', () => {
    const armed = { on: true }
    const failing = makeStore(failingDb(armed))
    const listener = vi.fn()
    failing.onChange(listener)
    expect(() => failing.add(input(PORT))).toThrow(STORE_WRITE_FAILED)
    expect(store.get('m1')).toBeNull()
    expect(report).toHaveBeenCalledWith('write_failed')
    expect(listener).not.toHaveBeenCalled()
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_write_failed'])
  })

  it('a failed edit keeps the old text and its history', () => {
    const armed = { on: false }
    const failing = makeStore(failingDb(armed))
    const { id } = failing.add(input(PORT))
    armed.on = true
    expect(() =>
      failing.edit(
        id,
        { text: { kind: 'specific', key: 'API port', value: '9281' }, check: null },
        'agent',
        null
      )
    ).toThrow(STORE_WRITE_FAILED)
    expect(store.versions(id).map((v) => v.body)).toEqual(['9280'])
  })

  it('a refusal is not reported as a failed write', () => {
    expect(() => store.remove('nope')).toThrow(MEMORY_ERROR.notFound)
    expect(report).not.toHaveBeenCalled()
  })

  it.each<[string, (s: MemoryStore) => unknown]>([
    ['get', (s) => s.get('m1')],
    ['versions', (s) => s.versions('m1')],
    ['browse', (s) => s.browse({ workspaceId: 'w1', includeGlobal: true }, 'kind')],
    ['indexRows', (s) => s.indexRows('w1', '/work/app')],
    [
      'search',
      (s) =>
        s.search(
          { workspaceId: 'w1', includeGlobal: true },
          { kind: null, query: '9280', filters: {}, offset: 0, limit: 20 },
          { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }
        )
    ]
  ])(
    'a failed %s throws readFailed, logs a code with no database text and reports nothing',
    (_name, call) => {
      store.add(input(PORT))
      expect(() => call(makeStore(unreadableDb()))).toThrow(MEMORY_ERROR.readFailed)
      // Storage health's read_failed says the file did not open; this one did.
      expect(report).not.toHaveBeenCalled()
      expect(lines).toEqual(['[claude-watcher][memory] code=memory_read_failed'])
    }
  )

  it('a row that fails its schema is a failed read, not a missing item', () => {
    store.add(input(PORT))
    db.run(`UPDATE item SET meta = '{"sessionName":5}' WHERE id = 'm1'`)
    expect(() => store.get('m1')).toThrow(MEMORY_ERROR.readFailed)
  })

  it('a read that fails inside a write is a failed write, rolled back', () => {
    const { id } = store.add(input(PORT))
    // setPinned reads, updates, then reads again: the second read fails after the update ran.
    let reads = 0
    const failing = makeStore({
      ...db,
      get: (sql, schema, params) => {
        reads += 1
        if (reads > 1) throw new Error(`database disk image is malformed ${SECRET}`)
        return db.get(sql, schema, params)
      }
    })
    const listener = vi.fn()
    failing.onChange(listener)
    expect(() => failing.setPinned(id, true)).toThrow(STORE_WRITE_FAILED)
    expect([store.get(id)?.pinned, listener.mock.calls.length]).toEqual([false, 0])
    expect(report).toHaveBeenCalledWith('write_failed')
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_write_failed'])
  })

  it('a readFailed code thrown inside a write is still a failed write', () => {
    const throwsReadFailed: MemoryDb = {
      ...db,
      get: () => {
        throw new Error(MEMORY_ERROR.readFailed)
      }
    }
    store.add(input(PORT))
    expect(() => makeStore(throwsReadFailed).setPinned('m1', true)).toThrow(STORE_WRITE_FAILED)
    expect(report).toHaveBeenCalledWith('write_failed')
  })
})
