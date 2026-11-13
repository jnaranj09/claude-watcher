// The reconcile step of the candidate check (addendum step 5, D16, D17, R11, P3-R1) and twins
// inside one model answer (R20), with synthetic text.
import { describe, expect, it } from 'vitest'
import type { ScopeItem, ScopeTask } from './extractPrompt'
import {
  ENTRIES,
  RESULT_QUOTE,
  cand,
  check,
  entry,
  fact,
  portItem,
  specific,
  task
} from '../../../__fixtures__/extractCandidates'

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

  it('R11: a none whose value differs from the saved one is an update, with the basis of its quote', () => {
    expect(check([cand({ action: 'none', id: 'i-1' })], { items: ITEMS }).kept).toEqual([
      { ...portItem('observed'), action: 'update', id: 'i-1' }
    ])
  })

  it('R11: a none whose value differs is dropped when the operator wrote the item', () => {
    expect(
      check([cand({ action: 'none', id: 'i-1' })], {
        items: ITEMS,
        operatorWrote: (id) => id === 'i-1'
      })
    ).toEqual({ kept: [], dropped: ['operator_item'] })
  })

  it('R11: a none whose value differs and is not in its quote is dropped, never kept as a sighting', () => {
    expect(check([cand({ action: 'none', id: 'i-1', body: '9282' })], { items: ITEMS })).toEqual({
      kept: [],
      dropped: ['evidence_not_found']
    })
  })

  it('R11: a none whose value equals the saved one stays a none, even when the operator wrote it', () => {
    const same = [{ id: 'i-1', kind: 'specific' as const, head: 'API port', body: '9281' }]
    expect(
      check([cand({ action: 'none', id: 'i-1' })], { items: same, operatorWrote: () => true }).kept
    ).toEqual([{ ...portItem('observed'), action: 'none', id: 'i-1' }])
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
        leftWith: 'operator',
        basis: 'stated'
      }
    ])
  })

  it('a task update of an id not in scope is an add, and a task none is an update', () => {
    expect(
      check([task('Other', 'Which port', { action: 'update', id: 't-404' })], { tasks: TASKS }).kept
    ).toEqual([
      {
        kind: 'task',
        action: 'add',
        id: null,
        title: 'Other',
        check: null,
        leftWith: 'operator',
        basis: 'stated'
      }
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
        leftWith: 'session',
        basis: 'stated'
      }
    ])
    expect(
      check([task('Other', 'Which port', { action: 'none', id: 't-404' })], { tasks: TASKS }).kept
    ).toEqual([
      {
        kind: 'task',
        action: 'add',
        id: null,
        title: 'Other',
        check: null,
        leftWith: 'operator',
        basis: 'stated'
      }
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

describe("checkCandidates: an update only claude's own words support (P3-R1)", () => {
  const SAID = entry(4, 'claude', 'The API port is 9300 now.')
  const withSaid = { items: ITEMS, entries: [...ENTRIES, SAID] }
  const said9300 = { body: '9300', evidence: 'The API port is 9300 now.' }

  it("P3-R1: an update whose value stands only in claude's own text is dropped as claude_only", () => {
    expect(check([cand({ action: 'update', id: 'i-1', ...said9300 })], withSaid)).toEqual({
      kept: [],
      dropped: ['claude_only']
    })
  })

  it('P3-R1: a none that R11 turns into an update is dropped when only claude said the new value', () => {
    expect(check([cand({ action: 'none', id: 'i-1', ...said9300 })], withSaid)).toEqual({
      kept: [],
      dropped: ['claude_only']
    })
  })

  it('P3-R1: an add that D17 turns into an update is dropped when only claude said it', () => {
    expect(check([cand({ head: 'api  PORT', ...said9300 })], withSaid)).toEqual({
      kept: [],
      dropped: ['claude_only']
    })
  })

  it("P3-R1: an update whose value stands only in a tool call's arguments is dropped", () => {
    const args = '{"command":"sed -i s/9280/9300/ config.ini"}'
    expect(
      check([cand({ action: 'update', id: 'i-1', body: '9300', evidence: args })], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'tool', args)]
      })
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-R1: a fact claude reworded is dropped, not rewritten', () => {
    const reworded = 'Running make all builds the whole project.'
    expect(
      check(
        [
          cand({
            type: 'fact',
            action: 'update',
            id: 'i-2',
            head: 'Build',
            body: reworded,
            evidence: reworded
          })
        ],
        { items: ITEMS, entries: [...ENTRIES, entry(4, 'claude', reworded)] }
      )
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-R1: the same update with its value in a tool result is kept as observed', () => {
    expect(check([cand({ action: 'update', id: 'i-1' })], { items: ITEMS }).kept).toEqual([
      { ...portItem('observed'), action: 'update', id: 'i-1' }
    ])
  })

  it('P3-R1: a new item only claude said is still added, as inferred', () => {
    const line = 'We build with pnpm here.'
    expect(
      check([cand({ head: 'Build tool', body: 'pnpm', evidence: line })], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'claude', line)]
      })
    ).toEqual({
      kept: [
        {
          kind: 'item',
          action: 'add',
          id: null,
          text: { kind: 'specific', key: 'Build tool', value: 'pnpm' },
          check: null,
          basis: 'inferred',
          source: { entryId: 'e-4', quote: line }
        }
      ],
      dropped: []
    })
  })

  it("P3-R1: an update the operator's text supports is kept as stated", () => {
    const line = 'Move the API port to 9300.'
    expect(
      check([cand({ action: 'update', id: 'i-1', body: '9300', evidence: line })], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'operator', line)]
      }).kept
    ).toEqual([
      {
        kind: 'item',
        action: 'update',
        id: 'i-1',
        text: { kind: 'specific', key: 'API port', value: '9300' },
        check: null,
        basis: 'stated',
        source: { entryId: 'e-4', quote: line }
      }
    ])
  })

  it('P3-R1: a quote claude repeats after a tool result shows it is kept as observed', () => {
    const line = 'api listening on 9300'
    const entries = [entry(4, 'claude', line), entry(5, 'result', line)]
    expect(
      check([cand({ action: 'update', id: 'i-1', body: '9300', evidence: line })], {
        items: ITEMS,
        entries
      }).kept
    ).toEqual([
      {
        kind: 'item',
        action: 'update',
        id: 'i-1',
        text: { kind: 'specific', key: 'API port', value: '9300' },
        check: null,
        basis: 'observed',
        source: { entryId: 'e-5', quote: line }
      }
    ])
  })

  it("P3-R1: a quote that runs from a tool result into claude's text is not found", () => {
    const entries = [entry(4, 'result', 'api listening on'), entry(5, 'claude', '9300 from now on')]
    expect(
      check(
        [
          cand({
            action: 'update',
            id: 'i-1',
            body: '9300',
            evidence: 'api listening on 9300 from now on'
          })
        ],
        { items: ITEMS, entries }
      )
    ).toEqual({ kept: [], dropped: ['evidence_not_found'] })
  })

  it('P3-R1: a none claude restates with the saved value stays a none, as inferred', () => {
    const line = 'The API port is 9280, as memory says.'
    expect(
      check([cand({ action: 'none', id: 'i-1', body: '9280', evidence: line })], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'claude', line)]
      })
    ).toEqual({
      kept: [
        {
          kind: 'item',
          action: 'none',
          id: 'i-1',
          text: { kind: 'specific', key: 'API port', value: '9280' },
          check: null,
          basis: 'inferred',
          source: { entryId: 'e-4', quote: line }
        }
      ],
      dropped: []
    })
  })

  it('P3-R1: an update of an item the operator wrote is still dropped as operator_item, whatever its basis', () => {
    expect(
      check([cand({ action: 'update', id: 'i-1', ...said9300 })], {
        ...withSaid,
        operatorWrote: (id) => id === 'i-1'
      })
    ).toEqual({ kept: [], dropped: ['operator_item'] })
  })
})

describe('checkCandidates: twins in one answer (R20)', () => {
  const entries = [entry(4, 'result', 'api listening on 9281, admin on 9282')]
  const Q = 'api listening on 9281'

  it('a second add of a specific with the same key, after case and whitespace, is dropped; the first wins', () => {
    expect(
      check([specific('API  port', '9281', Q), specific(' api port', '9282', 'admin on 9282')], {
        entries
      })
    ).toEqual({
      kept: [
        {
          kind: 'item',
          action: 'add',
          id: null,
          text: { kind: 'specific', key: 'API  port', value: '9281' },
          check: null,
          basis: 'observed',
          source: { entryId: 'e-4', quote: Q }
        }
      ],
      dropped: ['invalid']
    })
  })

  it('a second add of a fact with the same title is dropped', () => {
    const out = check([fact('Port', 'It is 9281.', Q), fact('port', 'Also 9281.', Q)], { entries })
    expect(out.kept.map((k) => (k.kind === 'item' ? k.text : null))).toEqual([
      { kind: 'fact', title: 'Port', body: 'It is 9281.' }
    ])
    expect(out.dropped).toEqual(['invalid'])
  })

  it('a second add of a task with the same title is dropped', () => {
    expect(
      check([task('Do X', Q), task('do  x', Q, { leftWith: 'session' })], { entries })
    ).toEqual({
      kept: [
        {
          kind: 'task',
          action: 'add',
          id: null,
          title: 'Do X',
          check: null,
          leftWith: 'operator',
          basis: 'observed'
        }
      ],
      dropped: ['invalid']
    })
  })

  it('a specific and a fact with the same head are not twins', () => {
    const out = check([specific('Port', '9281', Q), fact('Port', 'It is 9281.', Q)], { entries })
    expect(out.kept.map((k) => (k.kind === 'item' ? k.text.kind : k.kind))).toEqual([
      'specific',
      'fact'
    ])
    expect(out.dropped).toEqual([])
  })

  it('an update and an add that hit the same saved item: the first is kept, the second dropped', () => {
    const items: ScopeItem[] = [{ id: 'i-1', kind: 'specific', head: 'API port', body: '9280' }]
    // the add's head equals the saved item's, so D17 makes it an update of i-1 too
    const out = check(
      [
        cand({ action: 'update', id: 'i-1', evidence: Q }),
        specific('api port', '9282', 'admin on 9282')
      ],
      { entries, items }
    )
    expect(out.kept).toEqual([
      {
        kind: 'item',
        action: 'update',
        id: 'i-1',
        text: { kind: 'specific', key: 'API port', value: '9281' },
        check: null,
        basis: 'observed',
        source: { entryId: 'e-4', quote: Q }
      }
    ])
    expect(out.dropped).toEqual(['invalid'])
    // and two task updates of one open task
    const twice = check(
      [
        task('Update the README', Q, { action: 'update', id: 't-1' }),
        task('Other', Q, { action: 'none', id: 't-1' })
      ],
      { entries, tasks: TASKS }
    )
    expect(twice.kept.map((k) => (k.kind === 'task' ? k.title : null))).toEqual([
      'Update the README'
    ])
    expect(twice.dropped).toEqual(['invalid'])
  })

  it('a first copy that is dropped registers nothing: the second, valid copy of a specific is kept', () => {
    expect(
      check(
        [specific('API port', '9281', 'api listening on 9283'), specific('api port', '9281', Q)],
        {
          entries
        }
      )
    ).toEqual({
      kept: [
        {
          kind: 'item',
          action: 'add',
          id: null,
          text: { kind: 'specific', key: 'api port', value: '9281' },
          check: null,
          basis: 'observed',
          source: { entryId: 'e-4', quote: Q }
        }
      ],
      dropped: ['evidence_not_found']
    })
  })

  it('a first copy that is dropped registers nothing: the second, valid copy of a task is kept', () => {
    expect(check([task('Do X', 'not in the slice at all'), task('do x', Q)], { entries })).toEqual({
      kept: [
        {
          kind: 'task',
          action: 'add',
          id: null,
          title: 'do x',
          check: null,
          leftWith: 'operator',
          basis: 'observed'
        }
      ],
      dropped: ['evidence_not_found']
    })
  })

  it('a none and an update of the same saved item: the first is kept, the second dropped', () => {
    const items: ScopeItem[] = [{ id: 'i-1', kind: 'specific', head: 'API port', body: '9281' }]
    const out = check(
      [
        cand({ action: 'none', id: 'i-1', evidence: Q }),
        cand({ action: 'update', id: 'i-1', body: '9282', evidence: 'admin on 9282' })
      ],
      { entries, items }
    )
    expect(out.kept.map((k) => (k.kind === 'item' ? [k.action, k.id] : null))).toEqual([
      ['none', 'i-1']
    ])
    expect(out.dropped).toEqual(['invalid'])
  })

  it('R20 after P3-R1: a claude_only drop claims nothing, so a later update of the same item is kept', () => {
    const items: ScopeItem[] = [{ id: 'i-1', kind: 'specific', head: 'API port', body: '9280' }]
    const said = 'The API port is 9281 now.'
    const out = check(
      [
        cand({ action: 'update', id: 'i-1', evidence: said }),
        cand({ action: 'update', id: 'i-1', evidence: Q })
      ],
      { entries: [...entries, entry(5, 'claude', said)], items }
    )
    expect(out).toEqual({
      kept: [
        {
          kind: 'item',
          action: 'update',
          id: 'i-1',
          text: { kind: 'specific', key: 'API port', value: '9281' },
          check: null,
          basis: 'observed',
          source: { entryId: 'e-4', quote: Q }
        }
      ],
      dropped: ['claude_only']
    })
  })

  it('a fact and a task with one title are not twins', () => {
    const out = check([fact('Do X', 'X needs doing.', Q), task('Do X', Q)], { entries })
    expect(out.kept.map((k) => k.kind)).toEqual(['item', 'task'])
    expect(out.dropped).toEqual([])
  })

  it('D17 compares heads with whitespace collapsed: two spacings of a saved head both reach it, the second as a twin', () => {
    const items: ScopeItem[] = [{ id: 'i-1', kind: 'specific', head: 'API port', body: '9280' }]
    const out = check(
      [specific('API  port', '9281', Q), specific('api port', '9282', 'admin on 9282')],
      {
        entries,
        items
      }
    )
    expect(out.kept.map((k) => (k.kind === 'item' ? [k.action, k.id, k.text] : null))).toEqual([
      ['update', 'i-1', { kind: 'specific', key: 'API  port', value: '9281' }]
    ])
    expect(out.dropped).toEqual(['invalid'])
    // and a task title with other spacing is an update of the open task
    expect(check([task('Update  the README', Q)], { entries, tasks: TASKS }).kept).toEqual([
      {
        kind: 'task',
        action: 'update',
        id: 't-1',
        title: 'Update  the README',
        check: null,
        leftWith: 'operator',
        basis: 'observed'
      }
    ])
  })

  it('the same key in two scopes is not a twin: an update of a saved item and an add of a new one', () => {
    // i-g's key is not `API port`, so the add stays a new item in the session's workspace while
    // the update renames i-g (which may be global): two different targets.
    const items: ScopeItem[] = [
      { id: 'i-g', kind: 'specific', head: 'Old port name', body: '9280' }
    ]
    const out = check(
      [
        cand({ action: 'update', id: 'i-g', evidence: Q }),
        specific('API port', '9282', 'admin on 9282')
      ],
      { entries, items }
    )
    expect(out.kept.map((k) => (k.kind === 'item' ? [k.action, k.id] : null))).toEqual([
      ['update', 'i-g'],
      ['add', null]
    ])
    expect(out.dropped).toEqual([])
  })
})
