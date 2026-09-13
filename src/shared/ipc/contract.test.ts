import { describe, it, expect } from 'vitest'
import { CH } from './contract'

describe('the CH channel registry', () => {
  it('has no duplicate channel names (a duplicate would cross-wire two handlers)', () => {
    const values = Object.values(CH)
    expect(new Set(values).size).toBe(values.length)
  })

  it('names the tag channels domain:action', () => {
    expect(CH.tagsList).toBe('tags:list')
    expect(CH.tagsSave).toBe('tags:save')
    expect(CH.tagsDelete).toBe('tags:delete')
    expect(CH.sessionSetTags).toBe('session:set-tags')
  })

  it('names the rule channels domain:action', () => {
    expect(CH.rulesList).toBe('rules:list')
    expect(CH.rulesSave).toBe('rules:save')
    expect(CH.rulesDelete).toBe('rules:delete')
    expect(CH.rulesMove).toBe('rules:move')
  })
})
