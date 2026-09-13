// Rules — the PIPELINE test (main-unit / node). The REAL reducer, tracker, enrichDelta and engine,
// wired in index.ts's handleDelta order: read the column before, let the tracker see the delta,
// read it after, ship, THEN run the engine. Time is a fake queue.
// Spec: docs/superpowers/specs/2026-09-11-tags-and-rules-design.md §2.2–§2.3, §5, §6 "Engine".
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import { enrichDelta } from '../c9watch/enrichDelta'
import { createRulesEngine } from './rulesEngine'
import { createFakeTimers } from '../../__fixtures__/fakeTimers'
import { launchedSession } from '../../__fixtures__/fakeSessions'
import type { Session } from '../../shared/schemas/session'
import type { Rule } from '../../shared/schemas/rule'

const START = 1_750_000_000_000
const MIN = 60_000
const ID = 'cccc4444-0000-4000-8000-000000000001'
const NEW_ID = 'cccc4444-0000-4000-8000-000000000002'

function rule(over: Partial<Rule>): Rule {
  return {
    id: 'r',
    name: 'r',
    workspaceId: null,
    trigger: { kind: 'launched' },
    conditions: [],
    actions: [{ kind: 'add-tag', tagId: 't' }],
    ...over
  }
}

const CLEAR_PENDING = rule({
  trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
  conditions: [{ kind: 'has-tag', tagId: 'pending' }],
  actions: [{ kind: 'remove-tag', tagId: 'pending' }]
})

function pipeline(rules: Rule[]): {
  clock: ReturnType<typeof createFakeTimers>
  shipped: { status: string; tagIds: string[] }[]
  launch: (over?: Partial<Session>) => void
  hook: (status: string) => void
  setTags: (tagIds: string[]) => void
  rename: (name: string) => void
  move: (workspaceId: string, keep: string[]) => void
  remove: () => void
  rebind: () => void
  tags: (id?: string) => string[]
} {
  const clock = createFakeTimers(START)
  const reducer = createReducer({ now: clock.now, log: () => {} })
  const tracker = createAttentionTracker({ now: clock.now })
  const shipped: { status: string; tagIds: string[] }[] = []
  const engine = createRulesEngine({
    getRules: () => ({ rules, brokenIds: new Set<string>() }),
    getSession: (id) => reducer.snapshotMap().get(id),
    columnOf: (id) => tracker.columnOf(id),
    enteredColumnAt: (id) => tracker.enteredColumnAt(id),
    setTags: (sessionId, tagIds) => reducer.setTags(sessionId, tagIds).forEach(handleDelta),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer
  })

  // index.ts handleDelta, trimmed to what the engine needs — in the SAME order.
  function handleDelta(delta: SessionDelta): void {
    const id = delta.event.id
    const before = delta.event.type === 'session.updated' ? tracker.columnOf(id) : undefined
    tracker.onDelta(delta, reducer.snapshotMap())
    const after = delta.event.type === 'session.updated' ? tracker.columnOf(id) : undefined
    const out = enrichDelta(delta, tracker, reducer.snapshotMap(), () => {})
    if (out !== null && out.event.type === 'session.updated') {
      shipped.push({ status: out.event.status, tagIds: out.event.tagIds })
    }
    engine.afterDelta(delta, before, after)
  }

  return {
    clock,
    shipped,
    launch: (over = {}) => reducer.upsertLaunched(launchedSession(ID, over)).forEach(handleDelta),
    hook: (status) => reducer.applyHookStatus(ID, { kind: 'status', status }).forEach(handleDelta),
    setTags: (tagIds) => reducer.setTags(ID, tagIds).forEach(handleDelta),
    rename: (name) => reducer.renameSession(ID, name).forEach(handleDelta),
    move: (workspaceId, keep) => {
      const deltas = reducer.setWorkspace(ID, workspaceId, keep)
      deltas.forEach(handleDelta)
      if (deltas.length > 0) engine.onWorkspaceMoved(ID)
    },
    remove: () => reducer.applyHookStatus(ID, { kind: 'removed' }).forEach(handleDelta),
    // index.ts adoptCard: the card re-upserted under claude's new id, then the old id removed.
    rebind: () => {
      const stored = reducer.snapshotMap().get(ID)
      if (stored === undefined) throw new Error('nothing to rebind')
      reducer.upsertLaunched({ ...stored, id: NEW_ID }).forEach(handleDelta)
      reducer.applyHookStatus(ID, { kind: 'removed' }).forEach(handleDelta)
    },
    tags: (id = ID) => reducer.snapshotMap().get(id)?.tagIds ?? []
  }
}

describe('rules engine — column-change rules (spec §2.2)', () => {
  it('Working → Needs you removes pending_customer, a tag added by hand (T-12)', () => {
    const p = pipeline([CLEAR_PENDING])
    p.launch()
    p.hook('Working')
    p.setTags(['prod', 'pending'])
    p.hook('YourTurn')
    expect(p.tags()).toEqual(['prod'])
  })

  it('the status ships first, then the tag change — two deltas on the same tick (Approach A)', () => {
    const p = pipeline([CLEAR_PENDING])
    p.launch()
    p.hook('Working')
    p.setTags(['pending'])
    p.shipped.length = 0
    p.hook('YourTurn')
    expect(p.shipped).toEqual([
      { status: 'YourTurn', tagIds: ['pending'] },
      { status: 'YourTurn', tagIds: [] }
    ])
  })

  // T-3 — without "no rule on a tag delta" these two rules would flip `seen` forever.
  it('a tag delta runs no rule: "any → any" fires once per REAL column change', () => {
    const p = pipeline([
      rule({
        id: 'mark',
        trigger: { kind: 'column-change', from: 'any', to: 'any' },
        actions: [{ kind: 'add-tag', tagId: 'seen' }]
      }),
      rule({
        id: 'unmark',
        trigger: { kind: 'column-change', from: 'any', to: 'any' },
        conditions: [{ kind: 'has-tag', tagId: 'seen' }],
        actions: [{ kind: 'remove-tag', tagId: 'seen' }]
      })
    ])
    p.launch()
    p.shipped.length = 0
    p.hook('Working')
    expect(p.tags()).toEqual(['seen'])
    expect(p.shipped).toHaveLength(2)
  })

  it('a first sighting (launch) runs no column-change rule', () => {
    const p = pipeline([rule({ trigger: { kind: 'column-change', from: 'any', to: 'any' } })])
    p.launch()
    expect(p.tags()).toEqual([])
  })
})

describe('rules engine — time rules (spec §2.3)', () => {
  // FAULT INJECTION (same-column re-arm) — CONTROLLER-CORRECTED NOTE: changing `afterDelta`'s
  // `if (before === after) return` to ALSO call `timers.onColumnEntry(event.id)` on a same-column
  // delta does NOT turn THIS test red. The tracker never re-stamps `enteredColumnAt` on a
  // same-column delta (attention.ts: "no re-stamp of enteredColumnAt … stamp only on a CHANGE"),
  // and `ruleTimers.arm` anchors its due time on `enteredColumnAt`, so a spurious re-arm from that
  // injection recomputes the SAME due time (still +5 min from the real entry) — no delay. The test
  // that DOES go red for that injection is "ONCE PER STAY" below (a hand-removed tag is silently
  // re-added by the spurious re-arm's immediate re-fire). See task-6-report.md for the recorded run.
  it('TIMER ANCHORING (T-19): same-column deltas never delay the fire', () => {
    const p = pipeline([
      rule({
        trigger: { kind: 'time-in-column', column: 'working', minutes: 5 },
        actions: [{ kind: 'add-tag', tagId: 'long' }]
      })
    ])
    p.launch()
    p.hook('Working')
    p.clock.advance(4 * MIN)
    p.hook('Working')
    p.rename('renamed')
    p.setTags(['manual'])
    p.clock.advance(1 * MIN)
    expect(p.tags()).toEqual(['manual', 'long'])
  })

  it('NeedsAttention ↔ NeedsPermission stay in needs-you and never re-arm (T-19)', () => {
    const p = pipeline([
      rule({
        trigger: { kind: 'time-in-column', column: 'needs-you', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'waiting' }]
      })
    ])
    p.launch()
    p.hook('NeedsAttention')
    p.clock.advance(6 * MIN)
    p.hook('NeedsPermission')
    p.clock.advance(4 * MIN)
    expect(p.tags()).toEqual(['waiting'])
  })

  // FAULT INJECTION (same-column re-arm) — this is the test that DOES go red when `afterDelta`'s
  // `if (before === after) return` is changed to also call `timers.onColumnEntry(event.id)`: the
  // manual `p.setTags([])` below is a same-column delta, so the injection spuriously re-arms the
  // "stale" timer at delay 0 (max(enteredColumnAt, …) + minutes already elapsed) — it re-fires in
  // the SAME tick and silently re-adds `stale` on the NEXT `advance`, before the next real stay.
  it('ONCE PER STAY (T-18): a tag removed by hand stays removed until the next stay', () => {
    const p = pipeline([
      rule({
        trigger: { kind: 'time-in-column', column: 'idle', minutes: 5 },
        actions: [{ kind: 'add-tag', tagId: 'stale' }]
      })
    ])
    p.launch() // Connecting → the idle column
    p.clock.advance(5 * MIN)
    expect(p.tags()).toEqual(['stale'])
    p.setTags([])
    p.clock.advance(60 * MIN)
    expect(p.tags()).toEqual([])
    p.hook('Working')
    p.hook('WaitingForInput') // a new stay in idle
    p.clock.advance(5 * MIN)
    expect(p.tags()).toEqual(['stale'])
  })

  it('leaving the column cancels its pending time rule; removal cancels everything', () => {
    const p = pipeline([
      rule({
        trigger: { kind: 'time-in-column', column: 'working', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'long' }]
      })
    ])
    p.launch()
    p.hook('Working')
    p.clock.advance(5 * MIN)
    p.hook('WaitingForInput')
    p.clock.advance(60 * MIN)
    expect(p.tags()).toEqual([])
    p.hook('Working')
    p.remove()
    expect(p.clock.armed()).toBe(0)
  })

  it('a workspace move stops the old workspace time rule and counts the new one from the move', () => {
    const p = pipeline([
      rule({
        id: 'old',
        workspaceId: 'default',
        trigger: { kind: 'time-in-column', column: 'idle', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'old' }]
      }),
      rule({
        id: 'new',
        workspaceId: 'w2',
        trigger: { kind: 'time-in-column', column: 'idle', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'new' }]
      })
    ])
    p.launch() // workspace `default`, idle at START
    p.clock.advance(6 * MIN)
    p.move('w2', [])
    p.clock.advance(9 * MIN)
    expect(p.tags()).toEqual([])
    p.clock.advance(1 * MIN)
    expect(p.tags()).toEqual(['new'])
  })

  it('/clear (a new id) runs no launch rule, and the time clock restarts (spec §5)', () => {
    const p = pipeline([
      rule({
        id: 'born',
        trigger: { kind: 'launched' },
        actions: [{ kind: 'add-tag', tagId: 'born' }]
      }),
      rule({
        id: 'idle10',
        trigger: { kind: 'time-in-column', column: 'idle', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'idle10' }]
      })
    ])
    p.launch()
    p.clock.advance(6 * MIN)
    p.rebind()
    expect(p.tags(NEW_ID)).toEqual([]) // launch rules run only at spawn (launchTags), never on a rebind
    p.clock.advance(9 * MIN)
    expect(p.tags(NEW_ID)).toEqual([])
    p.clock.advance(1 * MIN)
    expect(p.tags(NEW_ID)).toEqual(['idle10'])
  })
})
