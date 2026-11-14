// The private tag (`privateSpans.ts`): text between <private> and </private> is never read by a
// save and never matched by recall.
import { describe, expect, it } from 'vitest'
import { cutPrivate, holdsPrivate } from './privateSpans'

describe('cutPrivate', () => {
  it('replaces a span with what the caller leaves behind', () => {
    expect(cutPrivate('use <private>the side door</private> to get in', '#')).toBe(
      'use # to get in'
    )
  })
  it('reads the tag in any case and spacing; a longer name is not the tag', () => {
    expect(cutPrivate('a<PRIVATE>b</Private>c< private >d< / private >e', '#')).toBe('a#c#e')
    expect(cutPrivate('a <private-key> b <privately> c', '#')).toBe(
      'a <private-key> b <privately> c'
    )
  })
  it('text on both sides of a span never joins', () => {
    expect(cutPrivate('92<private>x</private>81', '[secret removed]')).toBe('92[secret removed]81')
  })
})

describe('holdsPrivate', () => {
  it.each([
    ['<private>x</private>', true],
    ['an opening <private only', true],
    ['a closing </private> only', true],
    ['< / PRIVATE >', true],
    ['private notes = /srv/acme/notes', false],
    ['<privately>', false]
  ])('%s → %s', (text, held) => {
    expect(holdsPrivate(text)).toBe(held)
  })
  it('answers the same on a second call (no state kept between calls)', () => {
    expect([holdsPrivate('<private>'), holdsPrivate('<private>')]).toEqual([true, true])
  })
})
