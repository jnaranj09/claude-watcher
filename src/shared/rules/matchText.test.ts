import { describe, it, expect } from 'vitest'
import { patternCompiles, textMatches } from './matchText'

describe('textMatches (spec §1.2)', () => {
  it('contains is case-insensitive', () => {
    expect(textMatches({ mode: 'contains', pattern: '/PROD' }, '/home/op/api/prod')).toBe(true)
    expect(textMatches({ mode: 'contains', pattern: 'staging' }, '/home/op/api/prod')).toBe(false)
  })

  it('regex is used as written', () => {
    expect(textMatches({ mode: 'regex', pattern: '^billing' }, 'billing api')).toBe(true)
    expect(textMatches({ mode: 'regex', pattern: '^Billing' }, 'billing api')).toBe(false)
    expect(textMatches({ mode: 'regex', pattern: '^[Bb]illing' }, 'Billing')).toBe(true)
  })

  it('a regex that does not compile never matches and never throws', () => {
    expect(textMatches({ mode: 'regex', pattern: '(' }, '(')).toBe(false)
  })
})

describe('patternCompiles', () => {
  it('contains always compiles; a regex compiles or it does not', () => {
    expect(patternCompiles({ mode: 'contains', pattern: '(' })).toBe(true)
    expect(patternCompiles({ mode: 'regex', pattern: '^api-\\d+$' })).toBe(true)
    expect(patternCompiles({ mode: 'regex', pattern: '(' })).toBe(false)
  })
})
