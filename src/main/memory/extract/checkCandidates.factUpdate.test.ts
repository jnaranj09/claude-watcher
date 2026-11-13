// P3-C6: a fact update is kept only when its new body brings an exact value (a token with a digit,
// `_`, `/` or `.`) the old body lacks, and every such value stands whole in the entry its quote was
// found in. Every path that ends in a fact update: asked for, D17 (an add), R11 (a none).
// Synthetic text.
import { describe, expect, it } from 'vitest'
import type { ExtractCandidate } from '../../../shared/schemas/memoryExtract'
import type { ScopeItem } from './extractPrompt'
import { ENTRIES, cand, check, entry } from '../../../__fixtures__/extractCandidates'

const OLD = 'Deploys run from release/v2.3 on port 9280.'
const ITEMS: ScopeItem[] = [{ id: 'f-1', kind: 'fact', head: 'Deploy', body: OLD }]
const SWITCHED = 'switched the deploy branch to release/v2.4'
/** e-4: a tool result that names the new branch only. */
const WITH_RESULT = [...ENTRIES, entry(4, 'result', SWITCHED)]

/** A fact candidate for `Deploy` through each path that ends in an update of f-1, and the title
 *  the kept update carries. */
const PATHS: [string, Partial<ExtractCandidate>, string][] = [
  ['a model update', { action: 'update', id: 'f-1' }, 'Deploy'],
  ['an add D17 makes an update', { action: 'add', id: null, head: ' deploy ' }, 'deploy'],
  ['a none R11 makes an update', { action: 'none', id: 'f-1' }, 'Deploy']
]
const factCand = (
  over: Partial<ExtractCandidate>,
  body: string,
  evidence: string
): ExtractCandidate => cand({ type: 'fact', head: 'Deploy', body, evidence, ...over })

describe('checkCandidates: a fact update needs a new exact value its evidence holds (P3-C6)', () => {
  it.each(PATHS)(
    'P3-C6: %s that only rewords the fact, quoting an unrelated tool result, is dropped as claude_only',
    (_, over) => {
      const reworded = 'Every deploy starts from release/v2.3, on port 9280.'
      expect(
        check([factCand(over, reworded, 'api listening on http://127.0.0.1:9281')], {
          items: ITEMS
        })
      ).toEqual({ kept: [], dropped: ['claude_only'] })
    }
  )

  it.each(PATHS)(
    'P3-C6: %s whose new value stands in the tool result it quotes is kept as observed',
    (_, over, title) => {
      const body = 'Deploys run from release/v2.4 on port 9280.'
      expect(
        check([factCand(over, body, SWITCHED)], { items: ITEMS, entries: WITH_RESULT })
      ).toEqual({
        kept: [
          {
            kind: 'item',
            action: 'update',
            id: 'f-1',
            text: { kind: 'fact', title, body },
            check: null,
            basis: 'observed',
            source: { entryId: 'e-4', quote: SWITCHED }
          }
        ],
        dropped: []
      })
    }
  )

  it.each(PATHS)(
    "P3-C6: %s whose new value stands only in claude's own text is dropped as claude_only",
    (_, over) => {
      const body = 'Deploys run from release/v2.4 on port 9280.'
      const entries = [...ENTRIES, entry(4, 'claude', 'From now on deploys use release/v2.4.')]
      expect(
        check([factCand(over, body, 'api listening on http://127.0.0.1:9281')], {
          items: ITEMS,
          entries
        })
      ).toEqual({ kept: [], dropped: ['claude_only'] })
    }
  )

  it.each(PATHS)(
    'P3-C6: %s with two new values, one missing from its evidence entry, is dropped as claude_only',
    (_, over) => {
      const body = 'Deploys run from release/v2.4 on port 9300.'
      expect(
        check([factCand(over, body, SWITCHED)], { items: ITEMS, entries: WITH_RESULT })
      ).toEqual({ kept: [], dropped: ['claude_only'] })
    }
  )

  it("P3-C6: a new value in the operator's text it quotes is kept as stated", () => {
    const line = 'Please deploy from release/v2.4 from now on.'
    const body = 'Deploys run from release/v2.4 on port 9280.'
    expect(
      check([factCand({ action: 'update', id: 'f-1' }, body, line)], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'operator', line)]
      }).kept
    ).toEqual([
      {
        kind: 'item',
        action: 'update',
        id: 'f-1',
        text: { kind: 'fact', title: 'Deploy', body },
        check: null,
        basis: 'stated',
        source: { entryId: 'e-4', quote: line }
      }
    ])
  })

  it('P3-C6: a new value that stands in another tool result, not the quoted one, is dropped', () => {
    const body = 'Deploys run from release/v2.4 on port 9280.'
    const entries = [...ENTRIES, entry(4, 'result', 'release/v2.4 created')]
    expect(
      check(
        [factCand({ action: 'update', id: 'f-1' }, body, 'api listening on http://127.0.0.1:9281')],
        {
          items: ITEMS,
          entries
        }
      )
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C6: a new value the quoted entry holds only inside a longer token is dropped', () => {
    const body = 'Deploys run from release/v2.4 on port 9280.'
    const line = 'switched the deploy branch to release/v2.45'
    expect(
      check([factCand({ action: 'update', id: 'f-1' }, body, line)], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'result', line)]
      })
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C6: a value that differs from the old one only in case is not new', () => {
    const body = 'Deploys run from RELEASE/V2.3 on port 9280.'
    const line = 'branch RELEASE/V2.3 is live'
    expect(
      check([factCand({ action: 'update', id: 'f-1' }, body, line)], {
        items: ITEMS,
        entries: [...ENTRIES, entry(4, 'result', line)]
      })
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C6: a new path alone (no digit, `_` or `.`) that its evidence lacks is dropped', () => {
    const items: ScopeItem[] = [{ id: 'f-2', kind: 'fact', head: 'Ports', body: 'port 9280' }]
    const line = 'moved to port 9300 ok'
    expect(
      check(
        [
          factCand({ action: 'update', id: 'f-2', head: 'Ports' }, 'deploy/prod on port 9300', line)
        ],
        { items, entries: [...ENTRIES, entry(4, 'result', line)] }
      )
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C11: an update that only renames the fact, body unchanged, is dropped as claude_only', () => {
    expect(
      check([factCand({ action: 'update', id: 'f-1', head: 'Release flow' }, OLD, SWITCHED)], {
        items: ITEMS,
        entries: WITH_RESULT
      })
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C11: a short new value (under 4 characters) its evidence holds does not update a fact', () => {
    const items: ScopeItem[] = [{ id: 'f-3', kind: 'fact', head: 'Runtime', body: 'Uses Node 20.' }]
    const line = 'node now reports major 22'
    expect(
      check([factCand({ action: 'update', id: 'f-3', head: 'Runtime' }, 'Uses Node 22.', line)], {
        items,
        entries: [...ENTRIES, entry(4, 'result', line)]
      })
    ).toEqual({ kept: [], dropped: ['claude_only'] })
  })

  it('P3-C6: a new fact with no exact value is still added', () => {
    const body = 'Deploys need a green build first.'
    expect(
      check([factCand({ head: 'Deploy rule' }, body, 'api listening on http://127.0.0.1:9281')], {
        items: ITEMS
      }).kept
    ).toEqual([
      {
        kind: 'item',
        action: 'add',
        id: null,
        text: { kind: 'fact', title: 'Deploy rule', body },
        check: null,
        basis: 'observed',
        source: { entryId: 'e-3', quote: 'api listening on http://127.0.0.1:9281' }
      }
    ])
  })
})
