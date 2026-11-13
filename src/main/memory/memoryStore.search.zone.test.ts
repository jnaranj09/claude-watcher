// `since`, `until` and the browse month are LOCAL days (`zone-berlin` project, vitest.config.ts):
// near midnight the UTC day differs there, so a UTC comparison fails these cases.
import { beforeEach, describe, expect, it } from 'vitest'
import type { MemoryFilters } from '../../shared/memory/filterFields'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryScope, type MemoryStore } from './memoryStore'

const scope: MemoryScope = { workspaceId: 'w1', includeGlobal: true }
const ctx = { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }

let at: number
let store: MemoryStore

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => 0, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  store = createMemoryStore({
    db: open.db,
    now: () => at,
    newId: () => 'm1',
    report: () => undefined,
    log: () => undefined
  })
})

function addAt(iso: string): void {
  at = Date.parse(iso)
  store.add({
    text: { kind: 'specific', key: 'port', value: '9281' },
    workspaceId: 'w1',
    check: null,
    basis: 'stated',
    origin: { by: 'operator', sessionId: null },
    meta: {
      folder: null,
      sessionName: null,
      tagIds: [],
      templateId: null,
      goalId: null,
      taskIds: []
    },
    source: null
  })
}

function total(filters: MemoryFilters): number {
  return store.search(scope, { kind: null, query: null, filters, offset: 0, limit: 20 }, ctx).total
}

describe('local days in Europe/Berlin', () => {
  it('runs in Europe/Berlin', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Berlin')
  })

  it('an item updated at 23:30 local on the 10th is on the 10th, not the 11th', () => {
    addAt('2026-11-10T23:30:00+01:00')
    expect([total({ until: '2026-11-10' }), total({ since: '2026-11-11' })]).toEqual([1, 0])
  })

  it('an item updated at 00:30 local on the 11th is on the 11th, though UTC is still the 10th', () => {
    addAt('2026-11-11T00:30:00+01:00')
    expect([total({ since: '2026-11-11' }), total({ until: '2026-11-10' })]).toEqual([1, 0])
  })

  it('the browse month is the local month', () => {
    addAt('2026-11-01T00:30:00+01:00')
    expect(store.browse(scope, 'month')).toEqual([{ key: '2026-11', count: 1 }])
  })
})
