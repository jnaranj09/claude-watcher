// The memory tools (spec 2026-11-11 memory §3): scope, text formats, refusals, never delete/pin.
// Real `:memory:` store; the session and name lookups are stand-ins.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_ERROR } from '../../shared/schemas/memory'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import type { McpToolOutcome, McpTools } from '../mcp/mcpEndpoint'
import { formatDay } from './formatDay'
import { createMemoryActivity, type MemoryActivityLog } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryStore } from './memoryStore'
import {
  MEMORY_NOT_AVAILABLE,
  MEMORY_TOOLS,
  createMemoryTools,
  type MemoryGrant,
  type MemorySessionMeta
} from './memoryTools'

const NOW = 1_762_800_000_000
const DAY = 86_400_000
const SECRET = 'secret-4417'

function meta(workspaceId: string, over: Partial<MemorySessionMeta> = {}): MemorySessionMeta {
  return {
    workspaceId,
    folder: '/work/app',
    sessionName: 'build',
    tagIds: [],
    templateId: null,
    goalId: null,
    taskIds: [],
    ...over
  }
}

let store: MemoryStore
let clock = NOW
let activity: MemoryActivityLog
let sessions: Map<string, MemorySessionMeta>
let enabled: boolean
let storeAvailable: boolean
let lines: string[]
let tools: McpTools<MemoryGrant>
const tagNames: Record<string, string> = { t1: 'infra', t2: 'ci' }

beforeEach(() => {
  clock = NOW
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  let n = 0
  store = createMemoryStore({
    db: open.db,
    now: () => clock,
    newId: () => `m${++n}`,
    report: () => undefined,
    log: () => undefined
  })
  activity = createMemoryActivity()
  sessions = new Map([
    ['s1', meta('w1')],
    ['s2', meta('w2')],
    ['s3', meta('w1', { sessionName: 'old run' })]
  ])
  enabled = true
  storeAvailable = true
  lines = []
  tools = createMemoryTools({
    enabled: () => enabled,
    store: () => (storeAvailable ? store : null),
    session: (id) => sessions.get(id) ?? null,
    names: {
      tagIdsByName: (_w, name) =>
        Object.entries(tagNames).flatMap(([id, v]) => (v === name ? id : [])),
      tagName: (id) => tagNames[id] ?? null,
      goalIdsByName: () => []
    },
    activity,
    now: () => NOW,
    log: (line) => {
      lines.push(line)
    }
  })
})

const as = (sessionId: string): MemoryGrant => ({ sessionId })
const call = (name: string, args: unknown, sessionId = 's1'): McpToolOutcome =>
  tools.call(name, args, as(sessionId))

function text(out: McpToolOutcome): string {
  if (out.kind !== 'result') throw new Error('expected a result')
  return out.text
}

function saved(args: unknown, sessionId = 's1'): string {
  const out = call('memory_save', args, sessionId)
  const match = /^Saved\. id=(.+)$/.exec(text(out))
  if (match?.[1] === undefined) throw new Error('save failed')
  return match[1]
}

const specific = (key: string, value: string, scope = 'workspace'): Record<string, unknown> => ({
  kind: 'specific',
  key,
  value,
  scope
})

describe('memory tools: list', () => {
  it('lists the six tools, and no delete or pin', () => {
    expect(tools.list(as('s1')).map((t) => t.name)).toEqual([...MEMORY_TOOLS])
    expect(MEMORY_TOOLS).toHaveLength(6)
    for (const name of ['memory_delete', 'memory_pin', 'memory_remove', 'memory_set_pinned']) {
      expect(call(name, { id: 'm1' })).toEqual({ kind: 'invalid_params' })
    }
  })

  it('still lists the tools when memory is not available', () => {
    enabled = false
    expect(tools.list(as('s1'))).toHaveLength(6)
  })

  it('builds the search input from the one filter list', () => {
    const search = tools.list(as('s1')).find((t) => t.name === 'memory_search')
    expect(Object.keys(search?.inputSchema['properties'] ?? {}).sort()).toEqual(
      [
        'query',
        'kind',
        'limit',
        'folder',
        'session',
        'tags',
        'since',
        'until',
        'goal',
        'sessionDeleted',
        'includeStale'
      ].sort()
    )
  })
})

describe('memory tools: input schema drift', () => {
  const DECOYS = ['workspaceId', 'sessionId', 'basis', 'origin', 'withSource', 'offset', 'pinned']
  const VALUES: Record<string, unknown> = {
    id: 'm1',
    reason: 'r',
    by: 'kind',
    check: 'ls',
    scope: 'global',
    key: 'k',
    value: 'v',
    title: 't',
    body: 'b',
    kind: 'specific'
  }
  const SPECIFIC = { kind: 'specific', key: 'k', value: 'v' }
  const FACT = { kind: 'fact', title: 't', body: 'b' }
  const BASES: Record<string, Record<string, unknown>[]> = {
    memory_get: [{ id: 'm1' }],
    memory_browse: [{ by: 'kind' }],
    memory_save: [
      { ...SPECIFIC, scope: 'global' },
      { ...FACT, scope: 'global' }
    ],
    memory_update: [
      { id: 'm1', ...SPECIFIC, reason: 'r' },
      { id: 'm1', ...FACT, reason: 'r' }
    ],
    memory_mark_stale: [{ id: 'm1', reason: 'r' }]
  }

  function accepted(name: string, universe: string[]): string[] {
    const keys = (BASES[name] ?? []).flatMap((base) =>
      universe.filter(
        (k) => k in base || call(name, { ...base, [k]: VALUES[k] }).kind !== 'invalid_params'
      )
    )
    return [...new Set(keys)].sort()
  }

  it.each(Object.keys(BASES))(
    '%s: the JSON schema lists exactly the keys its parser accepts',
    (name) => {
      saved(specific('seed', 'v'))
      const def = tools.list(as('s1')).find((t) => t.name === name)
      const listed = Object.keys(def?.inputSchema['properties'] ?? {}).sort()
      expect(accepted(name, [...listed, ...DECOYS])).toEqual(listed)
    }
  )
})

describe('memory tools: not available', () => {
  it.each([
    ['memory is off', () => (enabled = false)],
    ['the store is missing', () => (storeAvailable = false)],
    ['the session is not live', () => sessions.clear()]
  ])('every call answers not available when %s', (_title, off) => {
    off()
    for (const [name, args] of [
      ['memory_search', {}],
      ['memory_get', { id: 'm1' }],
      ['memory_browse', { by: 'kind' }],
      ['memory_save', specific('k', 'v')],
      ['memory_update', { id: 'm1', kind: 'specific', key: 'k', value: 'v', reason: 'r' }],
      ['memory_mark_stale', { id: 'm1', reason: 'r' }]
    ] as const) {
      expect(call(name, args)).toEqual({
        kind: 'result',
        text: MEMORY_NOT_AVAILABLE,
        code: 'memory_not_available',
        isError: true
      })
    }
  })
})

describe('memory tools: arguments', () => {
  it.each([
    ['memory_search', { limit: 0 }],
    ['memory_search', { limit: 21 }],
    ['memory_search', { limit: -1 }],
    ['memory_search', { query: 'x'.repeat(201) }],
    ['memory_search', { workspaceId: 'w2' }],
    ['memory_search', { since: '2026-13-40' }],
    ['memory_get', {}],
    ['memory_get', { id: 'm1', withSource: true }],
    ['memory_browse', { by: 'session' }],
    ['memory_save', { ...specific('k', 'v'), workspaceId: 'w2' }],
    ['memory_save', { ...specific('k', 'v'), basis: 'observed' }],
    ['memory_save', { ...specific('k', 'v'), scope: 'everywhere' }],
    ['memory_save', { kind: 'specific', key: 'k', body: 'b', scope: 'global' }],
    ['memory_save', specific('k'.repeat(121), 'v')],
    ['memory_save', { kind: 'fact', title: 't', body: 'b'.repeat(2001), scope: 'global' }],
    ['memory_update', { id: 'm1', kind: 'specific', key: 'k', value: 'v' }],
    [
      'memory_update',
      { id: 'm1', kind: 'specific', key: 'k', value: 'v', reason: 'x'.repeat(201) }
    ],
    ['memory_mark_stale', { id: 'm1' }],
    ['memory_mark_stale', { id: 'm1', reason: 'r', extra: 1 }]
  ])('%s with %j is invalid params', (name, args) => {
    expect(call(name, args)).toEqual({ kind: 'invalid_params' })
  })

  it('a bad argument never reaches the store', () => {
    const spy = vi.spyOn(store, 'search')
    call('memory_search', { limit: 99 })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('memory_save', () => {
  it('stamps workspace, inferred basis, agent origin and the session meta', () => {
    sessions.set(
      's1',
      meta('w1', { tagIds: ['t1'], goalId: 'g1', taskIds: ['k1'], templateId: 'tp' })
    )
    const id = saved({ ...specific('db port', '5433'), check: 'nc -z localhost 5433' })
    expect(store.get(id)).toMatchObject({
      kind: 'specific',
      key: 'db port',
      value: '5433',
      workspaceId: 'w1',
      basis: 'inferred',
      check: 'nc -z localhost 5433',
      origin: { by: 'agent', sessionId: 's1' },
      meta: {
        folder: '/work/app',
        sessionName: 'build',
        tagIds: ['t1'],
        templateId: 'tp',
        goalId: 'g1',
        taskIds: ['k1']
      }
    })
  })

  it('scope global stores no workspace', () => {
    expect(store.get(saved(specific('k', 'v', 'global')))?.workspaceId).toBeNull()
  })

  it('saves a fact with its line breaks', () => {
    const id = saved({ kind: 'fact', title: 'Deploy', body: 'one\ntwo', scope: 'workspace' })
    expect(store.get(id)).toMatchObject({ kind: 'fact', title: 'Deploy', body: 'one\ntwo' })
  })
})

describe('scope', () => {
  it('a workspace save is not found by another workspace; a global one is', () => {
    const own = saved(specific('k', 'v'))
    const global = saved(specific('g', 'v', 'global'))
    const notFound = { kind: 'result', text: MEMORY_ERROR.notFound, isError: true }
    expect(call('memory_get', { id: own }, 's2')).toEqual(notFound)
    expect(call('memory_get', { id: 'nope' }, 's2')).toEqual(notFound)
    expect(text(call('memory_get', { id: global }, 's2'))).toContain('key: g')
    expect(text(call('memory_search', {}, 's2'))).toContain(global)
    expect(text(call('memory_search', {}, 's2'))).not.toContain(own)
  })

  it('update and mark stale on another workspace answer not found and change nothing', () => {
    const own = saved(specific('k', 'v'))
    const notFound = { kind: 'result', text: MEMORY_ERROR.notFound, isError: true }
    expect(
      call('memory_update', { id: own, kind: 'specific', key: 'k', value: 'x', reason: 'r' }, 's2')
    ).toEqual(notFound)
    expect(call('memory_mark_stale', { id: own, reason: 'r' }, 's2')).toEqual(notFound)
    expect(store.get(own)).toMatchObject({ value: 'v', state: 'active' })
    expect(store.versions(own)).toHaveLength(1)
  })

  it('browse counts only this workspace and global', () => {
    saved(specific('a', '1'))
    saved(specific('b', '2'), 's2')
    saved(specific('c', '3', 'global'), 's2')
    expect(text(call('memory_browse', { by: 'kind' }))).toBe('specific: 2')
  })
})

describe('memory_search', () => {
  it('prints the whole text: header, rows newest first, the count', () => {
    const tick = (): number => (clock += 1000)
    tick()
    const stale = saved(specific('db port', '5433'))
    tick()
    const deleted = saved(
      { kind: 'fact', title: 'Deploy', body: 'steps', scope: 'workspace' },
      's3'
    )
    store.markSessionDeleted('s3')
    tick()
    sessions.set('s1', meta('w1', { tagIds: ['gone'] }))
    const unknownTag = saved({ kind: 'fact', title: 'Release', body: 'notes', scope: 'workspace' })
    tick()
    sessions.set('s1', meta('w1', { tagIds: ['t1', 'gone'], sessionName: 'ops' }))
    const tagged = saved(specific('region', 'eu'))
    tick()
    store.setState(stale, 'stale', 'operator', null)
    const day = formatDay(NOW)
    expect(text(call('memory_search', { includeStale: true, limit: 20 }))).toBe(
      [
        'id | kind | key/title | date | basis | session | tags',
        `${stale} | specific | db port | ${day} | inferred | build | - | stale`,
        `${tagged} | specific | region | ${day} | inferred | ops | infra`,
        `${unknownTag} | fact | Release | ${day} | inferred | build | -`,
        `${deleted} | fact | Deploy | ${day} | inferred | old run | - | session deleted ${day}`,
        '4 of 4'
      ].join('\n')
    )
  })

  it('leaves stale items out unless asked, and says No items. for nothing', () => {
    const a = saved(specific('db port', '5433'))
    store.setState(a, 'stale', 'operator', null)
    expect(text(call('memory_search', {}))).toBe('No items.')
    expect(text(call('memory_search', { query: 'zzzzqq' }))).toBe('No items.')
  })

  it('shows only the head of a multi-line fact, and limits rows', () => {
    saved({ kind: 'fact', title: 'Deploy', body: 'line one\nline two', scope: 'workspace' })
    saved(specific('b', '2'))
    const out = text(call('memory_search', { limit: 1 }))
    expect(out.split('\n')).toHaveLength(3)
    expect(out).not.toContain('line two')
    expect(out.endsWith('1 of 2')).toBe(true)
  })

  function twoFolders(): { here: string; other: string } {
    sessions.set('s1', meta('w1', { folder: '/work/app', tagIds: ['t2'] }))
    const here = saved(specific('here', '1'))
    sessions.set('s1', meta('w1', { folder: '/other', tagIds: [] }))
    return { here, other: saved(specific('other', '2')) }
  }

  it('folder "here" means the calling session folder', () => {
    const { other } = twoFolders()
    const out = text(call('memory_search', { folder: 'here' }))
    expect(out).toContain(other)
    expect(out.endsWith('1 of 1')).toBe(true)
  })

  it('tags are matched by name', () => {
    const { here, other } = twoFolders()
    const out = text(call('memory_search', { tags: ['ci'] }))
    expect(out).toContain(here)
    expect(out).not.toContain(other)
  })

  it('since a later day finds nothing', () => {
    twoFolders()
    expect(text(call('memory_search', { since: formatDay(NOW + DAY) }))).toBe('No items.')
  })
})

describe('memory_get', () => {
  it('prints a specific in exact text', () => {
    sessions.set('s1', meta('w1', { tagIds: ['t1', 't2'] }))
    const id = saved({ ...specific('db port', '5433'), check: 'nc -z localhost 5433' })
    expect(text(call('memory_get', { id }))).toBe(
      [
        'key: db port',
        'value: 5433',
        'basis: inferred',
        `seen: ${formatDay(NOW)}`,
        'check: nc -z localhost 5433',
        'session: build',
        'tags: infra, ci',
        'state: active'
      ].join('\n')
    )
  })

  it('a tags line with only unknown tag ids is a dash', () => {
    sessions.set('s1', meta('w1', { tagIds: ['gone', 'lost'] }))
    const id = saved(specific('k', 'v'))
    expect(text(call('memory_get', { id }))).toContain('\ntags: -\n')
  })

  it('prints a fact body as stored, no check line, and the deleted-session line', () => {
    const id = saved({ kind: 'fact', title: 'Deploy', body: 'one\ntwo', scope: 'global' })
    store.markSessionDeleted('s1')
    expect(text(call('memory_get', { id }))).toBe(
      [
        'title: Deploy',
        'body: one\ntwo',
        'basis: inferred',
        `seen: ${formatDay(NOW)}`,
        'session: build',
        'tags: -',
        'state: active',
        `session deleted: ${formatDay(NOW)}`
      ].join('\n')
    )
  })
})

describe('memory_browse', () => {
  it('prints label: count lines; a tag id with no name is unknown tag', () => {
    sessions.set('s1', meta('w1', { tagIds: ['t1', 'lost'] }))
    saved(specific('a', '1'))
    saved({ kind: 'fact', title: 'T', body: 'b', scope: 'workspace' })
    expect(text(call('memory_browse', { by: 'kind' }))).toMatch(
      /^(specific|fact): 1\n(specific|fact): 1$/
    )
    expect(
      text(call('memory_browse', { by: 'tag' }))
        .split('\n')
        .sort()
    ).toEqual(['infra: 2', 'unknown tag: 2'])
    expect(text(call('memory_browse', { by: 'folder' }))).toBe('/work/app: 2')
  })

  it('says No items. for nothing', () => {
    expect(text(call('memory_browse', { by: 'month' }))).toBe('No items.')
  })
})

describe('memory_update and memory_mark_stale', () => {
  it('update appends a version, keeps the check when omitted, clears it on null', () => {
    const id = saved({ ...specific('k', 'v'), check: 'ls' })
    expect(
      call('memory_update', { id, kind: 'specific', key: 'k', value: 'v2', reason: 'moved' })
    ).toEqual({
      kind: 'result',
      text: 'Updated.',
      isError: false
    })
    expect(store.get(id)).toMatchObject({ value: 'v2', check: 'ls' })
    expect(store.versions(id)).toHaveLength(2)
    expect(store.versions(id)[0]).toMatchObject({ by: 'agent', reason: 'moved' })
    call('memory_update', { id, kind: 'specific', key: 'k', value: 'v3', check: null, reason: 'r' })
    expect(store.get(id)?.check).toBeNull()
  })

  it('an update of the other kind is not found', () => {
    const id = saved(specific('k', 'v'))
    expect(call('memory_update', { id, kind: 'fact', title: 't', body: 'b', reason: 'r' })).toEqual(
      {
        kind: 'result',
        text: MEMORY_ERROR.notFound,
        isError: true
      }
    )
  })

  it('mark stale succeeds, and again on a stale item', () => {
    const id = saved(specific('k', 'v'))
    expect(call('memory_mark_stale', { id, reason: 'gone' })).toEqual({
      kind: 'result',
      text: 'Marked stale.',
      isError: false
    })
    expect(store.get(id)?.state).toBe('stale')
    expect(call('memory_mark_stale', { id, reason: 'gone' })).toMatchObject({ isError: false })
  })
})

describe('failures', () => {
  it.each([MEMORY_ERROR.notFound, STORE_WRITE_FAILED, MEMORY_ERROR.readFailed])(
    'a store throw of %s is a refusal with that code',
    (code) => {
      vi.spyOn(store, 'search').mockImplementation(() => {
        throw new Error(code)
      })
      expect(call('memory_search', {})).toEqual({ kind: 'result', text: code, isError: true })
      expect(lines).toEqual([])
    }
  )

  it('an unknown throw is logged by code only and answers not available', () => {
    vi.spyOn(store, 'add').mockImplementation(() => {
      throw new Error(`boom ${SECRET}`)
    })
    expect(call('memory_save', specific('k', SECRET))).toEqual({
      kind: 'result',
      text: MEMORY_NOT_AVAILABLE,
      code: 'memory_not_available',
      isError: true
    })
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_tool_failed'])
  })

  it('a throwing session lookup does not escape', () => {
    tools = createMemoryTools({
      enabled: () => true,
      store: () => store,
      session: () => {
        throw new Error('x')
      },
      names: { tagIdsByName: () => [], tagName: () => null, goalIdsByName: () => [] },
      activity,
      now: () => NOW,
      log: (line) => {
        lines.push(line)
      }
    })
    expect(call('memory_search', {})).toMatchObject({ text: MEMORY_NOT_AVAILABLE })
  })
})

describe('activity', () => {
  it('records pulled, saved, updated and marked_stale with ids only', () => {
    const id = saved(specific('k', SECRET))
    call('memory_search', { query: SECRET })
    call('memory_get', { id })
    call('memory_update', { id, kind: 'specific', key: 'k', value: SECRET + '2', reason: SECRET })
    call('memory_mark_stale', { id, reason: SECRET })
    call('memory_get', { id: 'nope' })
    const { entries } = activity.get('s1')
    expect(entries).toEqual([
      { at: NOW, action: 'saved', tool: 'memory_save', itemId: id },
      { at: NOW, action: 'pulled', tool: 'memory_search', itemId: null },
      { at: NOW, action: 'pulled', tool: 'memory_get', itemId: id },
      { at: NOW, action: 'updated', tool: 'memory_update', itemId: id },
      { at: NOW, action: 'marked_stale', tool: 'memory_mark_stale', itemId: id }
    ])
    expect(JSON.stringify(entries)).not.toContain(SECRET)
  })
})
