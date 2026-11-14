// The memory mod's four routes (memory phase 3 addendum §3): each body through its own `.strict()`
// schema, the grant from the token only, a slow handler logged by name and code. A fake
// MemoryRecall records its calls and answers a fixed value per method.
import { describe, it, expect, beforeEach } from 'vitest'
import { modMemoryRoutes } from './modMemoryRoutes'
import { MOD_MEMORY_PATHS } from '../hooks/hookContract'
import type { TokenRoute } from '../hooks/hookServer'
import type { MemoryRecall } from './memoryRecall'
import type { MemoryGrant } from './memoryTools'
import type {
  ModMemoryIndexAnswer,
  ModMemoryRememberAnswer,
  ModMemoryTextAnswer
} from '../../shared/schemas/modMemory'

let calls: unknown[][]
let log: string[]
let routes: TokenRoute[]
let clock: number[]

const ANSWERS: {
  index: ModMemoryIndexAnswer
  recall: ModMemoryTextAnswer
  atUse: ModMemoryTextAnswer
  remember: ModMemoryRememberAnswer
} = {
  index: { ok: true, text: 'I', folders: [] },
  recall: { ok: true, text: '' },
  atUse: { ok: true, text: 'A' },
  remember: { ok: true, kind: 'fact', id: 'm1' }
}

function fakeRecall(): MemoryRecall {
  return {
    launched: () => {},
    index: (grant, req) => {
      calls.push(['index', grant, req])
      return ANSWERS.index
    },
    recall: (grant, req) => {
      calls.push(['recall', grant, req])
      return ANSWERS.recall
    },
    atUse: (grant, req) => {
      calls.push(['atUse', grant, req])
      return ANSWERS.atUse
    },
    remember: (grant, req) => {
      calls.push(['remember', grant, req])
      return ANSWERS.remember
    },
    rebind: () => {},
    forget: () => {}
  }
}

function build(): void {
  routes = modMemoryRoutes({
    tokens: {
      resolve: (t: string): MemoryGrant | null => (t === 't1' ? { sessionId: 's1' } : null)
    },
    recall: fakeRecall(),
    now: () => clock.shift() ?? 0,
    log: (l) => log.push(l)
  })
}

beforeEach(() => {
  calls = []
  log = []
  clock = []
  build()
})

function route(path: string): TokenRoute {
  const found = routes.find((r) => r.path === path)
  if (found === undefined) throw new Error(`no route ${path}`)
  return found
}

const BODIES = {
  index: { version: 1, window: 0 },
  recall: { version: 1, window: 0, origin: 'composer', text: 'port' },
  atUse: { version: 1, window: 0, folders: ['/work/app'] },
  remember: { version: 1, origin: 'composer', text: 'the port is 8080' }
}

describe('modMemoryRoutes', () => {
  it('serves the four paths of the contract', () => {
    expect(routes.map((r) => r.path).sort()).toEqual(Object.values(MOD_MEMORY_PATHS).sort())
    expect(MOD_MEMORY_PATHS).toEqual({
      index: '/mod/memory/index',
      recall: '/mod/memory/recall',
      atUse: '/mod/memory/at-use',
      remember: '/mod/memory/remember'
    })
  })

  it("each path reaches its own method with the token's grant", () => {
    const answers = (['index', 'recall', 'atUse', 'remember'] as const).map((k) =>
      route(MOD_MEMORY_PATHS[k]).open('Bearer t1')?.(BODIES[k])
    )
    expect(calls).toEqual([
      ['index', { sessionId: 's1' }, BODIES.index],
      ['recall', { sessionId: 's1' }, BODIES.recall],
      ['atUse', { sessionId: 's1' }, BODIES.atUse],
      ['remember', { sessionId: 's1' }, BODIES.remember]
    ])
    expect(answers).toEqual([
      { status: 200, body: ANSWERS.index },
      { status: 200, body: ANSWERS.recall },
      { status: 200, body: ANSWERS.atUse },
      { status: 200, body: ANSWERS.remember }
    ])
  })

  it('no body field names a session: the grant comes from the token', () => {
    const handle = route(MOD_MEMORY_PATHS.recall).open('Bearer t1')
    const body = { version: 1, window: 0, origin: 'composer', text: 'port' }
    expect([handle?.(body), handle?.({ ...body, sessionId: 's2' })]).toEqual([
      { status: 200, body: { ok: true, text: '' } },
      { status: 400, path: '(root)', code: 'unrecognized_keys' }
    ])
    expect(calls).toEqual([['recall', { sessionId: 's1' }, body]])
  })

  it("a bad body is a 400 with the issue's path and code, and the method is not called", () => {
    expect(
      route(MOD_MEMORY_PATHS.atUse).open('Bearer t1')?.({ version: 1, window: 0, folders: [] })
    ).toEqual({ status: 400, path: 'folders', code: 'too_small' })
    expect(calls).toEqual([])
  })

  it('a token of no live session opens nothing', () => {
    expect(route(MOD_MEMORY_PATHS.index).open('Bearer nope')).toBeNull()
  })

  it('a header that is not a Bearer opens nothing', () => {
    expect([
      route(MOD_MEMORY_PATHS.index).open('t1'),
      route(MOD_MEMORY_PATHS.index).open(undefined)
    ]).toEqual([null, null])
  })

  it("a route's log line carries memory's prefix", () => {
    route(MOD_MEMORY_PATHS.recall).log('route=mod_memory code=unauthorized')
    expect(log).toEqual(['[claude-watcher][memory] route=mod_memory code=unauthorized'])
  })

  it('a handler slower than 250 ms logs mod_memory_slow with its name and nothing else', () => {
    clock = [0, 300]
    route(MOD_MEMORY_PATHS.recall).open('Bearer t1')?.(BODIES.recall)
    expect(log).toEqual([
      '[claude-watcher][memory] route=mod_memory name=recall code=mod_memory_slow'
    ])
  })

  it('a slow at-use handler logs the name at_use', () => {
    clock = [0, 251]
    route(MOD_MEMORY_PATHS.atUse).open('Bearer t1')?.(BODIES.atUse)
    expect(log).toEqual([
      '[claude-watcher][memory] route=mod_memory name=at_use code=mod_memory_slow'
    ])
  })

  it('a handler of 250 ms or less logs nothing', () => {
    clock = [0, 250]
    route(MOD_MEMORY_PATHS.recall).open('Bearer t1')?.(BODIES.recall)
    expect(log).toEqual([])
  })
})
