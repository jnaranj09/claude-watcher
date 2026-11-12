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

  it("finds the workspace's goals by exact name, any case", () => {
    expect(names.goalIdsByName('w1', 'SHIP V2')).toEqual(['g1'])
  })

  it('finds nothing for a name that only starts the same', () => {
    expect(names.goalIdsByName('w1', 'ship')).toEqual([])
    expect(names.tagIdsByName('w1', 'infr')).toEqual([])
  })
})
