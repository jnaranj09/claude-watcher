// A memory filter names tags and goals; the store matches ids. A name resolves to every tag the
// workspace sees (its own and global) and every goal of the workspace, ignoring case.
import { describe, expect, it } from 'vitest'
import { memoryNameLookups } from './memoryNames'

const names = memoryNameLookups({
  tags: () => [
    { id: 't1', name: 'Infra', workspaceId: 'w1' },
    { id: 't2', name: 'infra', workspaceId: null },
    { id: 't3', name: 'Infra', workspaceId: 'w2' },
    { id: 't4', name: 'Infrastructure', workspaceId: 'w1' }
  ],
  goals: () => [
    { id: 'g1', name: 'Ship v2', workspaceId: 'w1' },
    { id: 'g2', name: 'ship V2', workspaceId: 'w2' },
    { id: 'g3', name: 'Ship v2 docs', workspaceId: 'w1' }
  ]
})

describe('memoryNameLookups', () => {
  it("finds the workspace's tags and global tags by exact name, any case", () => {
    expect(names.tagIdsByName('w1', 'INFRA')).toEqual(['t1', 't2'])
  })

  it("never finds another workspace's tag", () => {
    expect(names.tagIdsByName('w3', 'infra')).toEqual(['t2'])
  })

  it("finds the workspace's goals by part of the name, any case", () => {
    expect(names.goalIdsByName('w1', ' SHIP V2 ')).toEqual(['g1', 'g3'])
    expect(names.goalIdsByName('w1', 'docs')).toEqual(['g3'])
  })

  it('finds no tag for a name that only starts the same', () => {
    expect(names.tagIdsByName('w1', 'infr')).toEqual([])
  })

  it('finds a goal for a name that only starts the same', () => {
    expect(names.goalIdsByName('w1', 'ship')).toEqual(['g1', 'g3'])
  })

  it('finds nothing for an empty or blank name', () => {
    expect(names.goalIdsByName('w1', '')).toEqual([])
    expect(names.goalIdsByName('w1', '   ')).toEqual([])
    expect(names.tagIdsByName('w1', '')).toEqual([])
    expect(names.tagIdsByName('w1', '   ')).toEqual([])
  })

  it('names a tag by its id, and a deleted tag by nothing', () => {
    expect(names.tagName('t3')).toBe('Infra')
    expect(names.tagName('gone')).toBeNull()
  })

  it('names a goal by its id, and a deleted goal by nothing', () => {
    expect(names.goalName('g2')).toBe('ship V2')
    expect(names.goalName('gone')).toBeNull()
  })

  it('contextFits takes a goal of the workspace and tags of the workspace or global', () => {
    expect(names.contextFits('w1', { goalId: 'g1', tagIds: ['t1', 't2'] })).toBe(true)
    expect(names.contextFits('w1', { goalId: null, tagIds: [] })).toBe(true)
  })

  it("contextFits refuses another workspace's goal or tag, and an id that is gone", () => {
    expect(names.contextFits('w1', { goalId: 'g2', tagIds: [] })).toBe(false)
    expect(names.contextFits('w1', { goalId: null, tagIds: ['t3'] })).toBe(false)
    expect(names.contextFits('w1', { goalId: 'gone', tagIds: [] })).toBe(false)
    expect(names.contextFits('w1', { goalId: null, tagIds: ['t1', 'gone'] })).toBe(false)
  })

  it('contextFits gives a global item no goal and only global tags', () => {
    expect(names.contextFits(null, { goalId: null, tagIds: ['t2'] })).toBe(true)
    expect(names.contextFits(null, { goalId: 'g1', tagIds: [] })).toBe(false)
    expect(names.contextFits(null, { goalId: null, tagIds: ['t1'] })).toBe(false)
  })
})
