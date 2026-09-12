import { describe, it, expect } from 'vitest'
import { createTagsStore, TAG_ERROR } from './tags'
import { createTagsIpcHandlers, parseSessionSetTags, staleTagEdits } from './tagsIpc'
import { launchedSession } from '../../__fixtures__/fakeSessions'

function storeWithTags(): ReturnType<typeof createTagsStore> {
  let n = 0
  const store = createTagsStore({ newId: () => `t${++n}` })
  store.save({ name: 'global', color: 'slate', workspaceId: null }) // t1
  store.save({ name: 'in-a', color: 'blue', workspaceId: 'wa' }) // t2
  return store
}

describe('tags IPC handler logic — parse-and-throw on the arg (untrusted cross-process input)', () => {
  it('list / save / remove go through the store and return values directly', () => {
    const h = createTagsIpcHandlers(createTagsStore({ newId: () => 'id-1' }))
    expect(h.list()).toEqual([])
    expect(h.save({ name: '  prod ', color: 'rose', workspaceId: null })).toEqual({
      saved: { id: 'id-1', name: 'prod', color: 'rose', workspaceId: null },
      tags: [{ id: 'id-1', name: 'prod', color: 'rose', workspaceId: null }]
    })
    expect(h.remove({ id: 'id-1' })).toEqual([])
  })

  it('a MALFORMED arg throws and does NOT mutate', () => {
    const h = createTagsIpcHandlers(createTagsStore())
    expect(() => h.save({ name: 'x', color: 'teal', workspaceId: null })).toThrow()
    expect(() => h.save('nope')).toThrow()
    expect(() => h.remove({ id: '' })).toThrow()
    expect(h.list()).toEqual([])
  })
})

describe('parseSessionSetTags (spec §2.4)', () => {
  it('passes ids that exist and are visible to the card, de-duplicated', () => {
    const store = storeWithTags()
    expect(
      parseSessionSetTags(store, { sessionId: 's1', tagIds: ['t2', 't1', 't2'] }, () => 'wa')
    ).toEqual({ sessionId: 's1', tagIds: ['t2', 't1'] })
  })

  it('refuses an unknown tag', () => {
    expect(() =>
      parseSessionSetTags(storeWithTags(), { sessionId: 's1', tagIds: ['ghost'] }, () => 'wa')
    ).toThrow(TAG_ERROR.notFound)
  })

  it('refuses a tag the card workspace cannot see (T-11)', () => {
    expect(() =>
      parseSessionSetTags(storeWithTags(), { sessionId: 's1', tagIds: ['t2'] }, () => 'wb')
    ).toThrow(TAG_ERROR.outOfScope)
  })

  it('leaves an UNKNOWN session to the reducer (no scope to check against)', () => {
    expect(
      parseSessionSetTags(storeWithTags(), { sessionId: 'gone', tagIds: ['t2'] }, () => undefined)
    ).toEqual({ sessionId: 'gone', tagIds: ['t2'] })
  })

  it('a malformed arg throws before touching the store', () => {
    expect(() => parseSessionSetTags(storeWithTags(), { sessionId: '' }, () => 'wa')).toThrow()
  })
})

describe('staleTagEdits (spec §1.4 — the catalog changed under live cards)', () => {
  it('lists only the cards that lost a tag, each with what it keeps', () => {
    const store = storeWithTags()
    const sessions = [
      launchedSession('keeps', { workspaceId: 'wa', tagIds: ['t1', 't2'] }),
      launchedSession('loses', { workspaceId: 'wb', tagIds: ['t1', 't2'] }),
      launchedSession('deleted', { workspaceId: 'wa', tagIds: ['t9'] })
    ]
    expect(staleTagEdits(sessions, (id) => store.get(id))).toEqual([
      { sessionId: 'loses', tagIds: ['t1'] },
      { sessionId: 'deleted', tagIds: [] }
    ])
  })
})
