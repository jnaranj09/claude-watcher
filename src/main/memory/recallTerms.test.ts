// The terms recall searches for (phase 3 addendum §6): exact tokens first, stop words and short
// words dropped, at most `MEMORY_LIMITS.recallTerms`. Pure.
import { describe, expect, it } from 'vitest'
import { recallTerms } from './recallTerms'

describe('recallTerms', () => {
  it('keeps exact tokens first, drops stop words and short words', () => {
    expect(recallTerms('What port does staging use? I think 9281')).toEqual([
      { term: '9281', exact: true },
      { term: 'port', exact: false },
      { term: 'staging', exact: false },
      { term: 'use', exact: false },
      { term: 'think', exact: false }
    ])
  })

  it('a version and a path are one exact term each', () => {
    expect(recallTerms('Upgrade to v2.1.304 in src/main/index.ts.')).toEqual([
      { term: 'v2.1.304', exact: true },
      { term: 'src/main/index.ts', exact: true },
      { term: 'upgrade', exact: false }
    ])
  })

  it('a hyphenated word is not exact', () => {
    expect(recallTerms('follow-up')).toEqual([{ term: 'follow-up', exact: false }])
  })

  it('keeps at most 12 distinct terms', () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${String.fromCharCode(97 + i)}x`)
    expect(recallTerms(`${words.join(' ')} ${words.join(' ')}`).map((t) => t.term)).toEqual(
      words.slice(0, 12)
    )
  })

  it('a prompt of operator characters gives plain terms', () => {
    expect(recallTerms('"a*" (b:c) -deploy NEAR "x" OR ^y').map((t) => t.term)).toEqual([
      'b:c',
      'deploy',
      'near'
    ])
  })
})
