// Which channel each `window.memory` bridge calls (the preload is the other half of the
// registrar's binding, registerStoreIpc.memory.test.ts): a swapped channel goes red here.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CH, type Channel } from '../shared/ipc/contract'

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

beforeAll(async () => {
  // jsdom has no `process.contextIsolated`, so the preload takes its assignment branch.
  await import('./index')
  memory = window.memory
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

  it('onChanged and onExtractResult listen on their own pushes', () => {
    ipc.on.mockClear()
    memory.onChanged(() => undefined)
    memory.onExtractResult(() => undefined)
    expect(ipc.on.mock.calls.map(([channel]) => channel)).toEqual([
      CH.memoryChanged,
      CH.memoryExtractResult
    ])
  })
})
