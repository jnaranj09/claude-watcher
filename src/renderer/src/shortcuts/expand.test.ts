// Shortcut expander — the pure half. No React, no DOM.
import { describe, it, expect } from 'vitest'
import type { Shortcut } from '../../../shared/schemas/shortcut'
import { favoritesFirst } from '../lib/favoritesFirst'
import {
  parseInput,
  matchAliases,
  expand,
  expandInput,
  expandErrorCopy,
  completeAlias,
  usageFor,
  PLACEHOLDER_HELP,
  EXPANDED_TEXT_MAX_LENGTH
} from './expand'

function sc(alias: string, text: string, name = alias): Shortcut {
  return { id: `id-${alias}`, name, alias, text, workspaceId: null, favorite: false }
}

const HT = sc('ht', 'work on help desk ticket $1', 'help desk')
const DP = sc('dp', 'deploy $1 to $2', 'deploy')
const ALL = sc('say', 'say $*', 'say')
const HELLO = sc('hello', 'hello there', 'greeting')

describe('parseInput', () => {
  it('splits the first word from the values, lowercasing the alias', () => {
    expect(parseInput('HT 1234')).toEqual({ alias: 'ht', args: ['1234'] })
    expect(parseInput('  dp   api  staging ')).toEqual({ alias: 'dp', args: ['api', 'staging'] })
  })
  it('an empty input has an empty alias', () => {
    expect(parseInput('')).toEqual({ alias: '', args: [] })
    expect(parseInput('   ')).toEqual({ alias: '', args: [] })
  })
  it('a double- or single-quoted value keeps its whitespace as ONE value', () => {
    expect(parseInput('dp "fix  login bug" 1234')).toEqual({
      alias: 'dp',
      args: ['fix  login bug', '1234']
    })
    expect(parseInput("dp 'a b' c")).toEqual({ alias: 'dp', args: ['a b', 'c'] })
  })
  it('the other quote kind is literal inside a quote', () => {
    expect(parseInput(`say "it's" 'say "hi"'`)).toEqual({
      alias: 'say',
      args: ["it's", 'say "hi"']
    })
  })
  it('a backslash escapes the next character, inside and outside quotes', () => {
    expect(parseInput('say \\"a b\\" "x\\"y" c\\\\d e\\ f')).toEqual({
      alias: 'say',
      args: ['"a', 'b"', 'x"y', 'c\\d', 'e f']
    })
    expect(parseInput("say don\\'t")).toEqual({ alias: 'say', args: ["don't"] })
  })
  it('an empty quoted value is a real (empty) value', () => {
    expect(parseInput('dp "" x')).toEqual({ alias: 'dp', args: ['', 'x'] })
  })
  it('quoted and bare parts of one word join (shell rule)', () => {
    expect(parseInput('say a"b c"d')).toEqual({ alias: 'say', args: ['ab cd'] })
  })
  it('an unclosed quote takes the rest of the line as one value, no error', () => {
    expect(parseInput('dp "half typed  value')).toEqual({
      alias: 'dp',
      args: ['half typed  value']
    })
    expect(parseInput('dp "')).toEqual({ alias: 'dp', args: [''] })
  })
  it('a trailing lone backslash is kept literally', () => {
    expect(parseInput('say a\\')).toEqual({ alias: 'say', args: ['a\\'] })
  })
  it('a quoted alias is lowercased like a bare one', () => {
    expect(parseInput('"HT" 1')).toEqual({ alias: 'ht', args: ['1'] })
  })
})

describe('matchAliases', () => {
  const list = [HELLO, HT, DP, ALL]
  it('an empty query lists everything in the given order', () => {
    expect(matchAliases('', list)).toEqual(list)
  })
  it('exact alias first, then alias prefix, then name prefix', () => {
    const h = sc('h', 'h', 'zzz')
    expect(matchAliases('h', [HELLO, HT, h]).map((s) => s.alias)).toEqual(['h', 'hello', 'ht'])
  })
  it('matches on the name too, case-insensitively', () => {
    expect(matchAliases('Gre', list)).toEqual([HELLO])
  })
  it('returns nothing when nothing matches', () => {
    expect(matchAliases('zzz', list)).toEqual([])
  })
})

describe('expand', () => {
  it('fills $1..$n by position', () => {
    expect(expand('deploy $1 to $2', ['api', 'staging'])).toEqual({
      ok: true,
      value: 'deploy api to staging'
    })
  })
  it('a number used twice takes the same value', () => {
    expect(expand('$1 and $1', ['x'])).toEqual({ ok: true, value: 'x and x' })
  })
  it('$* takes the values no number took, joined with one space', () => {
    expect(expand('say $*', ['a', 'b', 'c'])).toEqual({ ok: true, value: 'say a b c' })
    expect(expand('$2 then $*', ['a', 'b', 'c'])).toEqual({ ok: true, value: 'b then a c' })
  })
  it('$* with nothing left is empty', () => {
    expect(expand('say $*', [])).toEqual({ ok: true, value: 'say ' })
  })
  it('$$ is a literal dollar, and $$1 is a dollar then a 1', () => {
    expect(expand('cost $$ $$1', [])).toEqual({ ok: true, value: 'cost $ $1' })
  })
  it('extra values are dropped when there is no $*', () => {
    expect(expand('ticket $1', ['1', '2'])).toEqual({ ok: true, value: 'ticket 1' })
  })
  it('a missing value fails closed and names the index', () => {
    expect(expand('deploy $1 to $2', ['api'])).toEqual({
      ok: false,
      error: { code: 'missing_arg', index: 2 }
    })
  })
  it('a result over the cap fails closed', () => {
    const r = expand('$1', ['a'.repeat(EXPANDED_TEXT_MAX_LENGTH + 1)])
    expect(r).toEqual({ ok: false, error: { code: 'too_long' } })
  })
  it('fails closed when a typed value carries a control character (e.g. a pasted ANSI escape)', () => {
    const r = expand('say $1', ['\u001b[31mred'])
    expect(r).toEqual({ ok: false, error: { code: 'control_char' } })
  })
})

describe('expandInput', () => {
  const list = [HT, DP, ALL]
  it('parses, finds by exact alias, expands', () => {
    expect(expandInput('ht 1234', list)).toEqual({
      ok: true,
      value: 'work on help desk ticket 1234'
    })
  })
  it('an unknown alias fails closed with the typed word', () => {
    expect(expandInput('nope 1', list)).toEqual({
      ok: false,
      error: { code: 'unknown_alias', alias: 'nope' }
    })
  })
  it('an explicit alias (the highlighted row) overrides the typed first word', () => {
    expect(expandInput('h 1234', list, 'ht')).toEqual({
      ok: true,
      value: 'work on help desk ticket 1234'
    })
  })
  it('a quoted value with spaces fills ONE positional, and $* keeps its inner spaces', () => {
    expect(expandInput('dp "api gateway" staging', list)).toEqual({
      ok: true,
      value: 'deploy api gateway to staging'
    })
    expect(expandInput('say "a  b" c', list)).toEqual({ ok: true, value: 'say a  b c' })
  })
  it('an empty input is an unknown empty alias', () => {
    expect(expandInput('', list)).toEqual({
      ok: false,
      error: { code: 'unknown_alias', alias: '' }
    })
  })
})

describe('expandErrorCopy', () => {
  it('maps every code to operator copy', () => {
    expect(expandErrorCopy({ code: 'unknown_alias', alias: 'xy' })).toBe('No shortcut named "xy"')
    expect(expandErrorCopy({ code: 'missing_arg', index: 2 })).toBe('Missing value for $2')
    expect(expandErrorCopy({ code: 'too_long' })).toBe(
      `Result is longer than ${EXPANDED_TEXT_MAX_LENGTH} characters`
    )
    expect(expandErrorCopy({ code: 'control_char' })).toBe('A value contains a control character')
    expect(expandErrorCopy({ code: 'multiline_unsupported' })).toBe(
      'This session cannot take a multi-line phrase'
    )
  })
})

describe('completeAlias', () => {
  it('replaces the first word with the alias and adds a space', () => {
    expect(completeAlias('h', 'ht')).toBe('ht ')
    expect(completeAlias('', 'ht')).toBe('ht ')
    expect(completeAlias('  h', 'ht')).toBe('ht ')
  })
  it('keeps the values already typed', () => {
    expect(completeAlias('h 1234', 'ht')).toBe('ht 1234')
    expect(completeAlias('h  "a b" c', 'ht')).toBe('ht  "a b" c')
  })
  it('an already complete alias with a space stays as it is', () => {
    expect(completeAlias('ht ', 'ht')).toBe('ht ')
  })
})

describe('usageFor', () => {
  it('lists the alias then the placeholders it takes, in order, $* last', () => {
    expect(usageFor(DP)).toBe('dp $1 $2')
    expect(usageFor(ALL)).toBe('say $*')
    expect(usageFor(sc('x', '$2 $1 $* $$'))).toBe('x $1 $2 $*')
  })
  it('a phrase with no placeholder is the alias alone', () => {
    expect(usageFor(HELLO)).toBe('hello')
  })
})

describe('PLACEHOLDER_HELP', () => {
  it('names every placeholder token once', () => {
    expect(PLACEHOLDER_HELP.map((h) => h.token)).toEqual(['$1 $2 … $9', '$*', '$$'])
  })
})

describe('matchAliases — favorites first (the caller orders, the bands stay)', () => {
  const star = (alias: string, favorite: boolean): Shortcut => ({ ...sc(alias, 'x'), favorite })

  it('a starred prefix match never rises above an exact alias match', () => {
    const rows = favoritesFirst([star('ap', false), star('apx', true)])
    expect(matchAliases('ap', rows).map((s) => s.alias)).toEqual(['ap', 'apx'])
  })
  it('inside one band a favorite leads', () => {
    const rows = favoritesFirst([star('apa', false), star('apz', true)])
    expect(matchAliases('ap', rows).map((s) => s.alias)).toEqual(['apz', 'apa'])
  })
  it('an empty query lists favorites first', () => {
    const rows = favoritesFirst([star('aa', false), star('zz', true)])
    expect(matchAliases('', rows).map((s) => s.alias)).toEqual(['zz', 'aa'])
  })
})
