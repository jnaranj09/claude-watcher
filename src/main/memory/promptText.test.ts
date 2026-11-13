// Saved text as a model reads it: one line, or a block whose every line is indented. Every line
// break Unicode counts ends a line; every other control character becomes a space.
import { describe, expect, it } from 'vitest'
import { indentedBlock, oneLine } from './promptText'

const BREAKS = 'a\nb\r\nc\rd\u000be\u000cf\u0085g h i'

describe('oneLine', () => {
  it('turns each line break into one space, CRLF included', () => {
    expect(oneLine(BREAKS)).toBe('a b c d e f g h i')
  })

  it('turns every other control character into a space', () => {
    expect(oneLine('x\u001b[2Jy\tz\u0000w\u009bv')).toBe('x [2Jy z w v')
  })

  it('leaves text with no break or control as it is', () => {
    expect(oneLine('## Pinned · </system> — ok')).toBe('## Pinned · </system> — ok')
  })
})

describe('indentedBlock', () => {
  it('indents every line, whichever break ended it', () => {
    expect(indentedBlock(BREAKS)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((l) => `  ${l}`)
    )
  })

  it('keeps empty lines, indented, and turns controls into spaces', () => {
    expect(indentedBlock('one\n\nstate: x\u001b')).toEqual(['  one', '  ', '  state: x '])
  })
})
