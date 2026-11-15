// What a session's memory section lists, on a synthetic store: a MEASUREMENT, not a target. Each
// session context of `CONTEXT_SESSIONS` gets the real section builder on a real `:memory:`
// database seeded with `CONTEXT_SEEDS`; an `either` case also runs its prompt through the real
// recall service, in a conversation window of its own, with no section asked first.
//
// The lists and numbers below name what each session misses and lists wrongly today. They change
// ONLY in a commit that changes the selection on purpose, and that commit says the old and the
// new numbers. A case that starts passing is taken off its list in that same commit.
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_CASES,
  CONTEXT_HIDDEN,
  CONTEXT_SEEDS,
  CONTEXT_SESSIONS,
  CONTEXT_WRONG,
  type ContextSessionName
} from '../../__fixtures__/memoryContextCases'
import { MEMORY_LIMITS } from '../../shared/schemas/memory'
import { openMemoryDb } from './memoryDb'
import { createMemoryGate } from './memoryGate'
import { MEMORY_LIVE_RULES, MEMORY_RULES_OF_USE } from './memoryIndex'
import { createMemoryRecall } from './memoryRecall'
import { createMemoryStore } from './memoryStore'
import type { MemorySessionMeta } from './memoryTools'
import { buildSessionIndex, sessionContext } from './sessionIndex'

const NOW = 1_762_800_000_000
const WORKSPACE = { global: null, other: 'w2' } as const
const GOAL_NAMES: Record<string, string> = { gA: 'Goal A', gB: 'Goal B' }
const TAG_NAMES: Record<string, string> = { tCommon: 'common', tRare: 'rare' }
const LOOKUPS = {
  goalName: (id: string): string | null => GOAL_NAMES[id] ?? null,
  tagName: (id: string): string | null => TAG_NAMES[id] ?? null
}

function seeded(): {
  store: ReturnType<typeof createMemoryStore>
  refOf: Map<string, string>
  now: () => number
} {
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
  for (const seed of CONTEXT_SEEDS) {
    clock += 1000
    const item = store.add({
      text: seed.text,
      workspaceId: seed.where === undefined ? 'w1' : WORKSPACE[seed.where],
      check: seed.check ?? null,
      basis: seed.operator === true ? 'stated' : 'observed',
      origin: {
        by: seed.operator === true ? 'operator' : 'extract',
        sessionId: seed.sessionDeleted === true ? 'gone' : 's0'
      },
      meta: {
        folder: null,
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: [],
        ...seed.meta
      },
      source: null
    })
    refOf.set(item.id, seed.ref)
    if (seed.stale === true) store.setState(item.id, 'stale', 'operator', null)
    if (seed.pinned === true) store.setPinned(item.id, true)
  }
  store.markSessionDeleted('gone')
  return { store, refOf, now: () => clock }
}

const { store, refOf, now } = seeded()

function meta(name: ContextSessionName): MemorySessionMeta {
  const session = CONTEXT_SESSIONS.find((s) => s.name === name)
  if (session === undefined) throw new Error(`no session ${name}`)
  return session.meta
}

function sectionFor(name: ContextSessionName): { text: string; itemIds: string[] } {
  const session = meta(name)
  return buildSessionIndex(
    { tasks: () => null, now, names: LOOKUPS },
    store,
    { workspaceId: 'w1', context: sessionContext(session), excludeTaskIds: [] },
    `${MEMORY_RULES_OF_USE}\n${MEMORY_LIVE_RULES}`
  )
}

const NAMES = CONTEXT_SESSIONS.map((s) => s.name)
const listedRefs = (name: ContextSessionName): string[] =>
  sectionFor(name).itemIds.map((id) => refOf.get(id) ?? id)

/** The refs the recall block of `prompt` lists, for a session of `name`, in a window of its own. */
function recalled(name: ContextSessionName, prompt: string, window: number): string[] {
  const recall = createMemoryRecall({
    gate: createMemoryGate({ enabled: () => true, store: () => store, session: () => meta(name) }),
    tasks: () => null,
    names: LOOKUPS,
    activity: { injected: () => undefined, record: () => undefined },
    operatorOrigins: new Set(['composer']),
    now,
    log: () => undefined
  })
  const answer = recall.recall(
    { sessionId: 's1' },
    { version: 1, window, origin: 'composer', text: prompt }
  )
  if (!answer.ok) throw new Error('recall refused')
  return Array.from(answer.text.matchAll(/ id=(\S+)$/gm), (m) => refOf.get(m[1] ?? '') ?? '')
}

function missedBySession(): Partial<Record<ContextSessionName, string[]>> {
  const out: Partial<Record<ContextSessionName, string[]>> = {}
  for (const name of NAMES) {
    const listed = listedRefs(name)
    const missed = CONTEXT_CASES.filter(
      (c) => c.session === name && c.how === 'list' && !listed.includes(c.expect)
    ).map((c) => c.expect)
    if (missed.length > 0) out[name] = missed
  }
  return out
}

function notFound(): string[] {
  return CONTEXT_CASES.filter((c, window) => {
    if (listedRefs(c.session).includes(c.expect)) return false
    return c.how === 'list' || !recalled(c.session, c.prompt ?? '', window).includes(c.expect)
  }).map((c) => `${c.session}:${c.expect}`)
}

function wrongCount(): Partial<Record<ContextSessionName, number>> {
  const out: Partial<Record<ContextSessionName, number>> = {}
  for (const name of NAMES)
    out[name] = listedRefs(name).filter((ref) => CONTEXT_WRONG[name].includes(ref)).length
  return out
}

const GOAL_ONLY = new Set(['goal-only-1', 'goal-only-2'])

describe('what the memory section lists per session context', () => {
  it('the fixture is sound', () => {
    const refs = CONTEXT_SEEDS.map((s) => s.ref)
    expect(new Set(refs).size).toBe(refs.length)
    expect(CONTEXT_CASES.filter((c) => !refs.includes(c.expect))).toEqual([])
    expect(
      Object.values(CONTEXT_WRONG)
        .flat()
        .filter((r) => !refs.includes(r))
    ).toEqual([])
    expect([CONTEXT_SEEDS.length, CONTEXT_SESSIONS.length, CONTEXT_CASES.length]).toEqual([
      142, 7, 31
    ])
  })

  it('listed within the cap: the list cases each session finds', () => {
    expect(missedBySession()).toEqual({})
  })

  it('found at all: in the section or in the recall block', () => {
    expect(notFound()).toEqual([])
  })

  it('wrong-context lines per session', () => {
    expect(wrongCount()).toEqual({
      bare: 0,
      goalA: 0,
      goalB: 0,
      root: 0,
      package: 0,
      template: 0,
      empty: 0
    })
  })

  it('no section passes the cap, and the largest is pinned', () => {
    const sizes = NAMES.map((name) => sectionFor(name).text.length)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MEMORY_LIMITS.indexChars)
    expect(Math.max(...sizes)).toBe(5999)
  })

  it('no item is listed twice in one section', () => {
    for (const name of NAMES) {
      const { itemIds } = sectionFor(name)
      expect(new Set(itemIds).size).toBe(itemIds.length)
    }
  })

  it('a guarded value is never in a section', () => {
    for (const name of NAMES) {
      const { text } = sectionFor(name)
      for (const hidden of CONTEXT_HIDDEN) expect(text.includes(hidden)).toBe(false)
    }
  })

  it('an item with a goal and no folder is listed for that goal only', () => {
    const listedBy = NAMES.filter((name) => listedRefs(name).some((ref) => GOAL_ONLY.has(ref)))
    expect(listedBy.filter((name) => name !== 'goalA')).toEqual([])
  })
})
