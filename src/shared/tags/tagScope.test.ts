import { describe, it, expect } from 'vitest'
import { isTagVisibleIn, keepVisibleTags, sameTagSet, visibleTags } from './tagScope'

const GLOBAL = { id: 'g', workspaceId: null }
const IN_A = { id: 'a', workspaceId: 'wa' }
const IN_B = { id: 'b', workspaceId: 'wb' }
const lookup = (id: string): { workspaceId: string | null } | null =>
  [GLOBAL, IN_A, IN_B].find((t) => t.id === id) ?? null

describe('isTagVisibleIn / visibleTags (T-11)', () => {
  it('a global tag is visible everywhere; a scoped tag only in its own workspace', () => {
    expect(isTagVisibleIn(GLOBAL, 'wa')).toBe(true)
    expect(isTagVisibleIn(IN_A, 'wa')).toBe(true)
    expect(isTagVisibleIn(IN_A, 'wb')).toBe(false)
    expect(visibleTags([GLOBAL, IN_A, IN_B], 'wb')).toEqual([GLOBAL, IN_B])
  })
})

describe('keepVisibleTags (the T-9 move drop and catalog pruning)', () => {
  it('moving A → B drops the A tags and keeps the global ones, in the card order', () => {
    expect(keepVisibleTags(['a', 'g'], 'wb', lookup)).toEqual(['g'])
  })

  it('drops an id the catalog no longer knows (a deleted tag)', () => {
    expect(keepVisibleTags(['g', 'gone'], 'wa', lookup)).toEqual(['g'])
  })
})

describe('sameTagSet', () => {
  it('ignores order, not membership', () => {
    expect(sameTagSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameTagSet(['a'], ['a', 'b'])).toBe(false)
    expect(sameTagSet(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})
