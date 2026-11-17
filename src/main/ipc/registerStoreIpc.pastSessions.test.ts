// Which `CH.pastSession*` channel the registrar binds each past-sessions handler to: every invoke
// runs on a real in-memory store, with an effect only the right handler has, so a swapped channel
// goes red here instead of in a drive run.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CH, type Channel } from '../../shared/ipc/contract'
import { createPastSessionsStore } from '../persistence/pastSessions'
import { createTagsStore } from '../persistence/tags'
import { createStoreIpc, type StoreIpcDeps } from './registerStoreIpc'

vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, dialog: {}, shell: {} }))

type Listener = (event: unknown, ...args: unknown[]) => unknown

const ROW = {
  id: 's1',
  name: 'a',
  cwd: '/c',
  workspaceId: 'default',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
}

let handlers: Map<Channel, Listener>
const call = (channel: Channel, raw?: unknown): unknown => {
  const listener = handlers.get(channel)
  if (listener === undefined) throw new Error(`nothing bound to ${channel}`)
  return listener({}, raw)
}

beforeEach(() => {
  const store = createPastSessionsStore()
  store.archive(ROW)
  const tags = createTagsStore({ newId: () => 't1' })
  tags.save({ name: 'global', color: 'slate', workspaceId: null })
  handlers = new Map()
  const deps = {
    ipc: {
      handle: (channel: Channel, listener: Listener) => handlers.set(channel, listener),
      on: () => undefined
    },
    requirePastSessionsStore: () => store,
    requireTagsStore: () => tags
  }
  // Only the past-sessions registrar runs: it reads nothing else from the deps.
  createStoreIpc(deps as unknown as StoreIpcDeps).registerPastSessionsIpc()
})

describe('registerPastSessionsIpc binds each handler to its own channel', () => {
  it('binds exactly list, forget and set-tags', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [CH.pastSessionsList, CH.pastSessionsForget, CH.pastSessionSetTags].sort()
    )
  })

  it('list returns the records', () => {
    expect(call(CH.pastSessionsList)).toEqual([ROW])
  })

  it('set-tags sets the record tags and answers the list', () => {
    expect(call(CH.pastSessionSetTags, { id: 's1', tagIds: ['t1'] })).toEqual([
      { ...ROW, tagIds: ['t1'] }
    ])
  })

  it('forget removes the record and answers the rest', () => {
    expect(call(CH.pastSessionsForget, { id: 's1' })).toEqual([])
    expect(call(CH.pastSessionsList)).toEqual([])
  })
})
