// What a term run and an exact term are (phase 3 addendum §6), shared by the candidate check
// (P3-C6) and recall ranking.
import { describe, expect, it } from 'vitest'
import { isExactTerm, termRuns } from './exactTerms'

describe('termRuns', () => {
  it('splits on spaces and punctuation, keeps case and strips a trailing . : / -', () => {
    expect(termRuns('Upgrade to v2.1.304 in src/main/index.ts. Port: 9281/ follow-up-')).toEqual([
      'Upgrade',
      'to',
      'v2.1.304',
      'in',
      'src/main/index.ts',
      'Port',
      '9281',
      'follow-up'
    ])
  })

  it('a host and port is one run', () => {
    expect(termRuns('at http://localhost:9300/x')).toEqual(['at', 'http://localhost:9300/x'])
  })
})

describe('isExactTerm', () => {
  it.each(['9281', 'v2.1.304', 'err_conn', 'src/main/index.ts', 'README.md', 'v2.1'])(
    '%s is exact',
    (t) => {
      expect(isExactTerm(t)).toBe(true)
    }
  )

  it.each(['follow-up', 'port', 'v21', 'a_b', '4.2'])('%s is not exact', (t) => {
    expect(isExactTerm(t)).toBe(false)
  })
})
