// The check of every candidate the model returns (addendum "Checking and writing candidates",
// D14–D17): a candidate is kept only when its quote is in ONE cleaned entry, with synthetic text.
import { describe, expect, it } from 'vitest'
import {
  CUT_END,
  CUT_MIDDLE,
  ExtractOutputSchema,
  SECRET_MARK,
  type ExtractCandidate
} from '../../../shared/schemas/memoryExtract'
import type { CleanEntry } from './sliceCleaner'
import { renderEntries } from './sliceCleaner'
import type { ScopeItem, ScopeTask } from './extractPrompt'
import {
  checkCandidates,
  findEvidence,
  findValue,
  normalise,
  type Basis,
  type Checked
} from './checkCandidates'

const entry = (
  n: number,
  kind: CleanEntry['kind'],
  text: string,
  over: Partial<CleanEntry> = {}
): CleanEntry => ({
  n,
  kind,
  tool: kind === 'tool' || kind === 'result' ? 'Bash' : null,
  status: kind === 'result' ? 'ok' : null,
  text,
  entryId: `e-${n}`,
  lineEnd: n * 10,
  evidence: true,
  ...over
})

const ENTRIES: CleanEntry[] = [
  entry(1, 'operator', 'Which port does the API use?'),
  entry(2, 'tool', '{"command":"ss -ltn"}'),
  entry(3, 'result', 'api listening on http://127.0.0.1:9281')
]

const cand = (over: Partial<ExtractCandidate>): ExtractCandidate => ({
  type: 'specific',
  action: 'add',
  id: null,
  head: 'API port',
  body: '9281',
  check: null,
  leftWith: null,
  evidence: 'api listening on http://127.0.0.1:9281',
  ...over
})
const specific = (head: string, value: string, evidence: string): ExtractCandidate =>
  cand({ head, body: value, evidence })
const fact = (head: string, body: string, evidence: string): ExtractCandidate =>
  cand({ type: 'fact', head, body, evidence })
const task = (
  head: string,
  evidence: string,
  over: Partial<ExtractCandidate> = {}
): ExtractCandidate =>
  cand({ type: 'task', head, body: null, leftWith: 'operator', evidence, ...over })
const episode = (head: string, body: string, evidence: string): ExtractCandidate =>
  cand({ type: 'episode', head, body, evidence })

type Ctx = Parameters<typeof checkCandidates>[1]
const check = (
  candidates: ExtractCandidate[],
  ctx: Partial<Ctx> = {}
): ReturnType<typeof checkCandidates> =>
  checkCandidates(
    { candidates, note: '' },
    {
      entries: ENTRIES,
      notes: [],
      final: false,
      tasksOn: true,
      items: [],
      tasks: [],
      operatorWrote: () => false,
      ...ctx
    }
  )

const NOTE = 'Moved the API to port 9281 and updated the docs.'
const RESULT_QUOTE = { entryId: 'e-3', quote: 'api listening on http://127.0.0.1:9281' }
const portItem = (basis: Basis): Extract<Checked, { kind: 'item' }> => ({
  kind: 'item',
  action: 'add',
  id: null,
  text: { kind: 'specific', key: 'API port', value: '9281' },
  check: null,
  basis,
  source: RESULT_QUOTE
})

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
    expect(check([specific('API url', 'http://', 'on http://127')]).kept).toHaveLength(1)
  })

  it('drops a specific whose value is a reworded form of the evidence', () => {
    expect(
      check([specific('API port', 'nine two eight one', 'api listening on http://127.0.0.1:9281')])
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
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
    const entries = [entry(4, 'result', long)]
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
        task('  Update the README ', 'Which port', { check: ' grep port README.md ' })
      ]).kept
    ).toEqual([
      { ...portItem('observed'), check: 'ss -ltn' },
      {
        kind: 'task',
        action: 'add',
        id: null,
        title: 'Update the README',
        check: 'grep port README.md',
        leftWith: 'operator'
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

const ITEMS: ScopeItem[] = [
  { id: 'i-1', kind: 'specific', head: 'API port', body: '9280' },
  { id: 'i-2', kind: 'fact', head: 'Build', body: 'make  all\nbuilds it.' }
]
/** No scope item shares the port's head, so an add stays an add. */
const FACT_ONLY = ITEMS.slice(1)
const TASKS: ScopeTask[] = [{ id: 't-1', title: 'Update the README' }]

describe('checkCandidates: reconcile', () => {
  it('an update of an id that was not in scope becomes an add', () => {
    expect(check([cand({ action: 'update', id: 'i-404' })], { items: FACT_ONLY }).kept).toEqual([
      portItem('observed')
    ])
    expect(check([cand({ action: 'none', id: 'i-404' })], { items: FACT_ONLY }).kept).toEqual([
      portItem('observed')
    ])
  })

  it('an update of an id of another kind becomes an add', () => {
    expect(check([cand({ action: 'update', id: 'i-2' })], { items: FACT_ONLY }).kept).toEqual([
      portItem('observed')
    ])
  })

  it('an update of a scope item keeps its id', () => {
    expect(check([cand({ action: 'update', id: 'i-1' })], { items: ITEMS }).kept).toEqual([
      { ...portItem('observed'), action: 'update', id: 'i-1' }
    ])
  })

  it('an add with the head of a saved item becomes an update of it, or a none when the text is the same', () => {
    expect(check([cand({ head: ' api PORT ' })], { items: ITEMS }).kept).toEqual([
      {
        ...portItem('observed'),
        action: 'update',
        id: 'i-1',
        text: { kind: 'specific', key: 'api PORT', value: '9281' }
      }
    ])
    const same = [{ id: 'i-1', kind: 'specific' as const, head: 'API port', body: '9281' }]
    expect(check([cand({})], { items: same }).kept).toEqual([
      { ...portItem('observed'), action: 'none', id: 'i-1' }
    ])
    // same head, other kind: stays an add
    const otherKind = [{ id: 'i-3', kind: 'fact' as const, head: 'API port', body: '9281' }]
    expect(check([cand({})], { items: otherKind }).kept).toEqual([portItem('observed')])
  })

  it('an update that would change nothing is a none; whitespace in the body does not count', () => {
    expect(
      check(
        [
          cand({
            ...fact('Build', 'make all builds it.', 'Which port'),
            action: 'update',
            id: 'i-2'
          })
        ],
        {
          items: ITEMS
        }
      ).kept
    ).toEqual([
      {
        kind: 'item',
        action: 'none',
        id: 'i-2',
        text: { kind: 'fact', title: 'Build', body: 'make all builds it.' },
        check: null,
        basis: 'stated',
        source: { entryId: 'e-1', quote: 'Which port' }
      }
    ])
  })

  it('an update that changes only the case of the head stays an update', () => {
    const same = [{ id: 'i-1', kind: 'specific' as const, head: 'API port', body: '9281' }]
    expect(
      check([cand({ action: 'update', id: 'i-1', head: 'api port' })], { items: same }).kept
    ).toEqual([
      {
        ...portItem('observed'),
        action: 'update',
        id: 'i-1',
        text: { kind: 'specific', key: 'api port', value: '9281' }
      }
    ])
  })

  it('never updates an item the operator wrote', () => {
    const operatorWrote = (id: string): boolean => id === 'i-1'
    expect(check([cand({ action: 'update', id: 'i-1' })], { items: ITEMS, operatorWrote })).toEqual(
      { kept: [], dropped: ['operator_item'] }
    )
    // an add that reconciles to an update of it is dropped too
    expect(check([cand({})], { items: ITEMS, operatorWrote })).toEqual({
      kept: [],
      dropped: ['operator_item']
    })
    // a none only marks it seen
    const same = [{ id: 'i-1', kind: 'specific' as const, head: 'API port', body: '9281' }]
    expect(check([cand({})], { items: same, operatorWrote }).kept).toEqual([
      { ...portItem('observed'), action: 'none', id: 'i-1' }
    ])
  })

  it('an added task with the title of an open task becomes an update of it', () => {
    expect(check([task(' update the readme ', 'Which port')], { tasks: TASKS }).kept).toEqual([
      {
        kind: 'task',
        action: 'update',
        id: 't-1',
        title: 'update the readme',
        check: null,
        leftWith: 'operator'
      }
    ])
  })

  it('a task update of an id not in scope is an add, and a task none is an update', () => {
    expect(
      check([task('Other', 'Which port', { action: 'update', id: 't-404' })], { tasks: TASKS }).kept
    ).toEqual([
      { kind: 'task', action: 'add', id: null, title: 'Other', check: null, leftWith: 'operator' }
    ])
    expect(
      check([task('Other', 'Which port', { action: 'none', id: 't-1', leftWith: 'session' })], {
        tasks: TASKS
      }).kept
    ).toEqual([
      {
        kind: 'task',
        action: 'update',
        id: 't-1',
        title: 'Other',
        check: null,
        leftWith: 'session'
      }
    ])
    expect(
      check([task('Other', 'Which port', { action: 'none', id: 't-404' })], { tasks: TASKS }).kept
    ).toEqual([
      { kind: 'task', action: 'add', id: null, title: 'Other', check: null, leftWith: 'operator' }
    ])
  })

  it('keeps every candidate that passes, in order, and counts each drop', () => {
    const out = check([
      cand({}),
      specific('API port', '9280', RESULT_QUOTE.quote),
      task('Update the README', 'Which port'),
      cand({ body: 'a\nb' })
    ])
    expect(out.kept.map((k) => k.kind)).toEqual(['item', 'task'])
    expect(out.dropped).toEqual(['evidence_not_found', 'invalid'])
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
