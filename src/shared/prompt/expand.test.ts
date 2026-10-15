import { describe, it, expect } from 'vitest'
import { expand, EXPANDED_TEXT_MAX_LENGTH } from './expand'

describe('shared expand()', () => {
  it('fills $1..$n in order and $$ is a literal dollar', () => {
    expect(expand('fix $1 for $2 ($$5)', ['HT-1', 'acme'])).toEqual({
      ok: true,
      value: 'fix HT-1 for acme ($5)'
    })
  })
  it('fails closed on a missing value', () => {
    expect(expand('fix $2', ['a'])).toEqual({ ok: false, error: { code: 'missing_arg', index: 2 } })
  })
  it('$* takes every value no number took', () => {
    expect(expand('$1: $*', ['a', 'b', 'c'])).toEqual({ ok: true, value: 'a: b c' })
    expect(expand('$2 then $*', ['a', 'b', 'c'])).toEqual({ ok: true, value: 'b then a c' })
  })
  it('a number used twice takes the same value', () => {
    expect(expand('$1 and $1', ['x'])).toEqual({ ok: true, value: 'x and x' })
  })
  it('$* with nothing left is empty', () => {
    expect(expand('say $*', [])).toEqual({ ok: true, value: 'say ' })
  })
  it('extra values are dropped when there is no $*', () => {
    expect(expand('ticket $1', ['1', '2'])).toEqual({ ok: true, value: 'ticket 1' })
  })
  it('rejects a control character in a value', () => {
    expect(expand('x $1', ['a\x1b[31m'])).toEqual({ ok: false, error: { code: 'control_char' } })
  })
  it('a multi-line TEXT expands — a template prompt is prose', () => {
    expect(expand('Review $1.\nThen stop.', ['HT-1'])).toEqual({
      ok: true,
      value: 'Review HT-1.\nThen stop.'
    })
  })
  it('rejects a newline in a VALUE — a value is the untrusted half', () => {
    expect(expand('x $1', ['a\nb'])).toEqual({ ok: false, error: { code: 'control_char' } })
  })
  it('rejects an escape byte in a value', () => {
    expect(expand('x $1', ['a\x1bb'])).toEqual({ ok: false, error: { code: 'control_char' } })
  })
  it('rejects a control character that is not \\n in the RESULT', () => {
    expect(expand('x\x1by $1', ['ok'])).toEqual({ ok: false, error: { code: 'control_char' } })
  })
  it('rejects a result over the cap', () => {
    expect(expand('$1', ['x'.repeat(EXPANDED_TEXT_MAX_LENGTH + 1)])).toEqual({
      ok: false,
      error: { code: 'too_long' }
    })
  })
})
