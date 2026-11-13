// Which channel each `window.memory` bridge calls (the preload is the other half of the
// registrar's binding, registerStoreIpc.memory.test.ts): a swapped channel goes red here. And the
// result push's hold in the preload (rulings R39, R43).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CH, type Channel } from '../shared/ipc/contract'
import { NO_COUNTS, type MemoryExtractResult } from '../shared/schemas/memory'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: ipc
}))

type MemoryBridge = Window['memory']
let memory: MemoryBridge
type PushListener = (evt: unknown, payload: unknown) => void
/** The result listener the preload added while it loaded, and how many it added. */
let startListener: PushListener | undefined
let startResultListens = 0

beforeAll(async () => {
  // jsdom has no `process.contextIsolated`, so the preload takes its assignment branch.
  await import('./index')
  memory = window.memory
  const calls = (ipc.on.mock.calls as unknown as [Channel, PushListener][]).filter(
    ([channel]) => channel === CH.memoryExtractResult
  )
  startResultListens = calls.length
  startListener = calls[0]?.[1]
})

/** The channel and argument of the one invoke `run` made. */
async function invoked(run: () => Promise<unknown>): Promise<[Channel, unknown]> {
  ipc.invoke.mockClear()
  await run()
  expect(ipc.invoke).toHaveBeenCalledTimes(1)
  const [channel, arg] = ipc.invoke.mock.calls[0] as unknown as [Channel, unknown]
  return [channel, arg]
}

const PORT = { kind: 'specific', key: 'API port', value: '9280' } as const

describe('window.memory calls its own channel', () => {
  it.each<[string, () => Promise<unknown>, Channel]>([
    [
      'list',
      () =>
        memory.list({
          workspaceId: 'w1',
          includeGlobal: true,
          kind: 'specific',
          query: null,
          filters: {},
          offset: 0,
          limit: 50
        }),
      CH.memoryList
    ],
    ['get', () => memory.get('m1'), CH.memoryGet],
    [
      'create',
      () => memory.create({ workspaceId: 'w1', text: PORT, check: null }),
      CH.memoryCreate
    ],
    ['edit', () => memory.edit({ id: 'm1', text: PORT, check: null }), CH.memoryEdit],
    ['setState', () => memory.setState('m1', 'stale'), CH.memorySetState],
    ['setPinned', () => memory.setPinned('m1', true), CH.memorySetPinned],
    ['remove', () => memory.remove('m1'), CH.memoryDelete],
    ['restore', () => memory.restore('m1', 5), CH.memoryRestore],
    ['activity', () => memory.activity('s1'), CH.memoryActivity],
    ['sessionCount', () => memory.sessionCount('s1'), CH.memorySessionCount],
    ['removeSession', () => memory.removeSession('s1'), CH.memoryDeleteSession],
    [
      'commands',
      () => memory.commands({ workspaceId: 'w1', query: null, offset: 0, limit: 50 }),
      CH.memoryCommands
    ],
    ['removeCommand', () => memory.removeCommand('c1'), CH.memoryDeleteCommand]
  ])('%s', async (_name, run, channel) => {
    const [got] = await invoked(run)
    expect(got).toBe(channel)
  })

  it('removeCommand sends the id as `{ id }`', async () => {
    expect((await invoked(() => memory.removeCommand('c1')))[1]).toEqual({ id: 'c1' })
  })

  it('onChanged listens on its own push', () => {
    ipc.on.mockClear()
    memory.onChanged(() => undefined)
    expect(ipc.on.mock.calls.map(([channel]) => channel)).toEqual([CH.memoryChanged])
  })
})

// Rulings R39, R43: the result push must not wait for React. The preload listens from its start
// and holds what arrives (opaque plain objects; the renderer parses them) until the renderer
// subscribes, then hands each result over once, in order.
describe('window.memory.onExtractResult holds results until the renderer subscribes', () => {
  const result = (n: number): MemoryExtractResult => ({
    sessionName: `session ${n}`,
    trigger: 'catchup',
    outcome: 'saved',
    counts: { ...NO_COUNTS, facts: n },
    reason: null
  })
  /** Main's push on CH.memoryExtractResult, through the listener the preload added at start. */
  const fromMain = (payload: unknown): void => {
    const listener = startListener
    if (listener === undefined) throw new Error('the preload never listened at start')
    listener({}, payload)
  }
  /** Subscribes a collector and returns what it got plus the unsubscribe. */
  function subscribe(): { got: object[]; off: () => void } {
    const got: object[] = []
    const off = memory.onExtractResult((r) => got.push(r))
    return { got, off }
  }
  /** Each test starts with nothing held: a collector takes whatever an earlier test left. */
  function drain(): void {
    subscribe().off()
  }

  it('listens on the result push at preload start, once, and a subscribe adds no listener', () => {
    expect(startListener).toBeTypeOf('function')
    expect(startResultListens).toBe(1)
    ipc.on.mockClear()
    const { off } = subscribe()
    off()
    expect(ipc.on).not.toHaveBeenCalled()
  })

  it('gives results that came before the subscribe once, in order, then later ones at once', () => {
    drain()
    fromMain(result(1))
    fromMain(result(2))
    const first = subscribe()
    expect(first.got).toEqual([result(1), result(2)])
    fromMain(result(3))
    expect(first.got).toEqual([result(1), result(2), result(3)])
    first.off()
  })

  it('an unsubscribe and a subscribe again (strict mode, a remount) loses nothing and repeats nothing', () => {
    drain()
    const first = subscribe()
    fromMain(result(1))
    first.off()
    fromMain(result(2))
    const second = subscribe()
    fromMain(result(3))
    expect(first.got).toEqual([result(1)])
    expect(second.got).toEqual([result(2), result(3)])
    second.off()
  })

  it('holds the newest 50 and says it dropped the oldest', () => {
    drain()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let n = 1; n <= 52; n += 1) fromMain(result(n))
    const { got, off } = subscribe()
    off()
    expect(got).toEqual(Array.from({ length: 50 }, (_, i) => result(i + 3)))
    expect(warn.mock.calls).toEqual([
      ['[claude-watcher][memory] code=memory_extract_result_held_dropped'],
      ['[claude-watcher][memory] code=memory_extract_result_held_dropped']
    ])
    warn.mockRestore()
  })

  it.each<[string, unknown]>([
    ['a string', 'x'],
    ['null', null],
    ['an array', [1, 2]],
    ['a number', 7]
  ])('drops %s (not a plain object) with a code only, never the value', (_name, payload) => {
    drain()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    fromMain(payload)
    const { got, off } = subscribe()
    fromMain(payload)
    off()
    expect(got).toEqual([])
    expect(warn.mock.calls).toEqual([
      ['[claude-watcher][memory] code=memory_extract_result_invalid issue=not_object'],
      ['[claude-watcher][memory] code=memory_extract_result_invalid issue=not_object']
    ])
    warn.mockRestore()
  })

  it("hands an object over as it came: the schema check is the renderer's (R43)", () => {
    drain()
    const odd = { ...result(1), counts: { ...NO_COUNTS, tasks: -1 } }
    fromMain(odd)
    const { got, off } = subscribe()
    off()
    expect(got).toEqual([odd])
  })
})
