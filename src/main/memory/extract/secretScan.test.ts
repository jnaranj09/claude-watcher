// The secret patterns of memory phase 2 (addendum "Secrets", widened by ruling R10). Every fake
// secret is built by joining strings, so no scanner flags the public repo.
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
  ['an authorization header', 'Author' + 'ization: ' + 't'.repeat(12)],
  ['a Basic authorization header', 'Author' + 'ization: Basic ' + 'Zm'.repeat(8)],
  ['a Digest authorization header', 'Author' + 'ization: Digest ' + 'u'.repeat(12)],
  // ruling R10
  ['a Stripe-style live key', 's' + 'k_live_' + 'a'.repeat(24)],
  ['a Stripe-style test key', 's' + 'k_test_' + 'a'.repeat(24)],
  ['an npm token', 'np' + 'm_' + 'n'.repeat(36)],
  ['an AWS temporary key id', 'AS' + 'IA' + 'Q'.repeat(16)],
  [
    'a PGP private key block',
    '-----BEGIN ' +
      'PGP PRIVATE KEY BLOCK-----\n' +
      'm'.repeat(40) +
      '\n-----END ' +
      'PGP PRIVATE KEY BLOCK-----'
  ],
  ['a URL with an empty user and a password', 'redis://' + ':' + 'v'.repeat(12) + '@'],
  ['a curl -u user and password', '-u ' + 'bob:' + 'p'.repeat(12)],
  ['a curl --user= user and password', '--user=' + 'bob:' + 'p'.repeat(12)],
  ['an apiKey in source', 'api' + "Key: '" + 'k'.repeat(12) + "'"],
  ['an apiKey in JSON', '"api' + 'Key": "' + 'k'.repeat(12) + '"'],
  ['an API_KEY env assignment', 'API' + '_KEY=' + 'k1'.repeat(6)],
  ['an APIKEY env assignment', 'API' + 'KEY=' + 'k1'.repeat(6)],
  ['an api-key setting', 'api' + '-key: ' + 'k1'.repeat(6)],
  ['an x-api-key header', 'x-api' + '-key: ' + 'k1'.repeat(6)]
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
    '/work/acme/shop/src/config.ts',
    // near misses of the R10 shapes and the authorization header
    'apiKey: config.apiKey',
    'const apiKey = getApiKey()',
    'the api key is in the vault',
    'x-api-key: see the docs',
    'docker run -u 1000:1000 img',
    'git push -u origin main',
    'a build-u flag:inside a word',
    'redis://localhost:6379',
    'npm_package_version',
    'sk_live_mode',
    'ASIAN markets',
    '-----BEGIN PGP PUBLIC KEY BLOCK-----',
    'Authorization: none',
    'authorization is required',
    'eyJ is how a JWT starts'
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

  it('takes the credential out of a curl Basic authorization header', () => {
    const command =
      'curl -H "Author' + 'ization: Basic ' + 'Zm'.repeat(8) + '" https://example.test/api'
    expect(redactSecrets(command)).toBe(`curl -H ${SECRET_MARK} https://example.test/api`)
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

const TWO_MB = 2_000_000
/** `unit` repeated to 2 MB. */
const fill = (unit: string): string => unit.repeat(Math.ceil(TWO_MB / unit.length)).slice(0, TWO_MB)

describe('redactSecrets on a long text', () => {
  // A pattern that rescans the run from every `eyJ` is quadratic: it would hang on 2 MB, so this
  // smaller size (seconds for such a pattern) turns the test red instead of stalling the run.
  it('takes well under two seconds for 160 KB of eyJ- repeated', () => {
    const run = 'eyJ-'.repeat(40_000)
    const start = performance.now()
    expect(redactSecrets(run)).toBe(run)
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it.each([
    ['a name repeated with no value', fill('token')],
    ['a dotted word', fill('a.')],
    ['spaces', fill(' ')],
    ['eyJ- repeated (JWT starts with no dots)', fill('eyJ-')]
  ])('takes well under two seconds for 2 MB of %s and changes nothing', (_name, text) => {
    const start = performance.now()
    expect(redactSecrets(text)).toBe(text)
    expect(performance.now() - start).toBeLessThan(2000)
  })

  // Hostile input for every pattern: long runs of one character, and long runs of almost-matches
  // of that pattern. Measured at under 100 ms each; the bound is generous for slow machines.
  it.each([
    ['one letter', fill('a')],
    ['dashes', fill('-')],
    ['equals signs', fill('=')],
    ['colons', fill(':')],
    ['slashes', fill('/')],
    ['quotes', fill('"')],
    ['line breaks', fill('\n')],
    ['sk- keys one short', fill('sk-' + 'a'.repeat(19) + ' ')],
    ['sk- with no end', fill('sk-')],
    ['sk_live_ keys one short', fill('sk_live_' + 'a'.repeat(15) + ' ')],
    ['ghp_ tokens one short', fill('gh' + 'p_' + 'a'.repeat(19) + ' ')],
    ['github_pat_ tokens one short', fill('github' + '_pat_' + 'a'.repeat(19) + ' ')],
    ['glpat- tokens one short', fill('gl' + 'pat-' + 'a'.repeat(19) + ' ')],
    ['Slack tokens one short', fill('xo' + 'xb-' + 'a'.repeat(9) + ' ')],
    ['npm_ tokens one short', fill('np' + 'm_' + 'a'.repeat(35) + ' ')],
    ['AKIA with no end', fill('AK' + 'IA')],
    ['ASIA keys one short', fill('AS' + 'IA' + 'A'.repeat(15) + ' ')],
    ['Google keys one short', fill('AI' + 'za' + 'a'.repeat(34) + ' ')],
    ['a key header that never ends', '-----BEGIN ' + fill('A ')],
    ['key headers that are not private', fill('-----BEGIN RSA KEY-----\n')],
    ['private key headers with no end line', fill('-----BEGIN ' + 'PRIVATE KEY-----')],
    [
      'a JWT start with one dot',
      'ey' + 'J' + 'a'.repeat(TWO_MB / 2) + '.' + 'b'.repeat(TWO_MB / 2)
    ],
    ['JWT starts with dots', fill('ey' + 'Ja.')],
    ['Bearer with no token', fill('Bea' + 'rer ')],
    ['Bearer tokens one short', fill('Bea' + 'rer ' + 'a'.repeat(19) + ' ')],
    ['authorization with no value', fill('author' + 'ization: ')],
    ['Basic with no value', fill('Author' + 'ization: Basic ')],
    ['authorization values one short', fill('author' + 'ization: Basic abc ')],
    ['authorization with no colon', fill('author' + 'ization')],
    ['URLs with no @', fill('https://u:' + 'pass ')],
    ['one URL password that never ends', 'a://:' + fill('x:')],
    ['URL schemes with nothing after', fill('a://')],
    ['-u with a short password', fill('-u a:')],
    ['-u with digits only', fill('-u 1000:1000 ')],
    ['-u with a user that never ends', '-u ' + fill('a')],
    ['apikey= repeated', fill('api' + 'key=')],
    ['an apiKey value with no digit', 'api' + 'Key=' + fill('a')],
    ['x-api-key values one short', fill('x-api' + '-key: abcdefg ')],
    ['apiKey quotes that never close', fill('api' + 'Key: "aaaaaaa')],
    ['password values one short', fill('pass' + 'word=' + 'a'.repeat(7) + ' ')],
    ['token names with spaces', fill('token ')]
  ])('takes well under two seconds for 2 MB of %s', (_name, text) => {
    const start = performance.now()
    expect(typeof redactSecrets(text)).toBe('string')
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
