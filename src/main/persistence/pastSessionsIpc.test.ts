import { describe, it, expect } from 'vitest'
import { createPastSessionsStore } from './pastSessions'
import { createTagsStore } from './tags'
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
    const h = createPastSessionsIpcHandlers(store, createTagsStore())
    expect(h.list()).toEqual([])
    store.archive(ROW)
    expect(h.list()).toEqual([ROW])
  })
  it('forget parses { id }, returns the remaining list; a malformed arg throws and mutates nothing', () => {
    const store = createPastSessionsStore()
    store.archive(ROW)
    const h = createPastSessionsIpcHandlers(store, createTagsStore())
    expect(() => h.forget({ id: '' })).toThrow()
    expect(() => h.forget('s1')).toThrow()
    expect(h.list()).toEqual([ROW])
    expect(h.forget({ id: 's1' })).toEqual([])
  })
})

describe('past-sessions setTags handler', () => {
  function setup(): ReturnType<typeof createPastSessionsIpcHandlers> & {
    store: ReturnType<typeof createPastSessionsStore>
  } {
    let n = 0
    const tags = createTagsStore({ newId: () => `t${++n}` })
    tags.save({ name: 'global', color: 'slate', workspaceId: null }) // t1
    tags.save({ name: 'in-other', color: 'blue', workspaceId: 'other' }) // t2
    const store = createPastSessionsStore()
    store.archive(ROW)
    return { ...createPastSessionsIpcHandlers(store, tags), store }
  }
  it('refuses an out-of-scope tag with tag_out_of_scope', () => {
    const h = setup()
    expect(() => h.setTags({ id: 's1', tagIds: ['t2'] })).toThrow('tag_out_of_scope')
    expect(h.store.get('s1')?.tagIds).toEqual([])
  })
  it('refuses an unknown tag with tag_not_found', () => {
    expect(() => setup().setTags({ id: 's1', tagIds: ['ghost'] })).toThrow('tag_not_found')
  })
  it('refuses an unknown record with not_found', () => {
    expect(() => setup().setTags({ id: 'zz', tagIds: ['t1'] })).toThrow('not_found')
  })
  it('a live record is not_found, checked before the tags (an unknown tag does not change it)', () => {
    const h = setup()
    h.store.markLive({ ...ROW, id: 'live1' })
    expect(() => h.setTags({ id: 'live1', tagIds: ['ghost'] })).toThrow('not_found')
    expect(() => h.setTags({ id: 'live1', tagIds: ['t1'] })).toThrow('not_found')
  })
  it('collapses duplicate ids', () => {
    const h = setup()
    expect(h.setTags({ id: 's1', tagIds: ['t1', 't1'] })[0]?.tagIds).toEqual(['t1'])
  })
})
