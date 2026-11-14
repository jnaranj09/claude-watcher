// The one tag reader and span cutter (`tagSpans.ts`): the slice cleaner cuts `system-reminder`
// spans with it, and `privateSpans.ts` the private tag.
import { describe, expect, it } from 'vitest'
import { cutSpans, spanTag } from './tagSpans'

const NOTE = spanTag('note')

describe('cutSpans', () => {
  it('cuts a closed span and writes `put` where it opened', () => {
    expect(cutSpans('a<note>b</note>c', NOTE, '#')).toBe('a#c')
  })
  it('cuts nested spans whole, with one `put`', () => {
    expect(cutSpans('a<note>b<note>c</note>d</note>e', NOTE, '#')).toBe('a#e')
  })
  it('an opening tag that never closes cuts the rest', () => {
    expect(cutSpans('a<note>b', NOTE, '#')).toBe('a#')
  })
  it('a closing tag with no opening one is cut alone, with no `put`', () => {
    expect(cutSpans('a</note>b', NOTE, '#')).toBe('ab')
  })
  it('reads the tag in any case, with spaces, slashes or attributes, with or without its >', () => {
    expect(cutSpans('a< NOTE >b</ Note>c<note id="1">d< / note >e<note', NOTE, '#')).toBe('a#c#e#')
  })
  it('a longer name is not the tag', () => {
    expect(cutSpans('a<notes>b<note-x>c<note_1>d', NOTE, '#')).toBe('a<notes>b<note-x>c<note_1>d')
  })
  it('an empty `put` leaves nothing behind', () => {
    expect(cutSpans('a<note>b</note>c', NOTE, '')).toBe('ac')
  })
})

describe('spanTag', () => {
  it('builds the pattern the cleaner had for system-reminder', () => {
    expect(spanTag('system-reminder').source).toBe(
      /<([\s/]*)system-reminder(?![\p{L}\p{N}_-])[\s/]*>?/giu.source
    )
    expect(spanTag('system-reminder').flags).toBe('giu')
  })
})
