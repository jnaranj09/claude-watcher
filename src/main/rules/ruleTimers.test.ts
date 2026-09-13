// Rules — the time-rule timer owner (spec §2.3; T-13, T-18, T-19). main-unit (node) project; time
// is a fake queue (src/__fixtures__/fakeTimers.ts), no real waiting.
import { describe, it, expect, vi } from 'vitest'
import { createRuleTimers } from './ruleTimers'
import { createFakeTimers } from '../../__fixtures__/fakeTimers'
import type { Column } from '../../shared/ipc/contract'
import type { Rule, TimeRuleMinutes } from '../../shared/schemas/rule'

const START = 1_750_000_000_000
const MIN = 60_000

function timed(
  id: string,
  column: Column,
  minutes: TimeRuleMinutes,
  workspaceId: string | null = null
): Rule {
  return {
    id,
    name: id,
    workspaceId,
    trigger: { kind: 'time-in-column', column, minutes },
    conditions: [],
    actions: [{ kind: 'add-tag', tagId: 't' }]
  }
}

interface Card {
  workspaceId: string
  column: Column
  enteredColumnAt: number
}

function harness(
  rules: Rule[],
  opts: { broken?: string[]; fire?: (sessionId: string, ruleId: string) => void } = {}
): {
  clock: ReturnType<typeof createFakeTimers>
  cards: Map<string, Card>
  fired: { sessionId: string; ruleId: string; at: number }[]
  current: { rules: Rule[] }
  timers: ReturnType<typeof createRuleTimers>
  log: ReturnType<typeof vi.fn>
  enter: (id: string, column: Column, workspaceId?: string) => void
} {
  const clock = createFakeTimers(START)
  const cards = new Map<string, Card>()
  const fired: { sessionId: string; ruleId: string; at: number }[] = []
  const current = { rules }
  const log = vi.fn()
  const timers = createRuleTimers({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getRules: () => ({ rules: current.rules, brokenIds: new Set(opts.broken ?? []) }),
    cardOf: (id) => cards.get(id),
    fire: opts.fire ?? ((sessionId, ruleId) => fired.push({ sessionId, ruleId, at: clock.now() })),
    log
  })
  function enter(id: string, column: Column, workspaceId = 'w1'): void {
    cards.set(id, { workspaceId, column, enteredColumnAt: clock.now() })
    timers.onColumnEntry(id)
  }
  return { clock, cards, fired, current, timers, log, enter }
}

describe('ruleTimers (spec §2.3)', () => {
  it('arms on a column entry and fires ONCE at enteredColumnAt + minutes (T-18)', () => {
    const h = harness([timed('idle30', 'idle', 30)])
    h.enter('s1', 'idle')
    h.clock.advance(30 * MIN - 1)
    expect(h.fired).toEqual([])
    h.clock.advance(1)
    expect(h.fired).toEqual([{ sessionId: 's1', ruleId: 'idle30', at: START + 30 * MIN }])
    h.clock.advance(120 * MIN)
    expect(h.fired).toHaveLength(1)
    expect(h.timers.armedCount()).toBe(0)
  })

  it('arms only the rules for the column the card is in', () => {
    const h = harness([timed('idle30', 'idle', 30), timed('work5', 'working', 5)])
    h.enter('s1', 'working')
    h.clock.advance(60 * MIN)
    expect(h.fired.map((f) => f.ruleId)).toEqual(['work5'])
  })

  it('a column change cancels the old column and arms the new one from the NEW entry', () => {
    const h = harness([timed('work10', 'working', 10), timed('idle5', 'idle', 5)])
    h.enter('s1', 'working')
    h.clock.advance(8 * MIN)
    h.enter('s1', 'idle')
    h.clock.advance(4 * MIN)
    expect(h.fired).toEqual([])
    h.clock.advance(1 * MIN)
    expect(h.fired.map((f) => f.ruleId)).toEqual(['idle5'])
  })

  it('removal cancels every timer for the card', () => {
    const h = harness([timed('idle5', 'idle', 5)])
    h.enter('s1', 'idle')
    h.timers.onRemoved('s1')
    expect(h.timers.armedCount()).toBe(0)
    h.clock.advance(60 * MIN)
    expect(h.fired).toEqual([])
  })

  it('a throwing clearTimer during onRemoved never escapes, and is logged by id + code only', () => {
    const clock = createFakeTimers(START)
    const cards = new Map<string, Card>()
    const log = vi.fn()
    const timers = createRuleTimers({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: () => {
        throw new Error('secret content')
      },
      getRules: () => ({ rules: [timed('idle5', 'idle', 5)], brokenIds: new Set() }),
      cardOf: (id) => cards.get(id),
      fire: () => {},
      log
    })
    cards.set('s1', { workspaceId: 'w1', column: 'idle', enteredColumnAt: clock.now() })
    timers.onColumnEntry('s1')
    expect(() => timers.onRemoved('s1')).not.toThrow()
    expect(log).toHaveBeenCalledWith('[claude-watcher][rules] id=s1 code=rule_timer_failed')
  })

  it('a rule saved mid-stay fires at max(entered, save) + minutes — never at save (T-13)', () => {
    const h = harness([])
    h.enter('s1', 'idle')
    h.clock.advance(40 * MIN)
    h.current.rules = [timed('idle30', 'idle', 30)]
    h.timers.onRuleSaved('idle30')
    h.clock.advance(0)
    expect(h.fired).toEqual([]) // idle for 40 min already, and still nothing fires at save
    h.clock.advance(30 * MIN)
    expect(h.fired.map((f) => f.at)).toEqual([START + 70 * MIN])
  })

  it('a deleted rule stops: onRulesRemoved cancels every timer whose rule is gone', () => {
    const h = harness([timed('idle30', 'idle', 30), timed('idle60', 'idle', 60)])
    h.enter('s1', 'idle')
    h.current.rules = [timed('idle60', 'idle', 60)]
    h.timers.onRulesRemoved()
    h.clock.advance(120 * MIN)
    expect(h.fired.map((f) => f.ruleId)).toEqual(['idle60'])
  })

  it('a workspace move restarts the clock at the move, for the NEW workspace rules only', () => {
    const h = harness([timed('in-w1', 'idle', 10, 'w1'), timed('in-w2', 'idle', 10, 'w2')])
    h.enter('s1', 'idle', 'w1')
    h.clock.advance(6 * MIN)
    h.cards.set('s1', { workspaceId: 'w2', column: 'idle', enteredColumnAt: START })
    h.timers.onWorkspaceMoved('s1')
    h.clock.advance(9 * MIN)
    expect(h.fired).toEqual([])
    h.clock.advance(1 * MIN)
    expect(h.fired).toEqual([{ sessionId: 's1', ruleId: 'in-w2', at: START + 16 * MIN }])
  })

  it('never arms a rule of another workspace, or a broken rule (T-10, T-23)', () => {
    const h = harness([timed('other', 'idle', 5, 'w9'), timed('broken', 'idle', 5)], {
      broken: ['broken']
    })
    h.enter('s1', 'idle')
    expect(h.timers.armedCount()).toBe(0)
  })

  it('a throwing fire never escapes, and is logged by id + code only', () => {
    const h = harness([timed('idle5', 'idle', 5)], {
      fire: () => {
        throw new Error('secret content')
      }
    })
    h.enter('s1', 'idle')
    expect(() => h.clock.advance(5 * MIN)).not.toThrow()
    expect(h.log).toHaveBeenCalledWith('[claude-watcher][rules] id=s1 code=rule_timer_failed')
  })

  it('dispose clears every timer', () => {
    const h = harness([timed('idle5', 'idle', 5)])
    h.enter('s1', 'idle')
    h.enter('s2', 'idle')
    h.timers.dispose()
    expect(h.clock.armed()).toBe(0)
  })

  // A save re-arms THAT rule only. Cancelling every timer on the card instead would silently drop
  // every other pending time rule on every live card.
  it('saving one time rule leaves another pending time rule on the same card untouched', () => {
    const h = harness([timed('idle5', 'idle', 5), timed('idle10', 'idle', 10)])
    h.enter('s1', 'idle')
    h.clock.advance(2 * MIN)
    h.timers.onRuleSaved('idle5')
    h.clock.advance(60 * MIN)
    expect(h.fired).toEqual([
      { sessionId: 's1', ruleId: 'idle5', at: START + 7 * MIN },
      { sessionId: 's1', ruleId: 'idle10', at: START + 10 * MIN }
    ])
  })

  // The due time counts from the tracker's `enteredColumnAt`, not from the moment the timer is
  // armed: a card already idle for 3 min when a 5-min rule arms fires 2 min later, not 5.
  it('counts from enteredColumnAt, not from when the timer is armed (T-19)', () => {
    const h = harness([timed('idle5', 'idle', 5)])
    h.cards.set('s1', { workspaceId: 'w1', column: 'idle', enteredColumnAt: START - 3 * MIN })
    h.timers.onColumnEntry('s1')
    h.clock.advance(2 * MIN - 1)
    expect(h.fired).toEqual([])
    h.clock.advance(1)
    expect(h.fired).toEqual([{ sessionId: 's1', ruleId: 'idle5', at: START + 2 * MIN }])
  })

  // T-18 beats the save's re-arm: x already got the rule this stay, so a re-save (a rename here)
  // must not fire it again. y has not reached its fire time yet, so it re-arms from the save.
  it('ONCE PER STAY (T-18): a re-save never re-fires a rule for a card it already fired for', () => {
    const h = harness([timed('idle10', 'idle', 10)])
    h.enter('x', 'idle') // due START + 10
    h.clock.advance(5 * MIN)
    h.enter('y', 'idle') // due START + 15
    h.clock.advance(5 * MIN)
    expect(h.fired).toEqual([{ sessionId: 'x', ruleId: 'idle10', at: START + 10 * MIN }])
    h.clock.advance(2 * MIN)
    h.current.rules = [{ ...timed('idle10', 'idle', 10), name: 'renamed' }]
    h.timers.onRuleSaved('idle10') // at START + 12
    h.clock.advance(60 * MIN)
    expect(h.fired).toEqual([
      { sessionId: 'x', ruleId: 'idle10', at: START + 10 * MIN },
      { sessionId: 'y', ruleId: 'idle10', at: START + 22 * MIN }
    ])
  })

  // The other half of T-18: the next real column entry starts a new stay, so a rule that fired in
  // the last one arms again.
  it('a real column change starts a new stay: a rule that already fired arms again (T-18)', () => {
    const h = harness([timed('idle5', 'idle', 5)])
    h.enter('s1', 'idle')
    h.clock.advance(5 * MIN) // stay 1 fires
    h.enter('s1', 'working')
    h.clock.advance(1 * MIN)
    h.enter('s1', 'idle') // stay 2, at START + 6
    h.clock.advance(5 * MIN)
    expect(h.fired.map((f) => f.at)).toEqual([START + 5 * MIN, START + 11 * MIN])
  })
})
