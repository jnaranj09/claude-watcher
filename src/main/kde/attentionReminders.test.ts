// Attention reminders — the scheduler tests (main-unit / node project).
// Spec: docs/superpowers/specs/2026-09-10-attention-reminders-design.md (D-1..D-9, §2, §7).
// Time is a fake queue (src/__fixtures__/fakeTimers.ts): nothing waits for real.
import { describe, it, expect } from 'vitest'
import { createAttentionReminders, type ReminderSettings } from './attentionReminders'
import type { ReducerWatchEventsPayload } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import { launchedSession } from '../../__fixtures__/fakeSessions'
import { createFakeTimers } from '../../__fixtures__/fakeTimers'
import { reducerUpdated } from '../../__fixtures__/watchEvents'

const START = 1_750_000_000_000
const MIN = 60_000
const ID = 'cccc4444-0000-4000-8000-000000000001'
const OTHER = 'cccc4444-0000-4000-8000-000000000002'

function removed(id: string): ReducerWatchEventsPayload {
  return {
    epoch: 0,
    event: { type: 'session.removed', id, sessionName: 'proj', projectPath: '/p/proj' }
  }
}

/** A scheduler wired like production: `set` moves the session in the "reducer map" AND feeds the
 *  delta, exactly as handleDelta does. `settings` is live — mutate it to change a setting. */
function setup(initial: ReminderSettings = { reminderCount: 3, reminderFirstDelayMinutes: 2 }): {
  clock: ReturnType<typeof createFakeTimers>
  settings: ReminderSettings
  reminded: { id: string; waitedMs: number }[]
  logs: string[]
  set: (id: string, status: string) => void
  remove: (id: string) => void
  forget: (id: string) => void
  failRemind: () => void
  dispose: () => void
} {
  const clock = createFakeTimers(START)
  const settings = { ...initial }
  const statusById = new Map<string, string>()
  const reminded: { id: string; waitedMs: number }[] = []
  const logs: string[] = []
  let remindImpl = (session: Session, info: { waitedMs: number }): void => {
    reminded.push({ id: session.id, waitedMs: info.waitedMs })
  }
  const reminders = createAttentionReminders({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getSettings: () => settings,
    getSession: (id) => {
      const status = statusById.get(id)
      return status === undefined ? undefined : launchedSession(id, { status })
    },
    remind: (session, info) => remindImpl(session, info),
    log: (message) => logs.push(message)
  })
  return {
    clock,
    settings,
    reminded,
    logs,
    set: (id, status) => {
      statusById.set(id, status)
      reminders.onDelta(reducerUpdated(id, { status }))
    },
    remove: (id) => {
      statusById.delete(id)
      reminders.onDelta(removed(id))
    },
    /** Drop the session from the "reducer map" WITHOUT a delta (the defensive fire-time path). */
    forget: (id) => statusById.delete(id),
    failRemind: () => {
      remindImpl = () => {
        throw new Error('boom')
      }
    },
    dispose: () => reminders.dispose()
  }
}

describe('attention reminders — the default series (D-2)', () => {
  it('a NeedsPermission session is reminded at +2, +6 and +14 min, then never again', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(2 * MIN - 1)
    expect(r.reminded).toHaveLength(0)
    r.clock.advance(1)
    expect(r.reminded).toEqual([{ id: ID, waitedMs: 2 * MIN }])
    r.clock.advance(4 * MIN)
    r.clock.advance(8 * MIN)
    expect(r.reminded.map((x) => x.waitedMs)).toEqual([2 * MIN, 6 * MIN, 14 * MIN])
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(3)
    expect(r.clock.armed()).toBe(0)
  })

  it('a NeedsAttention session (a question) is reminded the same way', () => {
    const r = setup()
    r.set(ID, 'NeedsAttention')
    r.clock.advance(14 * MIN)
    expect(r.reminded.map((x) => x.waitedMs)).toEqual([2 * MIN, 6 * MIN, 14 * MIN])
  })

  it('two blocked sessions run independent series, keyed by id', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(1 * MIN)
    r.set(OTHER, 'NeedsAttention')
    r.clock.advance(2 * MIN)
    expect(r.reminded).toEqual([
      { id: ID, waitedMs: 2 * MIN },
      { id: OTHER, waitedMs: 2 * MIN }
    ])
  })
})

describe('attention reminders — only the blocking statuses (D-1)', () => {
  it.each(['YourTurn', 'Working', 'WaitingForInput', 'Connecting', 'SomeBrandNewStatus'])(
    '%s arms nothing',
    (status) => {
      const r = setup()
      r.set(ID, status)
      r.clock.advance(120 * MIN)
      expect(r.reminded).toHaveLength(0)
      expect(r.clock.armed()).toBe(0)
    }
  )
})

describe('attention reminders — what stops them (D-3)', () => {
  it.each(['Working', 'WaitingForInput', 'YourTurn'])(
    'moving to %s cancels the armed reminder',
    (status) => {
      const r = setup()
      r.set(ID, 'NeedsPermission')
      r.clock.advance(1 * MIN)
      r.set(ID, status)
      expect(r.clock.armed()).toBe(0)
      r.clock.advance(120 * MIN)
      expect(r.reminded).toHaveLength(0)
    }
  )

  it('removing the session cancels the armed reminder', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.remove(ID)
    expect(r.clock.armed()).toBe(0)
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(0)
  })
})

describe('attention reminders — one wait, one series (D-6, D-7, D-8)', () => {
  it('NeedsAttention → NeedsPermission keeps the running series and its clock', () => {
    const r = setup()
    r.set(ID, 'NeedsAttention')
    r.clock.advance(1 * MIN)
    r.set(ID, 'NeedsPermission')
    r.clock.advance(1 * MIN)
    expect(r.reminded).toEqual([{ id: ID, waitedMs: 2 * MIN }])
  })

  it('a finished series does not restart on another delta for the same blocked session', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(14 * MIN)
    expect(r.reminded).toHaveLength(3)
    r.set(ID, 'NeedsPermission') // e.g. a rename or a pendingToolName update
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(3)
  })

  // Rules (Phase 2) — a rule's tag write re-enters handleDelta as its OWN session.updated with
  // the SAME status (only tagIds changed). `onDelta` here reads status only, so this delta is
  // indistinguishable from any other same-status update: it must not restart the series' clock
  // or arm a second timer. Alerts ignore tags (spec) — pinned here since attentionReminders.ts is
  // the one place that decision lives, and index.ts's own handleDelta cannot be unit-tested.
  it('a same-status delta (e.g. a rule-driven tag change) is a no-op — the series keeps its original start and armed count', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(1 * MIN)
    expect(r.clock.armed()).toBe(1)
    r.set(ID, 'NeedsPermission') // same status — represents the tag-only re-delta
    expect(r.clock.armed()).toBe(1) // no second timer armed
    r.clock.advance(1 * MIN)
    expect(r.reminded).toEqual([{ id: ID, waitedMs: 2 * MIN }]) // measured from the ORIGINAL start
  })

  it('leaving and coming back starts a fresh series from zero', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(2 * MIN)
    r.set(ID, 'Working')
    r.set(ID, 'NeedsPermission')
    r.clock.advance(2 * MIN)
    expect(r.reminded.map((x) => x.waitedMs)).toEqual([2 * MIN, 2 * MIN])
  })
})

describe('attention reminders — settings are read live (D-9)', () => {
  it('a count of 0 means no reminders at all', () => {
    const r = setup({ reminderCount: 0, reminderFirstDelayMinutes: 2 })
    r.set(ID, 'NeedsPermission')
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(0)
    expect(r.clock.armed()).toBe(0)
  })

  it.each([0, 1])('lowering the count to %i mid-series stops the rest', (lowered) => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(2 * MIN)
    expect(r.reminded).toHaveLength(1)
    r.settings.reminderCount = lowered
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(1)
  })

  it('a new first delay applies from the next timer that gets scheduled', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.clock.advance(2 * MIN) // reminder 1 at +2; reminder 2 is armed now, 4 min out (first = 2)
    r.settings.reminderFirstDelayMinutes = 5
    r.clock.advance(4 * MIN) // reminder 2 keeps its armed delay → +6
    r.clock.advance(20 * MIN) // reminder 3 uses the new value: 5 × 2^2 = 20 min → +26
    expect(r.reminded.map((x) => x.waitedMs)).toEqual([2 * MIN, 6 * MIN, 26 * MIN])
  })
})

describe('attention reminders — never crash, never log a value', () => {
  it('a session missing from the map at fire time is skipped and logged by id + code only', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.forget(ID)
    r.clock.advance(2 * MIN)
    expect(r.reminded).toHaveLength(0)
    expect(r.logs).toEqual([`[claude-watcher][reminders] id=${ID} code=reminder_session_missing`])
  })

  it('a throwing remind() is caught, logged by id + code, and ends that series', () => {
    const r = setup()
    r.failRemind()
    r.set(ID, 'NeedsPermission')
    expect(() => r.clock.advance(2 * MIN)).not.toThrow()
    expect(r.logs).toEqual([`[claude-watcher][reminders] id=${ID} code=reminder_failed`])
    expect(r.clock.armed()).toBe(0)
    r.set(ID, 'NeedsPermission') // the same wait must not restart
    expect(r.clock.armed()).toBe(0)
  })

  it('onDelta never throws, even when reading the settings throws', () => {
    const clock = createFakeTimers(START)
    const logs: string[] = []
    const reminders = createAttentionReminders({
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      getSettings: () => {
        throw new Error('boom')
      },
      getSession: () => undefined,
      remind: () => {},
      log: (message) => logs.push(message)
    })
    expect(() => reminders.onDelta(reducerUpdated(ID, { status: 'NeedsPermission' }))).not.toThrow()
    expect(logs).toEqual([`[claude-watcher][reminders] id=${ID} code=reminder_failed`])
  })
})

describe('attention reminders — dispose (window teardown)', () => {
  it('clears every armed timer', () => {
    const r = setup()
    r.set(ID, 'NeedsPermission')
    r.set(OTHER, 'NeedsAttention')
    expect(r.clock.armed()).toBe(2)
    r.dispose()
    expect(r.clock.armed()).toBe(0)
    r.clock.advance(120 * MIN)
    expect(r.reminded).toHaveLength(0)
  })
})
