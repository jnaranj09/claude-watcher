// Which `CH.memory*` channel the registrar binds each memory handler to: every invoke runs on a
// real `:memory:` store, with a request only the right handler accepts or an effect only it has,
// so a swapped channel goes red here instead of in a drive run.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CH, type Channel } from '../../shared/ipc/contract'
import type { MemoryText } from '../../shared/schemas/memory'
import { createMemoryActivity } from '../memory/memoryActivity'
import { createMemoryCommands, type MemoryCommands } from '../memory/memoryCommands'
import { openMemoryDb } from '../memory/memoryDb'
import { createMemoryStore, type MemoryStore } from '../memory/memoryStore'
import { createStoreIpc, type StoreIpcDeps } from './registerStoreIpc'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {}, shell: {} }))

const PORT: MemoryText = { kind: 'specific', key: 'API port', value: '9280' }
type Listener = (event: unknown, ...args: unknown[]) => unknown

let store: MemoryStore
let commands: MemoryCommands
let handlers: Map<Channel, Listener>
const call = (channel: Channel, raw: unknown): unknown => {
  const listener = handlers.get(channel)
  if (listener === undefined) throw new Error(`nothing bound to ${channel}`)
  return listener({}, raw)
}

beforeEach(() => {
  const open = openMemoryDb(':memory:', { now: () => 1, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  let ids = 0
  let clock = 1_762_800_000_000
  store = createMemoryStore({
    db: open.db,
    now: () => ++clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
  commands = createMemoryCommands({ db: open.db, newId: () => `c${++ids}` })
  handlers = new Map()
  const deps = {
    ipc: {
      handle: (channel: Channel, listener: Listener) => handlers.set(channel, listener),
      on: () => undefined
    },
    getMemoryStore: () => store,
    getMemoryCommands: () => commands,
    memoryNames: { tagIdsByName: () => [], goalIdsByName: () => [], tagName: () => null },
    memoryActivity: createMemoryActivity(() => undefined)
  }
  // Only the memory registrar runs: it reads nothing else from the deps.
  createStoreIpc(deps as unknown as StoreIpcDeps).registerMemoryIpc()
})

const LIST = {
  workspaceId: 'w1',
  includeGlobal: true,
  kind: 'specific',
  query: null,
  filters: {},
  offset: 0,
  limit: 50
}

describe('registerMemoryIpc binds each handler to its own channel', () => {
  it('binds exactly the memory channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        CH.memoryList,
        CH.memoryGet,
        CH.memoryCreate,
        CH.memoryEdit,
        CH.memorySetState,
        CH.memorySetPinned,
        CH.memoryDelete,
        CH.memoryRestore,
        CH.memoryActivity,
        CH.memorySessionCount,
        CH.memoryDeleteSession,
        CH.memoryCommands,
        CH.memoryDeleteCommand
      ].sort()
    )
  })

  it('items: create, list, get, edit, set-state, set-pinned, restore, delete', () => {
    const made = call(CH.memoryCreate, { workspaceId: 'w1', text: PORT, check: null })
    expect(made).toMatchObject({ key: 'API port' })
    const { id } = made as { id: string }
    expect(call(CH.memoryList, LIST)).toMatchObject({ total: 1 })
    expect(call(CH.memoryGet, { id })).toMatchObject({ item: { id } })
    expect(
      call(CH.memoryEdit, { id, text: { ...PORT, value: '9281' }, check: null })
    ).toMatchObject({ value: '9281' })
    expect(call(CH.memorySetState, { id, state: 'stale' })).toMatchObject({ state: 'stale' })
    expect(call(CH.memorySetPinned, { id, pinned: true })).toMatchObject({ pinned: true })
    const first = store.versions(id).at(-1)?.at ?? 0
    expect(call(CH.memoryRestore, { id, versionAt: first })).toMatchObject({ value: '9280' })
    call(CH.memoryDelete, { id })
    expect(store.get(id)).toBeNull()
  })

  it("a session's items: activity, session-count, delete-session", () => {
    expect(call(CH.memoryActivity, { sessionId: 's1' })).toEqual({ injected: null, entries: [] })
    store.add({
      text: PORT,
      workspaceId: 'w1',
      check: null,
      basis: 'inferred',
      origin: { by: 'agent', sessionId: 's1' },
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
    expect(call(CH.memorySessionCount, { sessionId: 's1' })).toBe(1)
    expect(store.countBySession('s1')).toBe(1)
    expect(call(CH.memoryDeleteSession, { sessionId: 's1' })).toBe(1)
    expect(store.countBySession('s1')).toBe(0)
  })

  it('commands: the list and the delete', () => {
    commands.record({
      workspaceId: 'w1',
      folder: '/work/demo',
      text: 'npm test',
      sessionId: 's1',
      at: 1
    })
    const page = call(CH.memoryCommands, { workspaceId: 'w1', query: null, offset: 0, limit: 50 })
    expect(page).toMatchObject({ total: 1 })
    const id = commands.list('w1', { query: null, folder: null, offset: 0, limit: 50 }).rows[0]?.id
    call(CH.memoryDeleteCommand, { id })
    expect(commands.list('w1', { query: null, folder: null, offset: 0, limit: 50 }).total).toBe(0)
  })
})
