// Expander rules the mutation run (StrykerJS) showed no test pinned: a missing value is reported
// at the LOWEST missing `$n`, and a result exactly at the cap is accepted.
import { describe, it, expect } from 'vitest'
import { expand, EXPANDED_TEXT_MAX_LENGTH } from './expand'

describe('expand', () => {
  it('reports the lowest missing placeholder when the text names a higher one first', () => {
    expect(expand('see $3 then $1 and $2', [])).toEqual({
      ok: false,
      error: { code: 'missing_arg', index: 1 }
    })
  })

  it('accepts a result exactly at the length cap', () => {
    const text = 'x'.repeat(EXPANDED_TEXT_MAX_LENGTH)
    expect(expand(text, [])).toEqual({ ok: true, value: text })
  })
})
