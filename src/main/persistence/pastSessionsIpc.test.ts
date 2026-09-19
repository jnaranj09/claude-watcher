import { describe, it, expect } from 'vitest'
import { createPastSessionsStore } from './pastSessions'
import { createPastSessionsIpcHandlers } from './pastSessionsIpc'

const ROW = {
  id: 's1',
  name: 'a',
  cwd: '/c',
  workspaceId: 'default',
  tagIds: [],
  launchedAt: 1,
  endedAt: 2
}

describe('past-sessions IPC handler logic — parse-and-throw on the arg', () => {
  it('list returns the store list directly (no envelope)', () => {
    const store = createPastSessionsStore()
    const h = createPastSessionsIpcHandlers(store)
    expect(h.list()).toEqual([])
    store.archive(ROW)
    expect(h.list()).toEqual([ROW])
  })
  it('forget parses { id }, returns the remaining list; a malformed arg throws and mutates nothing', () => {
    const store = createPastSessionsStore()
    store.archive(ROW)
    const h = createPastSessionsIpcHandlers(store)
    expect(() => h.forget({ id: '' })).toThrow()
    expect(() => h.forget('s1')).toThrow()
    expect(h.list()).toEqual([ROW])
    expect(h.forget({ id: 's1' })).toEqual([])
  })
})
