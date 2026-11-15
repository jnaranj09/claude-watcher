// The memory IPC handler bodies (spec 2026-11-11 memory): each parses its `.strict()` request once,
// stamps the operator as the writer, and lets the store's codes through unchanged. Real `:memory:`
// db; the operator's dialog opens any item it listed, so no handler checks a scope.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_ERROR, type MemoryText } from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { createMemoryCommands, type MemoryCommands } from './memoryCommands'
import { openMemoryDb, type MemoryDb } from './memoryDb'
import { createMemoryIpcHandlers, type MemoryIpcHandlers } from './memoryIpc'
import { memoryNameLookups, type MemoryNames } from './memoryNames'
import { createMemoryStore, type MemoryStore } from './memoryStore'

const NOW = 1_762_800_000_000
/** Goals `g1` (w1) and `g2` (w2); tags `t1` (global), `t2` (w1), `t3` (w2). */
const CATALOG = memoryNameLookups({
  goals: () => [
    { id: 'g1', name: 'Ship', workspaceId: 'w1' },
    { id: 'g2', name: 'Other', workspaceId: 'w2' }
  ],
  tags: () => [
    { id: 't1', name: 'infra', workspaceId: null },
    { id: 't2', name: 'api', workspaceId: 'w1' },
    { id: 't3', name: 'web', workspaceId: 'w2' }
  ]
})
const NO_CONTEXT = { folder: null, goalId: null, tagIds: [] }
const PORT: MemoryText = { kind: 'specific', key: 'API port', value: '9280' }
const NOTE: MemoryText = { kind: 'fact', title: 'Deploys', body: 'Tag first, then deploy.' }

let db: MemoryDb
let store: MemoryStore
let commands: MemoryCommands
let activity: MemoryActivityLog
let names: MemoryNames
let h: MemoryIpcHandlers
let logs: string[]

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
  commands = createMemoryCommands({ db, newId: () => `c${++ids}` })
  activity = createMemoryActivity()
  names = {
    ...CATALOG,
    tagIdsByName: vi.fn((_w: string, name: string) => (name === 'infra' ? ['t1'] : [])),
    goalIdsByName: vi.fn((): string[] => []),
    goalName: vi.fn((): string | null => null),
    tagName: vi.fn((): string | null => null)
  }
  logs = []
  h = createMemoryIpcHandlers({
    store: () => store,
    commands: () => commands,
    names,
    activity,
    log: (line) => logs.push(line)
  })
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
  return h.create({ workspaceId, text, check: null, context: NO_CONTEXT }).id
}

describe('create', () => {
  it('stamps the operator as the writer, basis stated, with empty meta', () => {
    const item = h.create({
      workspaceId: 'w1',
      text: PORT,
      check: 'curl :9280',
      context: NO_CONTEXT
    })
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
      },
      source: null
    })
  })

  it('refuses an extra key (a basis or an origin never comes from the renderer)', () => {
    expect(() =>
      h.create({
        workspaceId: 'w1',
        text: PORT,
        check: null,
        context: NO_CONTEXT,
        basis: 'observed'
      })
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
    expect(out).toEqual({ rows: [], total: 0, twinIds: [] })
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
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null, context: null })
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

describe('same value', () => {
  // 6
  it('list answers the ids of its rows that have a twin, and none for another page', () => {
    const a = create()
    const b = create({ ...PORT, key: 'port of the api' })
    create({ ...PORT, key: 'web port', value: '9444' })
    expect(h.list(LIST).twinIds.sort()).toEqual([a, b].sort())
    create(NOTE)
    expect(h.list({ ...LIST, kind: 'fact' }).twinIds).toEqual([])
  })
  // 7
  it('list names only twins that are rows of the page it answers', () => {
    const a = create()
    create({ ...PORT, key: 'listener' })
    const page = h.list({ ...LIST, query: 'API' })
    expect(page.rows.map((r) => r.id)).toEqual([a])
    expect(page.twinIds).toEqual([a])
  })
  // 8
  it('get names at most five twins, newest first, and counts the rest', () => {
    const first = create()
    const others = ['b', 'c', 'd', 'e', 'f', 'g'].map((k) => create({ ...PORT, key: `port ${k}` }))
    const out = h.get({ id: first })
    expect(out.twins.map((t) => t.id)).toEqual([...others].reverse().slice(0, 5))
    expect(out.twins[0]).toMatchObject({ key: 'port g' })
    expect(out.twinsMore).toBe(1)
  })
  // 9
  it('get answers no twins for an item that has none', () => {
    const out = h.get({ id: create() })
    expect([out.twins, out.twinsMore]).toEqual([[], 0])
  })

  // 10
  it('get reads no twins for a fact, whatever the store would answer', () => {
    const twinsOf = vi.spyOn(store, 'twinsOf')
    const out = h.get({ id: create(NOTE) })
    expect([out.twins, out.twinsMore]).toEqual([[], 0])
    expect(twinsOf).not.toHaveBeenCalled()
  })
})

describe('edit', () => {
  it('appends a version written by the operator with no reason', () => {
    const id = create()
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null, context: null })
    const [newest] = store.versions(id)
    expect(newest).toMatchObject({ by: 'operator', reason: null, body: '9281' })
  })

  it('refuses an extra key', () => {
    expect(() =>
      h.edit({ id: create(), text: PORT, check: null, context: null, reason: 'operator prose' })
    ).toThrow()
  })
})

describe("an item's context (folder, goal, tags)", () => {
  const SPECIFIC = PORT
  const SCOPE_ALL = { workspaceId: 'w1', includeGlobal: true }
  const EVERYTHING = { kind: 'specific', query: null, filters: {}, offset: 0, limit: 50 } as const
  const CTX = { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }

  function createOf(req: {
    workspaceId: string | null
    goalId: string | null
    tagIds: string[]
  }): unknown {
    return {
      workspaceId: req.workspaceId,
      text: SPECIFIC,
      check: null,
      context: { folder: null, goalId: req.goalId, tagIds: req.tagIds }
    }
  }

  /** The stored value of a specific (null for anything else). */
  function valueOf(id: string): string | null {
    const item = store.get(id)
    return item?.kind === 'specific' ? item.value : null
  }

  /** An item a session saved, with a folder, a goal, tags, a session name, a template and tasks. */
  function savedBySession(meta: { folder: string; goalId: string; tagIds: string[] }): string {
    return store.add({
      text: SPECIFIC,
      workspaceId: 'w1',
      check: 'curl :9280',
      basis: 'inferred',
      origin: { by: 'agent', sessionId: 's1' },
      meta: { ...meta, sessionName: 'api work', templateId: 'tpl1', taskIds: ['k1'] },
      source: null
    }).id
  }

  it('a create stamps the folder, the goal and the tags, and nothing else', () => {
    const item = h.create({
      workspaceId: 'w1',
      text: SPECIFIC,
      check: null,
      context: { folder: '/work/app/', goalId: 'g1', tagIds: ['t1', 't2'] }
    })
    expect(item.meta).toEqual({
      folder: '/work/app',
      goalId: 'g1',
      tagIds: ['t1', 't2'],
      sessionName: null,
      templateId: null,
      taskIds: []
    })
  })

  it('a folder of only slashes is stored as /', () => {
    const item = h.create({
      workspaceId: 'w1',
      text: SPECIFIC,
      check: null,
      context: { folder: '/', goalId: null, tagIds: [] }
    })
    expect(item.meta.folder).toBe('/')
  })

  it('an edit stores a folder without its trailing slashes too', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    const out = h.edit({ id, text: SPECIFIC, check: null, context: { folder: '/work/shop//' } })
    expect(out.meta.folder).toBe('/work/shop')
  })

  it('a create with a goal of another workspace, a gone tag, or a goal on a global item is refused and writes nothing', () => {
    for (const req of [
      { workspaceId: 'w1', goalId: 'g2', tagIds: [] },
      { workspaceId: 'w1', goalId: null, tagIds: ['gone'] },
      { workspaceId: null, goalId: 'g1', tagIds: [] },
      { workspaceId: null, goalId: null, tagIds: ['t2'] }
    ]) {
      expect(() => h.create(createOf(req))).toThrow(MEMORY_ERROR.contextInvalid)
    }
    expect(store.search(SCOPE_ALL, EVERYTHING, CTX).total).toBe(0)
  })

  it('a create without a context is a schema error', () => {
    expect(() => h.create({ workspaceId: 'w1', text: SPECIFIC, check: null })).toThrow()
  })

  it('an edit with context null leaves the context as it is', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: ['t1'] })
    const out = h.edit({ id, text: { ...SPECIFIC, value: '9281' }, check: null, context: null })
    expect(out.meta).toEqual({
      folder: '/work/app',
      goalId: 'g1',
      tagIds: ['t1'],
      sessionName: 'api work',
      templateId: 'tpl1',
      taskIds: ['k1']
    })
  })

  it('an edit that sends only the tags keeps the folder and the goal', () => {
    const id = savedBySession({ folder: '/gone/place', goalId: 'g1', tagIds: ['t1'] })
    const out = h.edit({ id, text: SPECIFIC, check: null, context: { tagIds: ['t1', 't2'] } })
    expect([out.meta.folder, out.meta.goalId, out.meta.tagIds]).toEqual([
      '/gone/place',
      'g1',
      ['t1', 't2']
    ])
  })

  it('an edit keeps a stored id that is gone, and refuses a new one that is gone', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'gone-goal', tagIds: ['deleted-tag'] })
    const kept = h.edit({
      id,
      text: SPECIFIC,
      check: null,
      context: { goalId: 'gone-goal', tagIds: ['deleted-tag', 't2'] }
    })
    expect([kept.meta.goalId, kept.meta.tagIds]).toEqual(['gone-goal', ['deleted-tag', 't2']])
    expect(() =>
      h.edit({
        id,
        text: SPECIFIC,
        check: null,
        context: { tagIds: ['deleted-tag', 'other-gone'] }
      })
    ).toThrow(MEMORY_ERROR.contextInvalid)
    expect(store.get(id)?.meta.tagIds).toEqual(['deleted-tag', 't2'])
  })

  it('an edit refuses a goal of another workspace on a workspace item', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    expect(() => h.edit({ id, text: SPECIFIC, check: null, context: { goalId: 'g2' } })).toThrow(
      MEMORY_ERROR.contextInvalid
    )
    expect(store.get(id)?.meta.goalId).toBe('g1')
  })

  it('a context write keeps the session name, the template and the task ids, adds no version and moves no date', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: ['t1'] })
    const before = store.get(id)
    const versionsBefore = store.versions(id).length
    const after = store.setContext(id, { folder: '/work/shop', goalId: null, tagIds: [] })
    expect(after.meta).toEqual({
      folder: '/work/shop',
      goalId: null,
      tagIds: [],
      sessionName: 'api work',
      templateId: 'tpl1',
      taskIds: ['k1']
    })
    expect(store.versions(id)).toHaveLength(versionsBefore)
    expect([after.updatedAt, after.lastSeenAt]).toEqual([before?.updatedAt, before?.lastSeenAt])
  })

  it('setContext on an unknown id throws memory_not_found', () => {
    expect(() => store.setContext('nope', { folder: '/x' })).toThrow(MEMORY_ERROR.notFound)
  })

  it('a Save that changes only the context adds no version and moves no date', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    const before = store.get(id)
    const versionsBefore = store.versions(id).length
    h.edit({ id, text: SPECIFIC, check: 'curl :9280', context: { folder: '/work/shop' } })
    expect(store.versions(id)).toHaveLength(versionsBefore)
    expect(store.get(id)?.updatedAt).toBe(before?.updatedAt)
    expect(store.get(id)?.meta.folder).toBe('/work/shop')
  })

  it('a Save that changes the text and the context writes one version and the context', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    const versionsBefore = store.versions(id).length
    const out = h.edit({
      id,
      text: { ...SPECIFIC, value: '9281' },
      check: 'curl :9280',
      context: { folder: '/work/shop' }
    })
    expect(store.versions(id)).toHaveLength(versionsBefore + 1)
    expect([out.meta.folder, valueOf(id)]).toEqual(['/work/shop', '9281'])
  })

  it('a context edit tells the listeners once', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    const heard = vi.fn()
    store.onChange(heard)
    h.edit({ id, text: { ...SPECIFIC, value: '9281' }, check: null, context: { folder: '/x' } })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('a refused context write leaves the text as it was', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    expect(() =>
      h.edit({ id, text: { ...SPECIFIC, value: '9281' }, check: null, context: { goalId: 'gone' } })
    ).toThrow(MEMORY_ERROR.contextInvalid)
    expect(valueOf(id)).toBe('9280')
  })

  it('a disk that refuses the context write keeps the text and the context as they were', () => {
    const id = savedBySession({ folder: '/work/app', goalId: 'g1', tagIds: [] })
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('SQLITE_FULL')
    })
    expect(() =>
      h.edit({ id, text: { ...SPECIFIC, value: '9281' }, check: null, context: { folder: '/x' } })
    ).toThrow(STORE_WRITE_FAILED)
    vi.restoreAllMocks()
    expect([store.get(id)?.meta.folder, valueOf(id)]).toEqual(['/work/app', '9280'])
  })

  it('a folder with a line break or a control character is a schema error', () => {
    for (const folder of ['/a\n/b', '/a\u0007b']) {
      expect(() =>
        h.create({
          workspaceId: 'w1',
          text: SPECIFIC,
          check: null,
          context: { ...NO_CONTEXT, folder }
        })
      ).toThrow()
    }
    const id = create()
    expect(() =>
      h.edit({ id, text: SPECIFIC, check: null, context: { folder: '/a\n/b' } })
    ).toThrow()
  })

  it('a context with an extra key, or more than 50 tags, is a schema error', () => {
    expect(() =>
      h.create({ workspaceId: 'w1', text: SPECIFIC, check: null, context: { ...NO_CONTEXT, x: 1 } })
    ).toThrow()
    const tagIds = Array.from({ length: 51 }, () => 't1')
    expect(() =>
      h.create({
        workspaceId: 'w1',
        text: SPECIFIC,
        check: null,
        context: { ...NO_CONTEXT, tagIds }
      })
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
    h.edit({ id, text: { ...PORT, value: '9281' }, check: null, context: null })
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
    activity.injected('s1', { chars: 40, itemIds: ['m1'], groups: [] })
    expect(h.activity({ sessionId: 's1' })).toEqual({
      injected: { tokens: 10, itemIds: ['m1'], groups: [] },
      entries: [],
      recall: null
    })
  })

  it('answers an empty record for a session with nothing recorded', () => {
    expect(h.activity({ sessionId: 's9' })).toEqual({ injected: null, entries: [], recall: null })
  })

  it('refuses an extra key', () => {
    expect(() => h.activity({ sessionId: 's1', extra: 1 })).toThrow()
  })
})

describe("a session's items (the Delete confirm)", () => {
  function savedBy(sessionId: string): string {
    return store.add({
      text: PORT,
      workspaceId: 'w1',
      check: null,
      basis: 'inferred',
      origin: { by: 'agent', sessionId },
      meta: {
        folder: null,
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      },
      source: null
    }).id
  }

  it('sessionCount answers how many items the session saved', () => {
    savedBy('s1')
    savedBy('s1')
    savedBy('s2')
    create()
    expect(h.sessionCount({ sessionId: 's1' })).toBe(2)
    expect(h.sessionCount({ sessionId: 's9' })).toBe(0)
  })

  it("removeSession deletes the session's items only, and answers how many", () => {
    const mine = savedBy('s1')
    const other = savedBy('s2')
    const byHand = create()
    expect(h.removeSession({ sessionId: 's1' })).toBe(1)
    expect(() => h.get({ id: mine })).toThrow(MEMORY_ERROR.notFound)
    expect(h.get({ id: other }).item.id).toBe(other)
    expect(h.get({ id: byHand }).item.id).toBe(byHand)
    expect(h.removeSession({ sessionId: 's1' })).toBe(0)
  })

  it('both refuse a request with an unknown key or no session id', () => {
    expect(() => h.sessionCount({ sessionId: 's1', extra: 1 })).toThrow()
    expect(() => h.removeSession({ sessionId: 's1', extra: 1 })).toThrow()
    expect(() => h.sessionCount({ sessionId: '' })).toThrow()
    expect(() => h.removeSession({})).toThrow()
  })
})

const COMMANDS = { workspaceId: 'w1', query: null, offset: 0, limit: 50 } as const

/** A command a session ran in `/work/demo`, recorded the way a save records it. */
function ranOnce(text: string, workspaceId = 'w1'): string {
  commands.record({ workspaceId, folder: '/work/demo', text, sessionId: 's1', at: NOW })
  const row = commands
    .list(workspaceId, { query: null, folder: null, offset: 0, limit: 50 })
    .rows.find((r) => r.text === text)
  if (row === undefined) throw new Error('command not recorded')
  return row.id
}

describe('commands (the Commands page)', () => {
  it('lists commands for a workspace and refuses an extra key', () => {
    ranOnce('npm test')
    ranOnce('npm run build')
    ranOnce('make', 'w2')
    const page = h.commands(COMMANDS)
    expect(page.total).toBe(2)
    expect(page.rows.map((r) => r.text).sort()).toEqual(['npm run build', 'npm test'])
    expect(h.commands({ ...COMMANDS, query: 'build' }).rows.map((r) => r.text)).toEqual([
      'npm run build'
    ])
    expect(() => h.commands({ ...COMMANDS, extra: 1 })).toThrow(/unrecognized_keys/)
    expect(() => h.commands({ ...COMMANDS, folder: '/work/demo' })).toThrow(/unrecognized_keys/)
  })

  it("lists only the requested workspace's commands", () => {
    ranOnce('npm test')
    ranOnce('make', 'w2')
    expect(h.commands({ ...COMMANDS, workspaceId: 'w2' }).rows.map((r) => r.text)).toEqual(['make'])
    expect(h.commands({ ...COMMANDS, workspaceId: 'w3' })).toEqual({ rows: [], total: 0 })
  })

  it('has no global scope: a command always belongs to one workspace', () => {
    ranOnce('npm test')
    // The Commands page lists ONE workspace (no `Include global`, no null workspace).
    expect(() => h.commands({ ...COMMANDS, includeGlobal: true })).toThrow(/unrecognized_keys/)
    expect(() => h.commands({ ...COMMANDS, workspaceId: null })).toThrow(/invalid_type/)
  })

  it('deleting an unknown command throws memory_command_not_found', () => {
    expect(() => h.removeCommand({ id: 'nope' })).toThrow(MEMORY_ERROR.commandNotFound)
  })

  it('deleting a command pushes memory:changed once', () => {
    const id = ranOnce('npm test')
    const heard = vi.fn()
    store.onChange(heard)
    h.removeCommand({ id })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(h.commands(COMMANDS).total).toBe(0)
  })

  it('a list the database fails throws memory_read_failed and logs the code only', () => {
    ranOnce('npm test')
    vi.spyOn(db, 'all').mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed')
    })
    expect(() => h.commands(COMMANDS)).toThrow(new Error(MEMORY_ERROR.readFailed))
    expect(logs).toEqual(['[claude-watcher][memory] code=memory_read_failed'])
  })

  it('refuses a delete with an extra key and keeps the row', () => {
    const id = ranOnce('npm test')
    expect(() => h.removeCommand({ id, extra: 1 })).toThrow(/unrecognized_keys/)
    expect(() => h.removeCommand({ id: 7 })).toThrow(/invalid_type/)
    expect(h.commands(COMMANDS).rows.map((r) => r.id)).toEqual([id])
  })
})

describe('while memory is off (no store)', () => {
  it('every handler but activity throws memory_unavailable', () => {
    const off = createMemoryIpcHandlers({
      store: () => null,
      commands: () => null,
      names,
      activity,
      log: () => undefined
    })
    const id = { id: 'm1' }
    const calls: (() => unknown)[] = [
      () => off.list(LIST),
      () => off.get(id),
      () => off.create({ workspaceId: 'w1', text: PORT, check: null, context: NO_CONTEXT }),
      () => off.edit({ ...id, text: PORT, check: null, context: null }),
      () => off.setState({ ...id, state: 'stale' }),
      () => off.setPinned({ ...id, pinned: true }),
      () => off.remove(id),
      () => off.restore({ ...id, versionAt: NOW }),
      () => off.sessionCount({ sessionId: 's1' }),
      () => off.removeSession({ sessionId: 's1' }),
      () => off.commands(COMMANDS),
      () => off.removeCommand({ id: 'c1' })
    ]
    for (const call of calls) expect(call).toThrow(MEMORY_ERROR.unavailable)
  })

  it('activity still answers from the in-memory record, and still parses its argument', () => {
    const off = createMemoryIpcHandlers({
      store: () => null,
      commands: () => null,
      names,
      activity,
      log: () => undefined
    })
    activity.injected('s1', { chars: 8, itemIds: ['m1'], groups: [] })
    expect(off.activity({ sessionId: 's1' })).toEqual({
      injected: { tokens: 2, itemIds: ['m1'], groups: [] },
      entries: [],
      recall: null
    })
    expect(off.activity({ sessionId: 's9' })).toEqual({ injected: null, entries: [], recall: null })
    expect(() => off.activity({ sessionId: 's1', extra: 1 })).toThrow()
  })
})

describe('a write the disk refuses', () => {
  it('surfaces as store_write_failed, unchanged', () => {
    const id = create()
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('SQLITE_FULL')
    })
    expect(() =>
      h.edit({ id, text: { ...PORT, value: '9281' }, check: null, context: null })
    ).toThrow(STORE_WRITE_FAILED)
    expect(() => h.remove({ id })).toThrow(STORE_WRITE_FAILED)
  })

  it('a refused command delete throws store_write_failed, keeps the row and tells no one', () => {
    const id = ranOnce('npm test')
    const heard = vi.fn()
    store.onChange(heard)
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('SQLITE_FULL')
    })
    expect(() => h.removeCommand({ id })).toThrow(STORE_WRITE_FAILED)
    expect(heard).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(h.commands(COMMANDS).total).toBe(1)
  })
})
