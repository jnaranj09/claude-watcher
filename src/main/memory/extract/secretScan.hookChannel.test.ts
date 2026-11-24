// Threat model T-D13 follow-up: the hook channel secret (64 lowercase hex in `/h/<token>`) is a
// credential. claude can print it into its transcript (`env` shows CLAUDE_WATCHER_MOD_URL, a `cat`
// of its `--settings` file shows the hook URL). Fault: memory phase 2 does not know the shape, so a
// slice keeps the token and a saved memory carries it to every later session. Fakes are built by
// joining strings and repeating one character.
import { describe, expect, it } from 'vitest'
import { SECRET_MARK } from '../../../shared/schemas/memoryExtract'
import { hasSecret, redactSecrets } from './secretScan'

const token = 'c0ffee'.repeat(10) + 'beef'
const base = 'http://127.0.0.1:9279/' + 'h/'

describe('the hook channel secret is a secret', () => {
  it.each([
    ['the env line of the bridge mod', `CLAUDE_WATCHER_MOD_URL=${base}${token}/mod/report`],
    ['the hook URL in a settings file', `"url": "${base}${token}/"`],
    ['a prompt origin path', `POST /h/${token}/mod/prompt`],
    ['a path that ends at the token', `/h/${token}`]
  ])('takes the token out of %s and keeps the rest', (_name, text) => {
    expect(redactSecrets(text)).toBe(text.replace(`/h/${token}`, SECRET_MARK))
    expect(hasSecret(text)).toBe(true)
  })

  it.each([
    ['a sha256 digest', `sha256:${'a'.repeat(64)}`],
    ['63 hex characters', `/h/${'a'.repeat(63)}/`],
    ['65 hex characters', `/h/${'a'.repeat(65)}/`],
    ['uppercase hex', `/h/${'A'.repeat(64)}/`],
    ['a path that only ends in h', `/path/${'a'.repeat(64)}`]
  ])('leaves %s alone', (_name, text) => {
    expect(redactSecrets(text)).toBe(text)
    expect(hasSecret(text)).toBe(false)
  })

  it('takes well under two seconds for 2 MB of channel paths one character short', () => {
    const text = `/h/${'a'.repeat(63)} `.repeat(Math.ceil((2 * 1024 * 1024) / 68))
    const start = performance.now()
    expect(redactSecrets(text)).toBe(text)
    expect(performance.now() - start).toBeLessThan(2000)
  })
})
