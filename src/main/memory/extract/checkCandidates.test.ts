// The check of every candidate the model returns (addendum "Checking and writing candidates",
// D14, D15, R15): a candidate is kept only when its quote is in ONE cleaned entry, with synthetic
// text. Reconcile and twins: checkCandidates.reconcile.test.ts.
import { describe, expect, it } from 'vitest'
import {
  CUT_END,
  CUT_MIDDLE,
  ExtractOutputSchema,
  SECRET_MARK
} from '../../../shared/schemas/memoryExtract'
import { renderEntries } from './sliceCleaner'
import { findEvidence, findValue, normalise } from './checkCandidates'
import {
  ENTRIES,
  NOTE,
  RESULT_QUOTE,
  cand,
  check,
  entry,
  episode,
  fact,
  portItem,
  specific,
  task
} from '../../../__fixtures__/extractCandidates'

describe('normalise', () => {
  it('turns every whitespace run into one space and trims, nothing else', () => {
    expect(normalise('  A\tb \n\n  C  ')).toBe('A b C')
    expect(normalise('Café')).toBe('Café')
  })
})

describe('checkCandidates: the quote', () => {
  it('keeps a specific whose value is in a tool result as observed, with that entry as its source', () => {
    expect(check([specific('API port', '9281', 'api listening on http://127.0.0.1:9281')])).toEqual(
      { kept: [portItem('observed')], dropped: [] }
    )
  })

  it('drops a specific whose value differs from the transcript by one digit', () => {
    expect(check([specific('API port', '9280', 'api listening on http://127.0.0.1:9281')])).toEqual(
      { kept: [], dropped: ['evidence_not_found'] }
    )
  })

  it('drops a specific whose value is only a part of a longer word or number in the evidence', () => {
    expect(check([specific('API port', '928', 'api listening on http://127.0.0.1:9281')])).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
    expect(
      check([specific('API port', '281', 'api listening on http://127.0.0.1:9281')]).dropped
    ).toEqual(['evidence_not_found'])
    expect(check([specific('API host', 'api listen', 'api listening on http')]).dropped).toEqual([
      'evidence_not_found'
    ])
  })

  it('keeps a value whose edges are not word characters, next to a word character', () => {
    expect(
      check([specific('API address', '127.0.0.1:9281', 'http://127.0.0.1:9281')]).kept
    ).toHaveLength(1)
    // the quote ends at the entry's end of token (`…9281`), not at `127` (R15: `127.0` is one token)
    expect(check([specific('API url', 'http://', 'on http://127.0.0.1:9281')]).kept).toHaveLength(1)
  })

  it('drops a specific whose value is a reworded form of the evidence', () => {
    expect(
      check([specific('API port', 'nine two eight one', 'api listening on http://127.0.0.1:9281')])
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('drops a value cut short together with its quote, at the end of a word', () => {
    const entries = [
      entry(4, 'result', 'api listening on http://127.0.0.1:9281\nversion 1.2.34 ready')
    ]
    expect(check([specific('Version', '1.2.3', 'version 1.2.3')], { entries })).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
    expect(
      check([specific('API address', '127.0.0.1:928', 'listening on http://127.0.0.1:928')], {
        entries
      })
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('drops a quote that begins in the middle of a word', () => {
    const entries = [entry(4, 'result', 'build 51.2.3 ready, id a19281 set')]
    expect(check([specific('Version', '1.2.3', '1.2.3 ready')], { entries })).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
    expect(check([specific('Id', '19281', '19281 set')], { entries })).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
    expect(check([fact('Listening', 'It listens.', 'istening on http')])).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
  })

  it('keeps a whole quote that ends at a period, a comma, a closing quote or bracket, or a line end', () => {
    const entries = [
      entry(4, 'result', 'Port is 9281. Host is (127.0.0.1), name "api-main"\nversion 1.2.34\nnext')
    ]
    const cases: [value: string, evidence: string][] = [
      ['9281', 'Port is 9281'],
      ['9281', 'Port is 9281.'],
      ['127.0.0.1', 'Host is (127.0.0.1'],
      ['127.0.0.1', '(127.0.0.1),'],
      ['api-main', 'name "api-main"'],
      ['1.2.34', 'version 1.2.34'],
      ['1.2.34', '"api-main" version 1.2.34 next']
    ]
    for (const [value, evidence] of cases) {
      expect(check([specific('Value', value, evidence)], { entries }).dropped).toEqual([])
    }
  })

  it('R15: a value or quote that stops or starts at a dot or dash inside a token is dropped', () => {
    const cases: [entryText: string, value: string, evidence: string][] = [
      ['version 1.2.34 ready', '1.2', 'version 1.2'],
      ['version 1.2.34 ready', '1.2', 'version 1.2.'],
      ['host 127.0.0.1 up', '127.0.0', 'host 127.0.0'],
      ['version 1.2.34 ready', '2.34', '2.34 ready'],
      ['version 1.2.34 ready', '2.34', '.2.34 ready'],
      ['released 2026-11-12 today', '11-12', '11-12 today'],
      ['open README.md now', 'README', 'open README'],
      ['released 2026-11-12 today', '2026-11', 'released 2026-11'],
      ['shipped 1.2.34-beta now', '1.2.34', 'shipped 1.2.34'],
      ['shipped 1.2.34-beta now', 'beta', 'beta now']
    ]
    for (const [text, value, evidence] of cases) {
      expect(
        check([specific('Value', value, evidence)], { entries: [entry(4, 'result', text)] })
      ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    }
  })

  it('R15: a value inside a whole quote that stops at a dot or dash inside a token is dropped', () => {
    const cases: [entryText: string, value: string, evidence: string][] = [
      ['version 1.2.34 ready', '1.2', 'version 1.2.34 ready'],
      ['host 127.0.0.1 up', '127.0.0', 'host 127.0.0.1 up'],
      ['version 1.2.34 ready', '2.34', 'version 1.2.34 ready'],
      ['released 2026-11-12 today', '11-12', 'released 2026-11-12 today'],
      ['open README.md now', 'README', 'open README.md now'],
      ['released 2026-11-12 today', '2026-11', 'released 2026-11-12 today'],
      ['shipped 1.2.34-beta now', '1.2.34', 'shipped 1.2.34-beta now'],
      ['shipped 1.2.34-beta now', 'beta', 'shipped 1.2.34-beta now']
    ]
    for (const [text, value, evidence] of cases) {
      expect(
        check([specific('Value', value, evidence)], { entries: [entry(4, 'result', text)] })
      ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    }
  })

  it('R15: a value after a colon, before a sentence-end dot, a comma, a spaced dash or a quote is kept', () => {
    const cases: [entryText: string, value: string, evidence: string][] = [
      ['open localhost:9281 now', '9281', 'localhost:9281'],
      ['see config.json.', 'config.json', 'see config.json.'],
      ['see config.json. Then run it', 'config.json', 'see config.json. Then'],
      ['shipped version 1.2.34, then', '1.2.34', 'version 1.2.34,'],
      ['port 9281 - the api', '9281', 'port 9281 - the api'],
      ['name "api-main".', 'api-main', 'name "api-main".'],
      ['the tag is v2.1.', 'v2.1', 'the tag is v2.1.']
    ]
    for (const [text, value, evidence] of cases) {
      expect(
        check([specific('Value', value, evidence)], { entries: [entry(4, 'result', text)] }).dropped
      ).toEqual([])
    }
  })

  it('a value written right after a letter, as in (v1.2.34), is not whole (the word rule, unchanged by R15)', () => {
    expect(
      check([specific('Version', '1.2.34', '(v1.2.34)')], {
        entries: [entry(4, 'result', 'built (v1.2.34)')]
      })
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('R15 also holds for a progress-note quote and for findValue', () => {
    expect(
      check([episode('Bumped', 'Bumped it.', 'Bumped to 1.2')], {
        final: true,
        notes: ['Bumped to 1.2.34 today.'],
        entries: []
      })
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    expect(findValue('README', [entry(4, 'result', 'open README.md now')])).toBeNull()
    expect(findValue('README.md', [entry(4, 'result', 'open README.md now')])?.quote).toBe(
      'open README.md now'
    )
  })

  it('drops evidence that joins two entries', () => {
    expect(
      check([
        specific('API port', '9281', 'does the API use? api listening on http://127.0.0.1:9281')
      ])
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    // two adjacent entries, the tool call and its result, read as one text
    expect(
      check([specific('API port', '9281', 'ss -ltn"} api listening on http://127.0.0.1:9281')])
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('drops a quote that is the whole rendered slice, and keeps one that is a whole entry', () => {
    expect(check([fact('API', 'It listens.', renderEntries(ENTRIES))]).dropped).toEqual([
      'evidence_not_found'
    ])
    expect(check([fact('API', 'It listens.', 'Which port does the API use?')]).kept).toHaveLength(1)
  })

  it('drops evidence found only in a web, MCP or subagent result', () => {
    for (const tool of ['WebFetch', 'mcp__docs__read', 'Agent']) {
      const entries = [
        entry(5, 'result', 'the API listens on port 9281', { tool, evidence: false })
      ]
      expect(
        check([specific('API port', '9281', 'the API listens on port 9281')], { entries })
      ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    }
  })

  it('matches evidence whose line breaks and spaces differ from the entry', () => {
    const entries = [entry(4, 'result', 'api listening\n   on  http://127.0.0.1:9281\n')]
    expect(
      check([specific('API port', '9281', ' api listening on\nhttp://127.0.0.1:9281 ')], {
        entries
      }).kept
    ).toEqual([{ ...portItem('observed'), source: { entryId: 'e-4', quote: RESULT_QUOTE.quote } }])
  })

  it('matches a no-break space as whitespace', () => {
    expect(
      check([specific('API port', '9281', 'api listening on http://127.0.0.1:9281')]).kept
    ).toEqual([portItem('observed')])
  })

  it('does not match evidence that differs in case', () => {
    expect(check([specific('API port', '9281', 'API listening on http://127.0.0.1:9281')])).toEqual(
      { kept: [], dropped: ['evidence_not_found'] }
    )
  })

  it('does not fold Unicode: another normal form, a look-alike letter or a zero-width space is not found', () => {
    const entries = [entry(4, 'claude', 'The café opens at 0900.')]
    for (const evidence of [
      'The café opens', // NFD é
      'The cаfé opens', // Cyrillic а
      'The café​ opens' // zero-width space
    ]) {
      expect(check([fact('Opening', 'At 0900.', evidence)], { entries })).toEqual({
        kept: [],
        dropped: ['evidence_not_found']
      })
    }
  })

  it('does not match a quote inside or across a cut mark or a secret mark', () => {
    const entries = [
      entry(4, 'result', `head text here${CUT_MIDDLE}tail text there`),
      entry(5, 'claude', `the start of it${CUT_END}`),
      entry(6, 'operator', `use ${SECRET_MARK} for the deploy`)
    ]
    for (const evidence of [
      'cut] …',
      'here … [cut] … tail',
      'of it … [cut',
      'removed] for the deploy'
    ]) {
      expect(check([fact('A fact', 'Body.', evidence)], { entries }).dropped).toEqual([
        'evidence_not_found'
      ])
    }
    expect(check([fact('A fact', 'Body.', 'tail text there')], { entries }).kept).toHaveLength(1)
    expect(check([fact('A fact', 'Body.', 'for the deploy')], { entries }).kept).toHaveLength(1)
  })

  it('the same text in a claude entry and a result is observed', () => {
    const entries = [
      entry(4, 'claude', 'It says api listening on http://127.0.0.1:9281 now.'),
      entry(5, 'result', 'api listening on http://127.0.0.1:9281')
    ]
    expect(
      check([specific('API port', '9281', 'api listening on http://127.0.0.1:9281')], { entries })
        .kept
    ).toEqual([{ ...portItem('observed'), source: { entryId: 'e-5', quote: RESULT_QUOTE.quote } }])
  })

  it('evidence in an operator entry is stated, in a tool call is inferred', () => {
    const op = check([fact('Port question', 'The operator asked.', 'Which port does the API use?')])
    expect(op.kept).toEqual([
      {
        kind: 'item',
        action: 'add',
        id: null,
        text: { kind: 'fact', title: 'Port question', body: 'The operator asked.' },
        check: null,
        basis: 'stated',
        source: { entryId: 'e-1', quote: 'Which port does the API use?' }
      }
    ])
    const tool = check([specific('Listen check', 'ss -ltn', '{"command":"ss -ltn"}')])
    expect(tool.kept).toEqual([
      {
        kind: 'item',
        action: 'add',
        id: null,
        text: { kind: 'specific', key: 'Listen check', value: 'ss -ltn' },
        check: null,
        basis: 'inferred',
        source: { entryId: 'e-2', quote: '{"command":"ss -ltn"}' }
      }
    ])
  })

  it('an operator entry wins over a claude entry, and the earliest wins among equals', () => {
    const entries = [
      entry(4, 'claude', 'deploy with make ship'),
      entry(5, 'operator', 'deploy with make ship'),
      entry(6, 'operator', 'deploy with make ship')
    ]
    expect(findEvidence('deploy with make ship', entries)).toEqual({
      basis: 'stated',
      entryId: 'e-5'
    })
    expect(findEvidence('deploy with make ship', entries.slice(0, 1))).toEqual({
      basis: 'inferred',
      entryId: 'e-4'
    })
    expect(findEvidence('deploy with make shop', entries)).toBeNull()
    // under 4 characters after normalising: never found, even where it stands
    expect(findEvidence(' de  ', entries)).toBeNull()
    expect(findEvidence('', entries)).toBeNull()
  })

  it('drops evidence under 4 characters', () => {
    const entries = [entry(4, 'result', 'abc d')]
    expect(check([fact('Short', 'Body.', 'abc')], { entries }).dropped).toEqual(['invalid'])
    expect(check([fact('Short', 'Body.', 'a  b')], { entries }).dropped).toEqual(['invalid'])
    expect(check([fact('Short', 'Body.', '')], { entries }).dropped).toEqual(['invalid'])
    expect(check([fact('Short', 'Body.', 'x')], { entries }).dropped).toEqual(['invalid'])
    expect(check([fact('Short', 'Body.', ' abc  d ')], { entries }).kept).toHaveLength(1)
  })

  it('drops evidence over 500 characters', () => {
    const long = 'a'.repeat(501)
    const entries = [entry(4, 'result', long.slice(1))]
    expect(check([fact('Long', 'Body.', long)], { entries }).dropped).toEqual(['invalid'])
    expect(check([fact('Long', 'Body.', long.slice(1))], { entries }).kept).toHaveLength(1)
  })
})

const longValue = [specific('Long', 'x'.repeat(501), 'x'.repeat(10))]
const twoLines = [specific('Two', 'a line\nanother', 'a line')]
const taskWithBody = [task('Update the README', 'Which port', { body: 'a body' })]
const taskNoLeft = [task('Update the README', 'Which port', { leftWith: null })]
const updateNoId = [cand({ action: 'update', id: null })]
const episodeAtCheckpoint = [episode('Moved the port', 'The port moved.', 'Which port')]
const twoEpisodes = [
  episode('Moved the port', 'The port moved.', 'Which port'),
  episode('Again', 'Again.', 'Which port')
]

describe('checkCandidates: the shape', () => {
  it.each([
    ['a specific over 500 characters', longValue],
    ['a specific with a line break', twoLines],
    ['a task with a body', taskWithBody],
    ['a task with no leftWith', taskNoLeft],
    ['an update with no id', updateNoId],
    ['an episode at a checkpoint', episodeAtCheckpoint],
    ['a second episode', twoEpisodes]
  ])('drops %s as invalid', (_n, output) => {
    expect(check(output).dropped).toContain('invalid')
  })

  it('a second episode is dropped and the first kept', () => {
    expect(check(twoEpisodes, { final: true })).toEqual({
      kept: [
        {
          kind: 'episode',
          title: 'Moved the port',
          body: 'The port moved.',
          source: { entryId: 'e-1', quote: 'Which port' }
        }
      ],
      dropped: ['invalid']
    })
  })

  it.each([
    ['a none with no id', [cand({ action: 'none', id: null })]],
    ['a leftWith on a specific', [cand({ leftWith: 'session' })]],
    ['a specific with no body', [cand({ body: null })]],
    ['a fact with no body', [cand({ type: 'fact', body: null })]],
    ['an episode with no body', [cand({ type: 'episode', body: null })]],
    ['a head over 120 characters', [cand({ head: 'h'.repeat(121) })]],
    ['a blank head', [cand({ head: '   ' })]],
    ['a head with a control character', [cand({ head: 'API\u0007port' })]],
    ['a check over 300 characters', [cand({ check: 'c'.repeat(301) })]],
    ['a check with a line break', [cand({ check: 'ss -ltn\nrm -rf x' })]],
    ['a task check with a line break', [task('A task', 'Which port', { check: 'a\nb' })]],
    ['a task title over 200 characters', [task('t'.repeat(201), 'Which port')]],
    ['a fact body over 2000 characters', [fact('A', 'b'.repeat(2001), 'Which port')]],
    ['an episode body over 2000 characters', [episode('A', 'b'.repeat(2001), 'Which port')]],
    [
      'an episode check with a line break',
      [cand({ type: 'episode', body: 'b', check: 'a\nb', evidence: 'Which port' })]
    ]
  ])('drops %s as invalid', (_n, output) => {
    expect(check(output, { final: true })).toEqual({ kept: [], dropped: ['invalid'] })
  })

  it('a task title of 200 characters and a fact body with line breaks pass', () => {
    expect(check([task('t'.repeat(200), 'Which port')]).kept).toHaveLength(1)
    expect(check([fact('A', 'one\ntwo', 'Which port')]).kept).toHaveLength(1)
  })

  it('keeps the trimmed text, check and title', () => {
    expect(
      check([
        cand({ head: '  API port ', body: ' 9281 ', check: ' ss -ltn ' }),
        task('  Update the README ', 'Which port', { check: ' ss -ltn ' })
      ]).kept
    ).toEqual([
      { ...portItem('observed'), check: 'ss -ltn' },
      {
        kind: 'task',
        action: 'add',
        id: null,
        title: 'Update the README',
        check: 'ss -ltn',
        leftWith: 'operator',
        basis: 'stated'
      }
    ])
  })

  it('drops a task while tasks are off', () => {
    expect(check([task('Update the README', 'Which port')], { tasksOn: false })).toEqual({
      kept: [],
      dropped: ['tasks_off']
    })
  })

  it('drops a candidate whose value, check or evidence holds a secret or the secret mark', () => {
    const secret = 'gh' + 'p_' + 'x'.repeat(36)
    const entries = [entry(4, 'result', `token ${secret} and ${SECRET_MARK} here`)]
    for (const c of [
      cand({ body: secret, evidence: `token ${secret}` }),
      cand({ check: `curl -H ${secret}` }),
      cand({ head: `key ${secret}` }),
      cand({ type: 'fact', body: `uses ${SECRET_MARK}` }),
      cand({ evidence: `and ${SECRET_MARK} here` })
    ]) {
      expect(check([c], { entries })).toEqual({ kept: [], dropped: ['secret'] })
    }
  })

  it('the first failing step names the reason: shape, then tasks off, then secret, then quote', () => {
    const secret = 'gh' + 'p_' + 'x'.repeat(36)
    expect(check([task('A task', secret, { body: 'x' })], { tasksOn: false }).dropped).toEqual([
      'invalid'
    ])
    expect(check([task('A task', secret)], { tasksOn: false }).dropped).toEqual(['tasks_off'])
    expect(check([cand({ evidence: `not here ${secret}` })]).dropped).toEqual(['secret'])
  })

  it('a model answer with an unknown key or of the wrong shape never reaches the check', () => {
    const good = cand({})
    expect(ExtractOutputSchema.safeParse({ candidates: [good], note: '' }).success).toBe(true)
    expect(
      ExtractOutputSchema.safeParse({ candidates: [{ ...good, extra: 1 }], note: '' }).success
    ).toBe(false)
    expect(ExtractOutputSchema.safeParse({ candidates: [good], note: '', more: 1 }).success).toBe(
      false
    )
    expect(ExtractOutputSchema.safeParse({ candidates: good, note: '' }).success).toBe(false)
    expect(ExtractOutputSchema.safeParse([good]).success).toBe(false)
  })
})

describe('checkCandidates: episodes and progress notes', () => {
  it('an episode may take its evidence from a progress note, and then has no source', () => {
    expect(
      check([episode('Moved the port', 'The port moved.', NOTE)], {
        final: true,
        notes: [NOTE],
        entries: []
      }).kept
    ).toEqual([{ kind: 'episode', title: 'Moved the port', body: 'The port moved.', source: null }])
  })

  it('an episode whose evidence is in an entry has that entry as its source', () => {
    expect(
      check([episode('Moved the port', 'The port moved.', 'listening on http')], {
        final: true,
        notes: [NOTE]
      }).kept
    ).toEqual([
      {
        kind: 'episode',
        title: 'Moved the port',
        body: 'The port moved.',
        source: { entryId: 'e-3', quote: 'listening on http' }
      }
    ])
  })

  it('an episode whose evidence is in no entry and no note is dropped', () => {
    expect(
      check([episode('Moved', 'Moved.', 'Moved the API to port 9282')], {
        final: true,
        notes: [NOTE]
      })
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('an episode quote that begins or ends mid-word in a progress note is dropped', () => {
    for (const evidence of ['oved the API to port', 'Moved the API to port 928']) {
      expect(
        check([episode('Moved the port', 'The port moved.', evidence)], {
          final: true,
          notes: [NOTE],
          entries: []
        })
      ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
    }
  })

  it('a task may not take its evidence from a progress note', () => {
    expect(check([task('Update the docs', NOTE)], { notes: [NOTE] })).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
  })

  it('a specific or a fact may not take its evidence from a progress note', () => {
    expect(check([specific('API port', '9281', NOTE)], { notes: [NOTE] }).dropped).toEqual([
      'evidence_not_found'
    ])
    expect(check([fact('Moved', 'It moved.', NOTE)], { notes: [NOTE] }).dropped).toEqual([
      'evidence_not_found'
    ])
  })
})

describe('findValue', () => {
  it('findValue quotes the value with the text around it', () => {
    const before = 'b'.repeat(100)
    const after = 'a'.repeat(100)
    const entries = [
      entry(4, 'claude', `the port is 9281 now`),
      entry(5, 'result', `${before} port=9281;\n${after}`)
    ]
    expect(findValue('9281', entries)).toEqual({
      basis: 'observed',
      entryId: 'e-5',
      quote: `${'b'.repeat(54)} port=9281; ${'a'.repeat(58)}`
    })
    expect(findValue('9281', entries.slice(0, 1))).toEqual({
      basis: 'inferred',
      entryId: 'e-4',
      quote: 'the port is 9281 now'
    })
  })

  it('findValue is null for a value under 4 characters, a value not in the slice, or only in a non-evidence entry', () => {
    const entries = [entry(4, 'result', 'port 92 and 9281')]
    expect(findValue('92', entries)).toBeNull()
    expect(findValue('9282', entries)).toBeNull()
    expect(findValue('928', entries)).toBeNull()
    expect(
      findValue('9281', [entry(5, 'result', 'port 9281', { tool: 'WebSearch', evidence: false })])
    ).toBeNull()
  })

  it('findValue keeps the quote within 500 characters', () => {
    const value = 'v'.repeat(450)
    const entries = [entry(4, 'result', `${'b'.repeat(100)} ${value} ${'a'.repeat(100)}`)]
    const found = findValue(value, entries)
    expect(found?.quote.length).toBeLessThanOrEqual(500)
    expect(found?.quote).toContain(value)
    expect(findValue('v'.repeat(501), [entry(5, 'result', 'v'.repeat(501))])).toBeNull()
  })
})
