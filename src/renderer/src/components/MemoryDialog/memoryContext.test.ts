// Where the Memory form places an item (spec 2026-11-14 memory context index §8): what Folder
// offers, where a New form starts, what Global clears, and what an edit sends.
import { describe, expect, it } from 'vitest'
import { specificItem } from '../../test/memoryBridge'
import { contextPatch, draftFromFilters, offeredFolders, rescopeContext } from './memoryContext'

const META = {
  folder: '/work/app',
  sessionName: null,
  tagIds: ['t1'],
  templateId: null,
  goalId: 'g1',
  taskIds: []
}

describe('memoryContext', () => {
  it('offeredFolders keeps the order and drops repeats and nulls', () => {
    expect(
      offeredFolders({
        stored: '/gone',
        filter: '/work/app',
        goals: ['/work/app', null, '/work/shop'],
        workspace: '/work',
        sessions: ['/work/shop'],
        listed: ['/work/app', '/z']
      })
    ).toEqual(['/gone', '/work/app', '/work/shop', '/work', '/z'])
  })

  it('draftFromFilters takes the first folder and goal and the offered tags only', () => {
    expect(
      draftFromFilters(
        { folders: ['/work/app'], goalIds: ['g1'], tagIds: ['t1', 'hidden'] },
        { goalIds: new Set(['g1']), tagIds: new Set(['t1']) }
      )
    ).toEqual({ folder: '/work/app', goalId: 'g1', tagIds: ['t1'] })
  })

  it('with no filter on, a new item starts with no folder, no goal and no tags', () => {
    expect(
      draftFromFilters(
        { folders: [], goalIds: [], tagIds: [] },
        { goalIds: new Set(['g1']), tagIds: new Set(['t1']) }
      )
    ).toEqual({ folder: null, goalId: null, tagIds: [] })
  })

  it('draftFromFilters leaves out a goal that is not offered', () => {
    expect(
      draftFromFilters(
        { folders: [], goalIds: ['gone'], tagIds: [] },
        { goalIds: new Set(['g1']), tagIds: new Set() }
      ).goalId
    ).toBeNull()
  })

  it('rescopeContext clears the goal and the tags a global item cannot hold', () => {
    expect(
      rescopeContext({ folder: '/work/app', goalId: 'g1', tagIds: ['t1', 't2'] }, new Set(['t2']))
    ).toEqual({ folder: '/work/app', goalId: null, tagIds: ['t2'] })
  })

  it('contextPatch sends only what changed, and null when nothing did', () => {
    const item = specificItem({ meta: META })
    const drawn = new Set(['t1'])
    expect(contextPatch(item, { folder: '/x', goalId: 'g1', tagIds: ['t1'] }, drawn)).toEqual({
      folder: '/x'
    })
    expect(
      contextPatch(item, { folder: '/work/app', goalId: 'g2', tagIds: ['t1'] }, drawn)
    ).toEqual({ goalId: 'g2' })
    expect(
      contextPatch(item, { folder: '/work/app', goalId: 'g1', tagIds: ['t1'] }, drawn)
    ).toBeNull()
  })

  it('contextPatch keeps a stored tag the form could not draw', () => {
    const item = specificItem({ meta: { ...META, tagIds: ['gone', 't1'] } })
    expect(
      contextPatch(
        item,
        { folder: '/work/app', goalId: 'g1', tagIds: ['t1', 't2'] },
        new Set(['t1'])
      )
    ).toEqual({ tagIds: ['gone', 't1', 't2'] })
  })

  it('contextPatch sends no tags when only their order differs', () => {
    const item = specificItem({ meta: { ...META, tagIds: ['t2', 't1'] } })
    expect(
      contextPatch(
        item,
        { folder: '/work/app', goalId: 'g1', tagIds: ['t1', 't2'] },
        new Set(['t1', 't2'])
      )
    ).toBeNull()
  })
})
