// The secret patterns of memory phase 2 (addendum "Secrets"). Every fake secret is built by joining
// strings, so no scanner flags the public repo.
import { describe, expect, it } from 'vitest'
import { SECRET_MARK } from '../../../shared/schemas/memoryExtract'
import { SECRET_PATTERNS, hasSecret, redactSecrets } from './secretScan'

const fakeSecrets: [string, string][] = [
  ['an sk- key', 's' + 'k-' + 'a'.repeat(24)],
  ['a GitHub ghp_ token', 'gh' + 'p_' + 'x'.repeat(36)],
  ['a GitHub gho_ token', 'gh' + 'o_' + 'x'.repeat(36)],
  ['a GitHub ghu_ token', 'gh' + 'u_' + 'x'.repeat(36)],
  ['a GitHub ghs_ token', 'gh' + 's_' + 'x'.repeat(36)],
  ['a GitHub ghr_ token', 'gh' + 'r_' + 'x'.repeat(36)],
  ['a GitHub fine-grained token', 'github' + '_pat_' + 'x'.repeat(40)],
  ['a GitLab token', 'gl' + 'pat-' + 'y'.repeat(20)],
  ['a Slack token', 'xo' + 'xb-' + 'z'.repeat(24)],
  ['an AWS key id', 'AK' + 'IA' + 'Q'.repeat(16)],
  ['a Google key', 'AI' + 'za' + 'w'.repeat(35)],
  [
    'a PEM private key block',
    '-----BEGIN ' +
      'RSA PRIVATE KEY-----\n' +
      'm'.repeat(40) +
      '\n-----END ' +
      'RSA PRIVATE KEY-----'
  ],
  ['a JWT', 'ey' + 'J' + 'h'.repeat(20) + '.' + 'p'.repeat(20) + '.' + 's'.repeat(20)],
  ['a Bearer header value', 'Bea' + 'rer ' + 'b'.repeat(24)],
  ['a URL with a password', 'https://' + 'admin:' + 'v'.repeat(12) + '@'],
  ['a password assignment', 'pass' + 'word=' + 'q'.repeat(12)],
  ['an api_key in JSON', '"api' + '_key": "' + 'k'.repeat(12) + '"'],
  ['an authorization header', 'Author' + 'ization: ' + 't'.repeat(12)]
]

describe('redactSecrets', () => {
  it.each(fakeSecrets)('redacts %s', (_name, secret) => {
    expect(redactSecrets(`a ${secret} b`)).toBe(`a ${SECRET_MARK} b`)
  })

  it.each([
    'port 9281',
    'v2.1.304',
    'commit 3f2a9c1',
    'token count: 12',
    '/work/acme/shop/src/config.ts'
  ])('leaves %s alone', (plain) => {
    expect(redactSecrets(plain)).toBe(plain)
    expect(hasSecret(plain)).toBe(false)
  })

  it('redacts every secret in a text, not only the first', () => {
    const one = 'gh' + 'p_' + 'x'.repeat(36)
    const two = 'AK' + 'IA' + 'Q'.repeat(16)
    expect(redactSecrets(`${one} and ${two} and ${one}`)).toBe(
      `${SECRET_MARK} and ${SECRET_MARK} and ${SECRET_MARK}`
    )
  })

  it('takes the value out of an uppercase env assignment', () => {
    expect(redactSecrets('DB_PASS' + 'WORD=' + 'r'.repeat(12) + ' next')).toBe(
      `DB_${SECRET_MARK} next`
    )
  })

  it('redacts a PEM block that was cut before its end line, up to the end of the text', () => {
    const cut = '-----BEGIN ' + 'PRIVATE KEY-----\n' + 'm'.repeat(40)
    expect(redactSecrets(`key:\n${cut}`)).toBe(`key:\n${SECRET_MARK}`)
  })

  it('gives the same answer when called twice on the same text', () => {
    const text = 'a ' + 'gh' + 'p_' + 'x'.repeat(36)
    expect(hasSecret(text)).toBe(true)
    expect(hasSecret(text)).toBe(true)
    expect(redactSecrets(text)).toBe(`a ${SECRET_MARK}`)
    expect(redactSecrets(text)).toBe(`a ${SECRET_MARK}`)
  })
})

describe('redactSecrets on a long text', () => {
  it.each([
    ['a name repeated with no value', 'token'.repeat(400_000)],
    ['a dotted word', 'a.'.repeat(1_000_000)],
    ['spaces', ' '.repeat(2_000_000)]
  ])('takes well under two seconds for 2 MB of %s', (_name, text) => {
    const start = performance.now()
    expect(redactSecrets(text)).toBe(text)
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('hasSecret', () => {
  it.each(fakeSecrets)('finds %s', (_name, secret) => {
    expect(hasSecret(`a ${secret} b`)).toBe(true)
  })

  it('finds the secret mark itself', () => {
    expect(hasSecret(`the key is ${SECRET_MARK}`)).toBe(true)
  })
})

describe('SECRET_PATTERNS', () => {
  it('each pattern finds at least one fake secret, so none is dead', () => {
    const dead = SECRET_PATTERNS.filter((p) => !fakeSecrets.some(([, s]) => s.search(p) !== -1))
    expect(dead).toEqual([])
  })
})
