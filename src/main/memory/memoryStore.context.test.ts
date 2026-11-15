// The memory store's context read (spec 2026-11-14 memory context index §1): the active specifics
// and facts in scope grouped by the first reason they share with a session (task, goal, folder,
// folders above, whole workspace, template, tags, folders below), and the short-id starts two
// items share. Real `:memory:` db.
import { beforeEach, describe, expect, it } from 'vitest'
import { MEMORY_ERROR, type MemoryItem, type MemoryText } from '../../shared/schemas/memory'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import type { ContextGroup, SessionContext } from './memorySearch'
import { createMemoryStore, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
const CTX: SessionContext = {
  folder: '/work/app',
  taskIds: ['t1'],
  goalId: 'g1',
  templateId: 'tp1',
  tagIds: ['a', 'b']
}
const BARE: SessionContext = {
  folder: '/work/app',
  taskIds: [],
  goalId: null,
  templateId: null,
  tagIds: []
}

let clock: number
let ids: number
/** Ids the next adds take, in order; then `m<n>`. */
let nextIds: string[]
let db: MemoryDb
let store: MemoryStore

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  db = open.db
  clock = NOW
  ids = 0
  nextIds = []
  store = createMemoryStore({
    db,
    now: () => clock,
    newId: () => nextIds.shift() ?? `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
})

type Extra = {
  workspaceId?: string | null
  by?: MemoryItem['origin']['by']
  sessionId?: string
  fact?: true
  check?: string
}

/** Each add is one second after the last, so `updatedAt` orders them. */
function add(key: string, meta: Partial<MemoryItem['meta']> = {}, extra: Extra = {}): string {
  clock += 1000
  const text: MemoryText =
    extra.fact === true
      ? { kind: 'fact', title: key, body: `body of ${key}` }
      : { kind: 'specific', key, value: `value of ${key}` }
  return store.add({
    text,
    workspaceId: extra.workspaceId === undefined ? 'w1' : extra.workspaceId,
    check: extra.check ?? null,
    basis: 'observed',
    origin: { by: extra.by ?? 'extract', sessionId: extra.sessionId ?? 's0' },
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
  }).id
}

function reasonsOf(groups: ContextGroup[]): Record<string, string[]> {
  return Object.fromEntries(groups.map((g) => [g.reason, g.rows.map((r) => r.id)]))
}

function groupOf(reason: ContextGroup['reason'], ctx: SessionContext = CTX): ContextGroup {
  const group = store.contextRows('w1', ctx).find((g) => g.reason === reason)
  if (group === undefined) throw new Error(`no ${reason} group`)
  return group
}

const idsOf = (reason: ContextGroup['reason']): string[] => groupOf(reason).rows.map((r) => r.id)

describe('contextRows', () => {
  it('1. an item goes under the first reason that fits, and only once', () => {
    add('k', { taskIds: ['t1'], goalId: 'g1', folder: '/work/app', tagIds: ['a'] })
    expect(reasonsOf(store.contextRows('w1', CTX))).toEqual({ task: ['m1'] })
  })

  it('2. each reason takes its own items, in KEY_REASONS order', () => {
    add('task', { taskIds: ['t1'] })
    add('goal', { goalId: 'g1' })
    add('folder', { folder: '/work/app' })
    add('above', { folder: '/work' })
    add('workspace')
    add('template', { templateId: 'tp1', folder: '/other' })
    add('tags', { tagIds: ['b'], folder: '/other' })
    add('below', { folder: '/work/app/sub' })
    expect(store.contextRows('w1', CTX).map((g) => [g.reason, g.rows.map((r) => r.id)])).toEqual([
      ['task', ['m1']],
      ['goal', ['m2']],
      ['folder', ['m3']],
      ['folder_above', ['m4']],
      ['workspace', ['m5']],
      ['template', ['m6']],
      ['tags', ['m7']],
      ['folder_below', ['m8']]
    ])
  })

  it('3. no folder but a goal or a tag is not a workspace item', () => {
    add('goal elsewhere', { goalId: 'gX' })
    add('tag elsewhere', { tagIds: ['z'] })
    expect(store.contextRows('w1', CTX)).toEqual([])
  })

  it('4. a field the session lacks matches nothing', () => {
    add('one', { folder: '/elsewhere' })
    add('two', { folder: '/elsewhere', taskIds: ['t9'] })
    expect(
      store.contextRows('w1', { ...CTX, taskIds: [], goalId: null, templateId: null, tagIds: [] })
    ).toEqual([])
  })

  it('5. another workspace, a stale item, a pinned item and an episode are never returned', () => {
    const shown = add('shown', { folder: '/work/app' })
    add('other workspace', { folder: '/work/app' }, { workspaceId: 'w2' })
    const stale = add('stale', { folder: '/work/app' })
    store.setState(stale, 'stale', 'operator', null)
    const pinned = add('pinned', { folder: '/work/app' })
    store.setPinned(pinned, true)
    clock += 1000
    store.add({
      text: { kind: 'episode', title: 'an episode', body: 'what happened', endedAt: clock },
      workspaceId: 'w1',
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
    expect(reasonsOf(store.contextRows('w1', BARE))).toEqual({ folder: [shown] })
  })

  it('6. a global item is grouped like a workspace item', () => {
    const global = add('global', { folder: '/work/app' }, { workspaceId: null })
    expect(reasonsOf(store.contextRows('w1', BARE))).toEqual({ folder: [global] })
  })

  it('7. order inside a group: deleted session last, another goal after, operator first, newest first', () => {
    const a = add('a', { folder: '/work/app' })
    const b = add('b', { folder: '/work/app' }, { by: 'operator' })
    const c = add('c', { folder: '/work/app', goalId: 'gX' })
    const d = add('d', { folder: '/work/app' }, { sessionId: 'gone' })
    store.markSessionDeleted('gone')
    const e = add('e', { folder: '/work/app' })
    expect(idsOf('folder')).toEqual([b, e, a, c, d])
  })

  it('8. the tags group puts more shared tags first; rows stop at perReason and total counts all', () => {
    const both = add('both', { folder: '/other', tagIds: ['a', 'b'] })
    for (let n = 0; n < 45; n++) add(`one ${n}`, { folder: '/other', tagIds: ['a'] })
    const tags = groupOf('tags')
    expect([tags.rows[0]?.id, tags.rows.length, tags.total]).toEqual([both, 40, 46])
  })

  it('9. a session with no folder gets no folder group', () => {
    add('here', { folder: '/work/app' })
    add('anywhere', { folder: '/' })
    const reasons = store.contextRows('w1', { ...CTX, folder: '' }).map((g) => g.reason)
    expect(reasons).not.toContain('folder')
    expect(reasons).toEqual([])
  })

  it('10. a session at the root lists every saved folder as below', () => {
    const app = add('app', { folder: '/work/app' })
    const srv = add('srv', { folder: '/srv' })
    expect(reasonsOf(store.contextRows('w1', { ...BARE, folder: '/' }))).toEqual({
      folder_below: [srv, app]
    })
  })

  it('10b. a trailing slash on either folder is ignored; an item at the root is "this folder" for a session at the root', () => {
    const slashed = add('slashed', { folder: '/work/app/' })
    expect(reasonsOf(store.contextRows('w1', { ...BARE, folder: '/work/app/' }))).toEqual({
      folder: [slashed]
    })
    const root = add('root', { folder: '/' })
    expect(reasonsOf(store.contextRows('w1', { ...BARE, folder: '/' }))).toEqual({
      folder: [root],
      folder_below: [slashed]
    })
  })

  it('11. a row carries the last-seen day, the basis, the check flag and the deleted mark', () => {
    add('checked', { folder: '/work/app' }, { check: 'curl it', sessionId: 'gone' })
    store.markSessionDeleted('gone')
    const deletedAt = clock
    store.touchSeen('m1', NOW + 5)
    add('a fact', { folder: '/work/app' }, { fact: true })
    expect(groupOf('folder', BARE).rows).toEqual([
      {
        id: 'm2',
        kind: 'fact',
        head: 'a fact',
        body: 'body of a fact',
        folder: '/work/app',
        lastSeenAt: NOW + 2000,
        updatedAt: NOW + 2000,
        basis: 'observed',
        hasCheck: false,
        originDeletedAt: null
      },
      {
        id: 'm1',
        kind: 'specific',
        head: 'checked',
        body: 'value of checked',
        folder: '/work/app',
        lastSeenAt: NOW + 5,
        updatedAt: NOW + 1000,
        basis: 'observed',
        hasCheck: true,
        originDeletedAt: deletedAt
      }
    ])
  })

  it('13. a failed read throws memory_read_failed', () => {
    add('here', { folder: '/work/app' })
    db.close()
    expect(() => store.contextRows('w1', CTX)).toThrow(MEMORY_ERROR.readFailed)
    expect(() => store.shortIdClashes('w1')).toThrow(MEMORY_ERROR.readFailed)
  })
})

describe('shortIdClashes', () => {
  it('12. shortIdClashes names a start two ids share, in scope only', () => {
    nextIds = ['abcdefgh-1', 'abcdefgh-2', 'zzzzzzzz-1', 'zzzzzzzz-2']
    add('one')
    add('two')
    add('three')
    add('four', {}, { workspaceId: 'w2' })
    expect(store.shortIdClashes('w1')).toEqual(['abcdefgh'])
  })
})

describe('idsStarting', () => {
  it('returns at most limit ids in scope, global items included, compared exactly', () => {
    nextIds = ['abcdefgh-1', 'abcdefgh-2', 'abcdefgh-3', 'abcdefgh-4', 'ABCDEFGH-5']
    add('in w1')
    add('global', {}, { workspaceId: null })
    add('in w2', {}, { workspaceId: 'w2' })
    add('stale')
    store.setState('abcdefgh-4', 'stale', 'operator', null)
    add('other case')
    const scope = { workspaceId: 'w1', includeGlobal: true }
    expect(store.idsStarting(scope, 'abcdefgh', 10).sort()).toEqual([
      'abcdefgh-1',
      'abcdefgh-2',
      'abcdefgh-4'
    ])
    expect(store.idsStarting(scope, 'abcdefgh', 2)).toHaveLength(2)
    expect(store.idsStarting(scope, 'abcdefg%', 10)).toEqual([])
  })
})

describe('changedSince', () => {
  it('counts an add and an edit after at, not a pin, a stale item, another workspace or an episode', () => {
    const before = add('old')
    const pinned = add('pinned')
    const staled = add('staled')
    const at = clock
    expect(store.changedSince({ workspaceId: 'w1', includeGlobal: true }, at)).toBe(0)
    add('new here')
    add('new global', {}, { workspaceId: null })
    add('new elsewhere', {}, { workspaceId: 'w2' })
    clock += 1000
    store.edit(
      before,
      { text: { kind: 'specific', key: 'old', value: 'v2' }, check: null },
      'operator',
      null
    )
    clock += 1000
    store.setState(staled, 'stale', 'operator', null)
    store.setPinned(pinned, true)
    store.edit(
      pinned,
      { text: { kind: 'specific', key: 'pinned', value: 'v2' }, check: null },
      'operator',
      null
    )
    clock += 1000
    store.add({
      text: { kind: 'episode', title: 'a session', body: 'it ran', endedAt: clock },
      workspaceId: 'w1',
      check: null,
      basis: 'observed',
      origin: { by: 'extract', sessionId: 's0' },
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
    expect(store.changedSince({ workspaceId: 'w1', includeGlobal: true }, at)).toBe(3)
    expect(store.changedSince({ workspaceId: 'w1', includeGlobal: false }, at)).toBe(2)
    expect(store.changedSince({ workspaceId: 'w1', includeGlobal: true }, clock)).toBe(0)
  })
})
