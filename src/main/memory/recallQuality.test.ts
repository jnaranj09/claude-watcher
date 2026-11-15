// Recall quality on a synthetic store: a MEASUREMENT of what recall does today, not a target.
// Every prompt of `RECALL_CASES` goes through the real recall service (the gate, the terms, the
// floor, the order, the budgets) on a real `:memory:` database, each in a conversation window of
// its own, so "once per window" and the window budget never carry from one case to the next.
//
// The lists below name the cases that miss today and the cases that get a block they should not.
// They change ONLY in a commit that changes recall on purpose, and that commit says the old and
// the new numbers. A case that starts passing is taken off its list in that same commit.
import { describe, expect, it } from 'vitest'
import { RECALL_CASES, RECALL_SEEDS } from '../../__fixtures__/memoryRecallCases'
import { openMemoryDb } from './memoryDb'
import { createMemoryGate } from './memoryGate'
import { createMemoryRecall } from './memoryRecall'
import { createMemoryStore } from './memoryStore'
import type { MemorySessionMeta } from './memoryTools'

const NOW = 1_762_800_000_000
const SESSION: MemorySessionMeta = {
  workspaceId: 'w1',
  folder: '/work/app',
  sessionName: 'recall quality',
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}
const NO_META = {
  folder: null,
  sessionName: null,
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}
const WORKSPACE = { global: null, other: 'w2' } as const
const HITS = RECALL_CASES.filter((c) => c.expect !== null)
const SILENT = RECALL_CASES.filter((c) => c.expect === null)

/** Each case's name → the refs of the items its recall block lists. */
function blocks(): Map<string, string[]> {
  const open = openMemoryDb(':memory:', { now: () => NOW, log: () => undefined })
  if (!open.ok) throw new Error('open failed')
  let clock = NOW
  let ids = 0
  const store = createMemoryStore({
    db: open.db,
    now: () => clock,
    newId: () => `m${++ids}`,
    report: () => undefined,
    log: () => undefined
  })
  const refOf = new Map<string, string>()
  for (const seed of RECALL_SEEDS) {
    clock += 1000
    const item = store.add({
      text: seed.text,
      workspaceId: seed.where === undefined ? 'w1' : WORKSPACE[seed.where],
      check: null,
      basis: 'observed',
      origin: { by: 'extract', sessionId: 's0' },
      meta: NO_META,
      source: null
    })
    refOf.set(item.id, seed.ref)
    if (seed.stale === true) store.setState(item.id, 'stale', 'operator', null)
    if (seed.pinned === true) store.setPinned(item.id, true)
  }
  const recall = createMemoryRecall({
    gate: createMemoryGate({ enabled: () => true, store: () => store, session: () => SESSION }),
    tasks: () => null,
    names: { goalName: () => null, tagName: () => null },
    activity: {
      injected: () => undefined,
      record: () => undefined,
      get: () => ({ injected: null, entries: [], recall: null })
    },
    operatorOrigins: new Set(['composer']),
    now: () => clock,
    log: () => undefined
  })
  const given = new Map<string, string[]>()
  RECALL_CASES.forEach((c, window) => {
    const answer = recall.recall(
      { sessionId: 's1' },
      { version: 1, window, origin: 'composer', text: c.prompt }
    )
    if (!answer.ok) throw new Error('recall refused')
    given.set(
      c.name,
      Array.from(answer.text.matchAll(/ id=(\S+)$/gm), (m) => refOf.get(m[1] ?? '') ?? '')
    )
  })
  return given
}

describe('recall quality on the synthetic fixture', () => {
  it('the fixture is sound', () => {
    const refs = RECALL_SEEDS.map((s) => s.ref)
    const names = RECALL_CASES.map((c) => c.name)
    expect(new Set(refs).size).toBe(refs.length)
    expect(new Set(names).size).toBe(names.length)
    expect(HITS.filter((c) => !refs.includes(c.expect ?? ''))).toEqual([])
    expect([RECALL_SEEDS.length, HITS.length, SILENT.length]).toEqual([41, 30, 20])
  })

  it('the expected item is in the block (at most 3 items) for 23 of 30 prompts', () => {
    const given = blocks()
    const missed = HITS.filter((c) => !(given.get(c.name) ?? []).includes(c.expect ?? ''))
    expect(missed.map((c) => c.name)).toEqual([
      'key words, four items share them',
      'plural of the key word',
      'plural and a two-letter word',
      'one key word only',
      'one key word and a partial version',
      'version without its v',
      'other words for the same thing'
    ])
    expect(HITS.length - missed.length).toBe(23)
    expect(Math.max(...[...given.values()].map((refs) => refs.length))).toBe(3)
  })

  it('nothing is added for 18 of 20 prompts that fit nothing', () => {
    const given = blocks()
    const injected = SILENT.filter((c) => (given.get(c.name) ?? []).length > 0)
    expect(injected.map((c) => c.name)).toEqual([
      'two shared words about another thing',
      'a bare number that is also a saved value'
    ])
    expect(SILENT.length - injected.length).toBe(18)
  })
})
