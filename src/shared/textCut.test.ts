import { describe, expect, it } from 'vitest'
import { cutToUnits, toSafeLine } from './textCut'

describe('toSafeLine', () => {
  it('turns each control character and line separator into a space, then trims', () => {
    expect(toSafeLine('\ta\nb\u0085c d e\u007f ')).toBe('a b c d e')
  })

  it('keeps other text as it is', () => {
    expect(toSafeLine('Fix "login" [x] ✓')).toBe('Fix "login" [x] ✓')
  })
})

describe('cutToUnits', () => {
  it('keeps text that fits', () => {
    expect(cutToUnits('abc', 3)).toBe('abc')
  })

  it('cuts to max units with no ellipsis', () => {
    expect(cutToUnits('abcdef', 4)).toBe('abcd')
  })

  it('drops a surrogate pair at the cut whole', () => {
    expect(cutToUnits('ab😀c', 3)).toBe('ab')
  })

  it('keeps a surrogate pair that fits whole', () => {
    expect(cutToUnits('ab😀c', 4)).toBe('ab😀')
  })
})
