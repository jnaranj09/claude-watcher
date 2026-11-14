// The session gate the memory tools and the recall routes share: memory on, the store open, the
// session live; the scope is the session's workspace plus global.
import { describe, expect, it } from 'vitest'
import { openMemoryDb } from './memoryDb'
import { createMemoryGate, sessionItemMeta } from './memoryGate'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import type { MemorySessionMeta } from './memoryTools'

const NOW = 1_762_800_000_000

function openStore(): MemoryStore {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  return createMemoryStore({
    db: open.db,
    now: () => NOW,
    newId: () => 'm1',
    report: () => undefined,
    log: () => undefined
  })
}

const SESSION: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/app',
  sessionName: 'build',
  tagIds: ['t1'],
  templateId: 'tpl1',
  goalId: 'g1',
  taskIds: ['k1']
}

const store = openStore()
const gate = (
  over: Partial<Parameters<typeof createMemoryGate>[0]> = {}
): ReturnType<typeof createMemoryGate> =>
  createMemoryGate({
    enabled: () => true,
    store: () => store,
    session: (id) => (id === 's1' ? SESSION : null),
    ...over
  })

describe('createMemoryGate', () => {
  it('answers null while memory is off', () => {
    expect(gate({ enabled: () => false })({ sessionId: 's1' })).toBeNull()
  })

  it('reads the setting on every call, so Memory switched off answers the next request', () => {
    let on = true
    const check = gate({ enabled: () => on })
    const before = check({ sessionId: 's1' })?.sessionId ?? null
    on = false
    const after = check({ sessionId: 's1' })
    expect([before, after]).toEqual(['s1', null])
  })

  it('answers null while the store is missing', () => {
    expect(gate({ store: () => null })({ sessionId: 's1' })).toBeNull()
  })

  it('answers null while the session is not live', () => {
    expect(gate()({ sessionId: 's9' })).toBeNull()
  })

  it("gives the session's workspace plus global as the scope", () => {
    expect(gate()({ sessionId: 's1' })).toEqual({
      store,
      sessionId: 's1',
      session: SESSION,
      scope: { workspaceId: 'w1', includeGlobal: true }
    })
  })
})

describe('sessionItemMeta', () => {
  it('sessionItemMeta turns an empty folder and an empty name into null', () => {
    expect([
      sessionItemMeta({ ...SESSION, folder: '', sessionName: '' }),
      sessionItemMeta(SESSION)
    ]).toEqual([
      {
        folder: null,
        sessionName: null,
        tagIds: ['t1'],
        templateId: 'tpl1',
        goalId: 'g1',
        taskIds: ['k1']
      },
      {
        folder: '/work/app',
        sessionName: 'build',
        tagIds: ['t1'],
        templateId: 'tpl1',
        goalId: 'g1',
        taskIds: ['k1']
      }
    ])
  })
})
