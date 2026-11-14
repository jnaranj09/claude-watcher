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

  it('a term repeated fills one slot', () => {
    expect(recallTerms(`${'deploy '.repeat(12)}staging port`).map((t) => t.term)).toEqual([
      'deploy',
      'staging',
      'port'
    ])
  })

  it('the cap keeps an exact term that comes last', () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${String.fromCharCode(97 + i)}x`)
    expect(recallTerms(`${words.join(' ')} 9281`).map((t) => t.term)).toEqual([
      '9281',
      ...words.slice(0, 11)
    ])
  })

  it.each(
    (
      'and are but can did does for from had has have how into its not our out that the their ' +
      'them then there these they this was were what when where which who why will with you your'
    ).split(' ')
  )('the stop word %s gives no term', (word) => {
    expect(recallTerms(`${word} ${word.toUpperCase()}`)).toEqual([])
  })

  it('a prompt of operator characters gives plain terms', () => {
    expect(recallTerms('"a*" (b:c) -deploy NEAR "x" OR ^y').map((t) => t.term)).toEqual([
      'b:c',
      'deploy',
      'near'
    ])
  })
})
