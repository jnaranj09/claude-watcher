// A `/remember` line as the operator typed it: a specific when it is one `key = value` line, else a
// fact; refused when empty, too long, secret-like or not a valid memory text.
import { describe, expect, it } from 'vitest'
import { parseRemember } from './rememberText'

/** A made-up GitHub-style token, built at run time so no scanner reads a literal. */
const FAKE_TOKEN = 'gh' + 'p_' + 'a1B2'.repeat(9)

describe('parseRemember', () => {
  it('splits on the first spaced equals', () => {
    expect([parseRemember('staging port = 9281'), parseRemember('a = b = c')]).toEqual([
      { ok: true, text: { kind: 'specific', key: 'staging port', value: '9281' } },
      { ok: true, text: { kind: 'specific', key: 'a', value: 'b = c' } }
    ])
  })

  it('an unspaced equals makes a fact', () => {
    expect(parseRemember('run tests with FOO=1 npm test')).toEqual({
      ok: true,
      text: {
        kind: 'fact',
        title: 'run tests with FOO=1 npm test',
        body: 'run tests with FOO=1 npm test'
      }
    })
  })

  it('a line break makes a fact whose title is the first line', () => {
    expect(parseRemember('deploy = two steps\nfirst build')).toEqual({
      ok: true,
      text: { kind: 'fact', title: 'deploy = two steps', body: 'deploy = two steps\nfirst build' }
    })
  })

  it('a key that does not fit makes a fact with a 120-character title ending in an ellipsis', () => {
    expect(parseRemember(`${'k'.repeat(121)} = v`)).toMatchObject({
      ok: true,
      text: { kind: 'fact', title: `${'k'.repeat(119)}…` }
    })
  })

  it('a value over 500 characters makes a fact', () => {
    expect(parseRemember(`k = ${'v'.repeat(501)}`)).toMatchObject({
      ok: true,
      text: { kind: 'fact', body: `k = ${'v'.repeat(501)}` }
    })
  })

  it('a key of 120 and a value of 500 characters still make a specific', () => {
    expect(parseRemember(`${'k'.repeat(120)} = ${'v'.repeat(500)}`)).toEqual({
      ok: true,
      text: { kind: 'specific', key: 'k'.repeat(120), value: 'v'.repeat(500) }
    })
  })

  it('a spaced equals at the start makes a fact', () => {
    expect(parseRemember(' = 9281')).toEqual({
      ok: true,
      text: { kind: 'fact', title: '= 9281', body: '= 9281' }
    })
  })

  it('the text is trimmed before it is split', () => {
    expect(parseRemember('  region = eu-west-1 \n ')).toEqual({
      ok: true,
      text: { kind: 'specific', key: 'region', value: 'eu-west-1' }
    })
  })

  it('a cut title never ends in half of a character', () => {
    expect(parseRemember(`${'t'.repeat(118)}\u{1F600}${'t'.repeat(10)}`)).toMatchObject({
      ok: true,
      text: { kind: 'fact', title: `${'t'.repeat(118)}…` }
    })
  })

  it('an empty or blank text is refused as empty', () => {
    expect([parseRemember(''), parseRemember(' \n\t ')]).toEqual([
      { ok: false, code: 'remember_empty' },
      { ok: false, code: 'remember_empty' }
    ])
  })

  it('a fact over 2,000 characters is refused as too long', () => {
    expect([
      parseRemember(`a\n${'b'.repeat(1998)}`),
      parseRemember(`a\n${'b'.repeat(1999)}`)
    ]).toEqual([
      { ok: true, text: { kind: 'fact', title: 'a', body: `a\n${'b'.repeat(1998)}` } },
      { ok: false, code: 'remember_too_long' }
    ])
  })

  it('a text the memory text schema refuses is invalid', () => {
    expect(parseRemember('one\u0007two')).toEqual({ ok: false, code: 'remember_invalid' })
  })

  it('P3-C14: Windows line ends are saved as line breaks', () => {
    expect(parseRemember('one\r\ntwo\r\n')).toEqual({
      ok: true,
      text: { kind: 'fact', title: 'one', body: 'one\ntwo' }
    })
  })

  it('P3-C14: a lone carriage return is saved as a line break', () => {
    expect(parseRemember('one\rtwo')).toEqual({
      ok: true,
      text: { kind: 'fact', title: 'one', body: 'one\ntwo' }
    })
  })

  it('the title is the first line trimmed, before it is cut', () => {
    expect(parseRemember(`${'a'.repeat(118)}     \nb`)).toMatchObject({
      ok: true,
      text: { kind: 'fact', title: 'a'.repeat(118) }
    })
  })

  it('a text the secret scan matches is refused before it is split', () => {
    expect(parseRemember('deploy key = ' + FAKE_TOKEN)).toEqual({
      ok: false,
      code: 'remember_secret'
    })
  })

  // 13
  it('a text that holds a private tag is refused as a secret is', () => {
    expect([
      parseRemember('db host = <private>10.0.0.5</private>'),
      parseRemember('wrap it in <private> next time'),
      parseRemember('private notes = /srv/acme/notes')
    ]).toEqual([
      { ok: false, code: 'remember_secret' },
      { ok: false, code: 'remember_secret' },
      { ok: true, text: { kind: 'specific', key: 'private notes', value: '/srv/acme/notes' } }
    ])
  })
})
