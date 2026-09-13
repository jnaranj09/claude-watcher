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
  // Catches two faults: a same-column delta that CANCELS the timer (nothing fires at +5), and a
  // same-column re-arm combined with anchoring the due time on `now()` instead of
  // `enteredColumnAt` (the re-arm at +4 pushes the fire to +9). A same-column re-arm ALONE does not
  // turn this red: the tracker never re-stamps `enteredColumnAt` on a same-column delta, so the
  // re-armed timer keeps its due time. "ONCE PER STAY" below is the test that catches that one.
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

  // T-18 beats the move's re-arm: a GLOBAL time rule applies in both workspaces, so re-arming it
  // from the move would re-add, in the same stay, a tag the operator had removed by hand.
  it('ONCE PER STAY (T-18): a workspace move never re-fires a time rule that already fired', () => {
    const p = pipeline([
      rule({
        trigger: { kind: 'time-in-column', column: 'idle', minutes: 5 },
        actions: [{ kind: 'add-tag', tagId: 'stale' }]
      })
    ])
    p.launch() // workspace `default`, idle at START
    p.clock.advance(5 * MIN)
    expect(p.tags()).toEqual(['stale'])
    p.setTags([])
    p.move('w2', [])
    p.clock.advance(60 * MIN)
    expect(p.tags()).toEqual([])
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

  it('/clear (a new id) keeps its tags, runs no launch rule, and the time clock restarts (spec §5)', () => {
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
    p.setTags(['keep'])
    p.clock.advance(6 * MIN)
    p.rebind()
    // The tag survives onto the new id; `born` does not land — launch rules run only at spawn
    // (launchTags), never on a rebind.
    expect(p.tags(NEW_ID)).toEqual(['keep'])
    p.clock.advance(9 * MIN)
    expect(p.tags(NEW_ID)).toEqual(['keep'])
    p.clock.advance(1 * MIN)
    expect(p.tags(NEW_ID)).toEqual(['keep', 'idle10'])
  })
})

describe('rules engine — never-crash (review round 1 finding)', () => {
  // Fix-round-1 finding (Important): the never-crash guard (rulesEngine.ts's try/catch around
  // afterDelta) had no test — deleting it left all 10 pipeline tests green. This test feeds a
  // throwing `setTags` on a REAL column change and pins three things: `afterDelta` doesn't throw,
  // the status delta already shipped (main → renderer never blocks on a rule failure), and `log`
  // gets EXACTLY `id=<id> code=rules_failed` (never a rule name/tag/session value).
  //
  // It also covers the controller's reorder ruling: arming used to run AFTER the rule write,
  // inside the same try, so a throwing write skipped `timers.onColumnEntry` — the new column's
  // time rules never armed for that stay, and the old column's timer stayed armed (a stale timer
  // that can fire later, past the point where it is still valid — T-19). Arming is moved BEFORE
  // the write (it only reads workspaceId/column/enteredColumnAt, which `setTags` never touches),
  // so a throwing write still leaves the new column armed and the old column cancelled — proved
  // below by advancing the clock and reading which tag actually lands.
  it('a throwing setTags on a real column change never crashes the pipeline; the new column still arms, the old cancels (T-19)', () => {
    const clock = createFakeTimers(START)
    const reducer = createReducer({ now: clock.now, log: () => {} })
    const tracker = createAttentionTracker({ now: clock.now })
    const shipped: { status: string; tagIds: string[] }[] = []
    const logs: string[] = []
    // Throws on the FIRST setTags call only (the column-change rule's write, below) — a second
    // call (the later time-rule fire) goes through to the real reducer, so `p.tags()`-equivalent
    // reads still prove which timer actually armed.
    let throwOnce = true

    const rules: Rule[] = [
      rule({
        id: 'old',
        trigger: { kind: 'time-in-column', column: 'working', minutes: 5 },
        actions: [{ kind: 'add-tag', tagId: 'old' }]
      }),
      rule({
        id: 'new',
        trigger: { kind: 'time-in-column', column: 'needs-you', minutes: 10 },
        actions: [{ kind: 'add-tag', tagId: 'new' }]
      }),
      rule({
        id: 'marker',
        trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
        actions: [{ kind: 'add-tag', tagId: 'marker' }]
      })
    ]

    // Forward-referenced by `setTags` below; hoisted (a `function` declaration), exactly like the
    // `pipeline()` helper's own `handleDelta`.
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

    const engine = createRulesEngine({
      getRules: () => ({ rules, brokenIds: new Set<string>() }),
      getSession: (id) => reducer.snapshotMap().get(id),
      columnOf: (id) => tracker.columnOf(id),
      enteredColumnAt: (id) => tracker.enteredColumnAt(id),
      setTags: (sessionId, tagIds) => {
        if (throwOnce) {
          throwOnce = false
          throw new Error('secret session content') // never-log: must not reach `logs`
        }
        reducer.setTags(sessionId, tagIds).forEach(handleDelta)
      },
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      log: (message) => logs.push(message)
    })

    reducer.upsertLaunched(launchedSession(ID)).forEach(handleDelta) // Connecting → idle
    reducer.applyHookStatus(ID, { kind: 'status', status: 'Working' }).forEach(handleDelta) // idle → working: arms `old`

    expect(() => {
      // working → needs-you: arms `new` + cancels `old`, THEN the `marker` column-change rule's
      // write throws.
      reducer.applyHookStatus(ID, { kind: 'status', status: 'NeedsAttention' }).forEach(handleDelta)
    }).not.toThrow()

    expect(shipped.at(-1)).toEqual({ status: 'NeedsAttention', tagIds: [] }) // status shipped regardless
    expect(logs).toEqual([`[claude-watcher][rules] id=${ID} code=rules_failed`]) // id + code ONLY

    clock.advance(10 * MIN)
    // `new` fired (armed for the column actually entered); `old` never did (cancelled before it
    // could fire); `marker` never landed (its write threw before reaching the reducer).
    expect(reducer.snapshotMap().get(ID)?.tagIds).toEqual(['new'])
  })
})
