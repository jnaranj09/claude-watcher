// The memory tools take the first 8 characters of an id, as a key line prints it (spec 2026-11-14
// memory context index §2): one match in the session's scope is that item, none is
// `memory_not_found`, two are `memory_id_ambiguous`. Own file: memoryTools.test.ts is at its line
// cap. Real `:memory:` store; the session and name lookups are stand-ins.
import { describe, expect, it } from 'vitest'
import type { McpToolOutcome } from '../mcp/mcpEndpoint'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore } from './memoryStore'
import { createMemoryTools, type MemorySessionMeta } from './memoryTools'

const NOW = 1_762_800_000_000

const meta = (workspaceId: string): MemorySessionMeta => ({
  workspaceId,
  folder: '/work/app',
  sessionName: 'build',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
})

type Seed = { id: string; key: string; workspaceId?: string | null; stale?: true }

/** A store whose items take the ids named, and tools for session `s1` of workspace `w1`. */
function setUp(seeds: readonly Seed[]): {
  call: (name: string, args: unknown) => McpToolOutcome
  activity: MemoryActivityLog
} {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  const ids = seeds.map((s) => s.id)
  const store = createMemoryStore({
    db: open.db,
    now: () => NOW,
    newId: () => ids.shift() ?? 'unexpected',
    report: () => undefined,
    log: () => undefined
  })
  for (const seed of seeds) {
    const item = store.add({
      text: { kind: 'specific', key: seed.key, value: '9281' },
      workspaceId: seed.workspaceId === undefined ? 'w1' : seed.workspaceId,
      check: null,
      basis: 'observed',
      origin: { by: 'extract', sessionId: 's0' },
      meta: {
        folder: '/work/app',
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      source: null
    })
    if (seed.stale === true) store.setState(item.id, 'stale', 'operator', null)
  }
  const activity = createMemoryActivity()
  const tools = createMemoryTools({
    enabled: () => true,
    store: () => store,
    session: (id) => (id === 's1' ? meta('w1') : null),
    names: {
      tagIdsByName: () => [],
      tagName: () => null,
      goalIdsByName: () => [],
      goalName: () => null
    },
    tasks: () => null,
    commands: () => null,
    activity,
    now: () => NOW,
    log: () => undefined
  })
  return { call: (name, args) => tools.call(name, args, { sessionId: 's1' }), activity }
}

function text(out: McpToolOutcome): string {
  if (out.kind !== 'result') throw new Error('expected a result')
  return out.text
}

describe('a short id', () => {
  it('memory_get, memory_update and memory_mark_stale take the first 8 characters', () => {
    const { call, activity } = setUp([{ id: 'abcdefgh-0001', key: 'api port' }])
    expect(text(call('memory_get', { id: 'abcdefgh' }))).toContain('key: api port')
    expect(
      text(
        call('memory_update', {
          id: 'abcdefgh',
          kind: 'specific',
          key: 'api port',
          value: '9300',
          reason: 'moved'
        })
      )
    ).toBe('Updated.')
    expect(text(call('memory_mark_stale', { id: 'abcdefgh', reason: 'gone' }))).toBe(
      'Marked stale.'
    )
    expect(activity.get('s1').entries.map((e) => e.itemId)).toEqual([
      'abcdefgh-0001',
      'abcdefgh-0001',
      'abcdefgh-0001'
    ])
  })

  it('two items with the same start answer memory_id_ambiguous, and neither is read', () => {
    const { call, activity } = setUp([
      { id: 'abcdefgh-0001', key: 'api port' },
      { id: 'abcdefgh-0002', key: 'hook port' }
    ])
    expect(call('memory_get', { id: 'abcdefgh' })).toMatchObject({
      isError: true,
      text: 'memory_id_ambiguous'
    })
    expect(activity.get('s1').entries).toEqual([])
  })

  it('a start that only another workspace holds is memory_not_found', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port', workspaceId: 'w2' }])
    expect(call('memory_get', { id: 'abcdefgh' })).toMatchObject({
      isError: true,
      text: 'memory_not_found'
    })
  })

  it('a start a global item holds reads it', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port', workspaceId: null }])
    expect(text(call('memory_get', { id: 'abcdefgh' }))).toContain('key: api port')
  })

  it('seven characters are never a start', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port' }])
    expect(call('memory_get', { id: 'abcdefg' })).toMatchObject({
      isError: true,
      text: 'memory_not_found'
    })
  })

  it('a start in another case or with a space is memory_not_found, never another item', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port' }])
    for (const id of ['ABCDEFGH', 'abcdefgh ', ' abcdefgh'])
      expect(call('memory_get', { id })).toMatchObject({ text: 'memory_not_found' })
  })

  it('a whole id still wins over a start', () => {
    const { call } = setUp([
      { id: 'abcdefgh', key: 'api port' },
      { id: 'abcdefgh-0002', key: 'hook port' }
    ])
    expect(text(call('memory_get', { id: 'abcdefgh' }))).toContain('key: api port')
  })

  it('a stale item is still read by its start, and shows its state', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port', stale: true }])
    expect(text(call('memory_get', { id: 'abcdefgh' }))).toContain('state: stale')
  })

  it('a % or _ in the argument is a plain character', () => {
    const { call } = setUp([{ id: 'abcdefgh-0001', key: 'api port' }])
    expect(call('memory_get', { id: 'abcdefg%' })).toMatchObject({ text: 'memory_not_found' })
    expect(call('memory_get', { id: 'abcdefg_' })).toMatchObject({ text: 'memory_not_found' })
  })
})
