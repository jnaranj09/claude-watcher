// The memory store's extraction side (memory phase 2): episodes, where a value came from, seen
// dates, the scope the model is shown, and one transaction around a whole save. Real `:memory:`
// db; every write is checked by what the table holds right after it.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  MEMORY_ERROR,
  type EpisodeText,
  type MemoryItemKind,
  type MemoryText
} from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { StorageReporter } from '../persistence/persistedBlob'
import { createMemoryCommands } from './memoryCommands'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryAdd, type MemoryStore } from './memoryStore'
import { z } from 'zod'

const NOW = 1_762_800_000_000
const NO_CTX = { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }

let db: MemoryDb
let clock: number
let ids: number
let lines: string[]
let report: Mock<StorageReporter>
let store: MemoryStore

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  clock = NOW
  ids = 0
  lines = []
  report = vi.fn<StorageReporter>()
  store = createMemoryStore({
    db,
    now: () => clock,
    newId: () => `m${++ids}`,
    report,
    log: (line) => {
      lines.push(line)
    }
  })
})

const META: MemoryAdd['meta'] = {
  folder: '/work/app',
  sessionName: 'build',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

const base: Omit<MemoryAdd, 'text'> = {
  workspaceId: 'w1',
  check: null,
  basis: 'inferred',
  origin: { by: 'agent', sessionId: 's1' },
  meta: META,
  source: null
}

function specific(key: string, value: string): MemoryText {
  return { kind: 'specific', key, value }
}

const a: MemoryAdd = { ...base, text: specific('API port', '9280') }
const EPISODE: EpisodeText = {
  kind: 'episode',
  title: 'Moved the API port',
  body: 'Port 9280 was taken.',
  endedAt: 7
}

function search(input: { kind?: MemoryItemKind | null; query?: string | null }): {
  rows: { id: string }[]
  total: number
} {
  return store.search(
    { workspaceId: 'w1', includeGlobal: true },
    {
      kind: input.kind ?? null,
      query: input.query ?? null,
      filters: { includeStale: true },
      offset: 0,
      limit: 100
    },
    NO_CTX
  )
}

const SourceCols = z.object({
  source_path: z.string().nullable(),
  source_entry: z.string().nullable(),
  source_quote: z.string().nullable(),
  ended_at: z.number().nullable()
})

function columnsOf(id: string): z.infer<typeof SourceCols> | null {
  return db.get(
    'SELECT source_path, source_entry, source_quote, ended_at FROM item WHERE id = ?',
    SourceCols,
    [id]
  )
}

const OBSERVED = {
  basis: 'observed' as const,
  source: { path: '/t/a.jsonl', entryId: 'u1', quote: 'listening on 9281' }
}

describe('add with a source and an episode', () => {
  it('an add keeps its source path, entry and quote', () => {
    const { id } = store.add({ ...a, source: OBSERVED.source })
    expect(columnsOf(id)).toEqual({
      source_path: '/t/a.jsonl',
      source_entry: 'u1',
      source_quote: 'listening on 9281',
      ended_at: null
    })
    expect(store.get(id)?.source).toEqual({ entryId: 'u1', quote: 'listening on 9281' })
  })

  it('an episode is added, listed by kind, found by a word of its body, and cannot be pinned', () => {
    const e = store.add({ ...base, text: EPISODE, source: null })
    expect(store.get(e.id)).toMatchObject({
      kind: 'episode',
      title: 'Moved the API port',
      endedAt: 7
    })
    expect(columnsOf(e.id)?.ended_at).toBe(7)
    expect(search({ kind: 'episode', query: 'taken' }).rows.map((r) => r.id)).toEqual([e.id])
    expect(search({ kind: 'specific', query: 'taken' }).rows).toEqual([])
    expect(() => store.setPinned(e.id, true)).toThrow(MEMORY_ERROR.notFound)
    expect(store.get(e.id)?.pinned).toBe(false)
  })
})

describe('edit and evidence', () => {
  it('an extract edit takes its basis and source from the evidence', () => {
    const { id } = store.add(a)
    store.edit(
      id,
      { text: specific('API port', '9281'), check: null, evidence: OBSERVED },
      'extract',
      'seen in session'
    )
    expect(store.get(id)).toMatchObject({
      basis: 'observed',
      source: { entryId: 'u1', quote: 'listening on 9281' }
    })
    expect(columnsOf(id)?.source_path).toBe('/t/a.jsonl')
    expect(store.versions(id)[0]).toMatchObject({ by: 'extract', basis: 'observed' })
  })

  it("an operator edit clears the source and reads 'stated'", () => {
    const { id } = store.add({ ...a, source: OBSERVED.source })
    store.edit(id, { text: specific('API port', '9282'), check: null }, 'operator', null)
    expect(store.get(id)).toMatchObject({ basis: 'stated', source: null, value: '9282' })
    expect(columnsOf(id)).toMatchObject({
      source_path: null,
      source_entry: null,
      source_quote: null
    })
    expect(store.versions(id)[0]).toMatchObject({ by: 'operator', basis: 'stated' })
  })

  it('an extract edit with no evidence is inferred and clears the source', () => {
    const { id } = store.add({ ...a, basis: 'observed', source: OBSERVED.source })
    store.edit(id, { text: specific('API port', '9283'), check: null }, 'extract', null)
    expect(store.get(id)).toMatchObject({ basis: 'inferred', source: null })
  })

  it('an episode edit moves its end time', () => {
    const { id } = store.add({ ...base, text: EPISODE })
    store.edit(
      id,
      { text: { ...EPISODE, body: 'Port 9280 was taken twice.', endedAt: 9 }, check: null },
      'extract',
      null
    )
    expect(store.get(id)).toMatchObject({ body: 'Port 9280 was taken twice.', endedAt: 9 })
  })

  it('touchSeen moves only the last-seen date', () => {
    const { id } = store.add(a)
    const heard = vi.fn()
    store.onChange(heard)
    clock += 5000
    store.touchSeen(id, NOW + 4000)
    expect(store.get(id)).toMatchObject({ lastSeenAt: NOW + 4000, updatedAt: NOW })
    expect(store.versions(id)).toHaveLength(1)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('touchSeen of an unknown id changes nothing and tells no listener', () => {
    const { id } = store.add(a)
    const heard = vi.fn()
    store.onChange(heard)
    store.touchSeen('nope', NOW + 4000)
    expect(store.get(id)?.lastSeenAt).toBe(NOW)
    expect(heard).not.toHaveBeenCalled()
  })

  it('setEvidence changes the basis of the current text without a new version', () => {
    const { id } = store.add(a)
    clock += 1000
    store.edit(id, { text: specific('API port', '9281'), check: null }, 'agent', null)
    clock += 1000
    store.setEvidence(id, OBSERVED)
    expect(store.get(id)).toMatchObject({
      basis: 'observed',
      updatedAt: NOW + 1000,
      source: { entryId: 'u1', quote: 'listening on 9281' }
    })
    expect(columnsOf(id)?.source_path).toBe('/t/a.jsonl')
    expect(store.versions(id).map((v) => [v.body, v.basis])).toEqual([
      ['9281', 'observed'],
      ['9280', 'inferred']
    ])
  })

  it('setEvidence of an unknown id is refused as not found', () => {
    expect(() => store.setEvidence('nope', OBSERVED)).toThrow(MEMORY_ERROR.notFound)
    expect(report).not.toHaveBeenCalled()
  })
})

describe('reads for extraction', () => {
  it('lists the specifics a session saved with the tool that have no source', () => {
    const mine = store.add(a)
    store.add({ ...a, source: OBSERVED.source })
    store.add({ ...base, text: { kind: 'fact', title: 'Deploys', body: 'by hand' } })
    store.add({ ...a, origin: { by: 'agent', sessionId: 's2' } })
    store.add({ ...a, origin: { by: 'extract', sessionId: 's1' } })
    const stale = store.add(a)
    store.setState(stale.id, 'stale', 'agent', null)
    expect(store.agentSpecificsWithoutSource('s1')).toEqual([{ id: mine.id, value: '9280' }])
  })

  it('currentWriter names who wrote the newest version, null for an unknown id', () => {
    const { id } = store.add(a)
    expect(store.currentWriter(id)).toBe('agent')
    clock += 1000
    store.edit(id, { text: specific('API port', '9281'), check: null }, 'operator', null)
    expect(store.currentWriter(id)).toBe('operator')
    expect(store.currentWriter('nope')).toBeNull()
  })

  it('the scope for extraction puts the session own items first and stops at the limit', () => {
    const add = (over: Partial<MemoryAdd>, value: string): string => {
      clock += 1000
      return store.add({ ...a, ...over, text: specific('k', value) }).id
    }
    const own = add({}, 'own')
    const pinned = add({ origin: { by: 'agent', sessionId: 's2' } }, 'pinned')
    store.setPinned(pinned, true)
    const here = add(
      { origin: { by: 'agent', sessionId: 's2' }, meta: { ...META, folder: '/work' } },
      'above'
    )
    const elsewhere = add(
      { origin: { by: 'agent', sessionId: 's2' }, meta: { ...META, folder: '/other' } },
      'newest'
    )
    const global = add(
      {
        workspaceId: null,
        origin: { by: 'agent', sessionId: 's2' },
        meta: { ...META, folder: null }
      },
      'global'
    )
    add({ workspaceId: 'w2' }, 'other workspace')
    const stale = add({}, 'stale')
    store.setState(stale, 'stale', 'agent', null)
    const scope = store.scopeForExtract('w1', '/work/app', 's1', 10)
    expect(scope.map((r) => r.id)).toEqual([own, pinned, here, global, elsewhere])
    expect(scope[0]).toEqual({ id: own, kind: 'specific', head: 'k', body: 'own' })
    expect(store.scopeForExtract('w1', '/work/app', 's1', 2).map((r) => r.id)).toEqual([
      own,
      pinned
    ])
    expect(store.scopeForExtract('w1', null, 's9', 10).map((r) => r.id)).toEqual([
      pinned,
      global,
      elsewhere,
      here,
      own
    ])
  })

  it('indexRows lists the newest 5 episodes of the folder', () => {
    for (let i = 1; i <= 7; i += 1) {
      clock += 1000
      store.add({ ...base, text: { ...EPISODE, title: `e${i}` } })
    }
    clock += 1000
    store.add({ ...base, text: { ...EPISODE, title: 'away' }, meta: { ...META, folder: '/other' } })
    clock += 1000
    store.add({
      ...base,
      text: { ...EPISODE, title: 'below' },
      meta: { ...META, folder: '/work/app/web' }
    })
    store.add(a)
    const out = store.indexRows('w1', '/work/app')
    expect(out.episodesHere.map((r) => r.head)).toEqual(['below', 'e7', 'e6', 'e5', 'e4'])
    expect(out.specificsHere.map((r) => r.head)).toEqual(['API port'])
    // e1..e3 and `away` are the rest.
    expect(out.more).toBe(4)
  })
})

describe('batch', () => {
  it('a batch that throws writes nothing and tells no listener', () => {
    const heard = vi.fn()
    store.onChange(heard)
    expect(() =>
      store.batch(() => {
        store.add(a)
        throw new Error('boom')
      })
    ).toThrow(STORE_WRITE_FAILED)
    expect(search({}).total).toBe(0)
    expect(heard).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('write_failed')
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_write_failed'])
  })

  it('a refusal inside a batch rolls back the whole batch and is not reported', () => {
    const { id } = store.add(a)
    expect(() =>
      store.batch(() => {
        store.add(a)
        store.edit(id, { text: { ...EPISODE }, check: null }, 'extract', null)
      })
    ).toThrow(MEMORY_ERROR.notFound)
    expect(search({}).total).toBe(1)
    expect(report).not.toHaveBeenCalled()
  })

  it('a batch whose commit fails tells no listener', () => {
    // The work runs, then the commit throws: a listener told before the commit would be wrong.
    const failing = createMemoryStore({
      db: {
        ...db,
        transaction: (work) =>
          db.transaction(() => {
            work()
            throw new Error('database is locked')
          })
      },
      now: () => clock,
      newId: () => `m${++ids}`,
      report,
      log: () => undefined
    })
    const heard = vi.fn()
    failing.onChange(heard)
    expect(() => failing.batch(() => failing.add(a))).toThrow(STORE_WRITE_FAILED)
    expect([search({}).total, heard.mock.calls.length]).toEqual([0, 0])
  })

  it('a batch of two writes tells listeners once', () => {
    const heard = vi.fn()
    store.onChange(heard)
    const out = store.batch(() => {
      const first = store.add(a)
      store.touchSeen(first.id, NOW + 1)
      expect(heard).not.toHaveBeenCalled()
      return first.id
    })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(store.get(out)?.lastSeenAt).toBe(NOW + 1)
  })

  it('a batch passes memory_command_not_found through untouched and reports nothing', () => {
    const commands = createMemoryCommands({ db, newId: () => 'c1' })
    expect(() =>
      store.batch(() => {
        store.add(a)
        commands.remove('nope')
      })
    ).toThrow(MEMORY_ERROR.commandNotFound)
    expect(search({}).total).toBe(0)
    expect(report).not.toHaveBeenCalled()
    expect(lines).toEqual([])
  })

  it("removeBySession deletes the session's episode and keeps its command rows", () => {
    const commands = createMemoryCommands({ db, newId: () => 'c1' })
    store.batch(() => {
      store.add({ ...base, text: EPISODE, origin: { by: 'extract', sessionId: 's1' } })
      commands.record({
        workspaceId: 'w1',
        folder: '/work/app',
        text: 'npm test',
        sessionId: 's1',
        at: NOW
      })
    })
    expect(store.removeBySession('s1')).toBe(1)
    expect(search({ kind: 'episode' }).total).toBe(0)
    expect(commands.list('w1', { query: null, folder: null, offset: 0, limit: 10 })).toMatchObject({
      total: 1,
      rows: [{ id: 'c1', text: 'npm test', count: 1 }]
    })
  })
})
