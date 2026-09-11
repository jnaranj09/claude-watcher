// Attention reminders — the PIPELINE test (main-unit / node project).
//
// Mirrors production (`main/index.ts#registerWatchFeed` + `handleDelta`): the REAL reducer, the
// REAL tracker, the REAL scheduler and the REAL notifier (fake factory), with the same
// launched-only gate on both the first alert and the reminders. `remind` is the SAME
// `createReminderSink` factory index.ts wires (F1, final-review fix wave) — not a copy of its
// body — so fault-injecting the production gate or the validate-at-source send here would turn
// this suite red too. Time is a fake queue.
// Spec: docs/superpowers/specs/2026-09-10-attention-reminders-design.md §1.
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import {
  createAttentionNotifier,
  type NotificationLike,
  type NotificationOptions
} from './notifications'
import { createAttentionReminders } from './attentionReminders'
import { createReminderSink } from './reminderSink'
import { launchedSession } from '../../__fixtures__/fakeSessions'
import { createFakeTimers } from '../../__fixtures__/fakeTimers'

const START = 1_750_000_000_000
const MIN = 60_000
const ID = 'bbbb3333-0000-4000-8000-000000000001'

function pipeline(isLaunched: (id: string) => boolean = () => true): {
  advance: (ms: number) => void
  launch: (status: string) => void
  hook: (status: string) => void
  shown: () => NotificationOptions[]
} {
  const clock = createFakeTimers(START)
  const reducer = createReducer({ now: clock.now })
  const tracker = createAttentionTracker({ now: clock.now })
  const shown: NotificationOptions[] = []
  const factory = (opts: NotificationOptions): NotificationLike => ({
    show(): void {
      shown.push(opts)
    }
  })
  const notifier = createAttentionNotifier({ notificationFactory: factory })
  const reminders = createAttentionReminders({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    getSettings: () => ({ reminderCount: 3, reminderFirstDelayMinutes: 2 }),
    getSession: (id) => reducer.snapshotMap().get(id),
    // The SAME factory production wires (F1) — exercises the real launched gate + the real
    // validate-at-source send, not a copy of the callback body.
    remind: createReminderSink({
      isLaunched,
      notifier,
      send: () => {}, // this pipeline asserts on the OS popup (`shown()`), not the IPC push
      isDestroyed: () => false
    })
  })

  function route(deltas: SessionDelta[]): void {
    for (const d of deltas) {
      const raisedEvents = tracker.onDelta(d, reducer.snapshotMap())
      reminders.onDelta(d)
      for (const raised of raisedEvents) {
        if (!isLaunched(raised.id)) continue
        notifier.notify(raised)
      }
    }
  }

  return {
    advance: (ms) => clock.advance(ms),
    launch: (status) => route(reducer.upsertLaunched(launchedSession(ID, { status }))),
    hook: (status) => route(reducer.applyHookStatus(ID, { kind: 'status', status })),
    shown: () => shown
  }
}

describe('reminder pipeline — reducer → tracker → scheduler → notifier', () => {
  it('a launched session blocked on a permission gets 1 alert + 3 reminders, same title each time', () => {
    const p = pipeline()
    p.launch('Working')
    p.hook('NeedsPermission')
    p.advance(120 * MIN)
    expect(p.shown().map((o) => o.title)).toEqual([
      'proj wants permission',
      'proj wants permission',
      'proj wants permission',
      'proj wants permission'
    ])
    expect(
      p
        .shown()
        .slice(1)
        .map((o) => o.body)
    ).toEqual([
      '/home/u/projects/proj · waiting 2 min',
      '/home/u/projects/proj · waiting 6 min',
      '/home/u/projects/proj · waiting 14 min'
    ])
  })

  it('answering after the first reminder stops the rest', () => {
    const p = pipeline()
    p.launch('Working')
    p.hook('NeedsPermission')
    p.advance(2 * MIN)
    expect(p.shown()).toHaveLength(2)
    p.hook('Working')
    p.advance(120 * MIN)
    expect(p.shown()).toHaveLength(2)
  })

  it('YourTurn gets its one alert and no reminders', () => {
    const p = pipeline()
    p.launch('Working')
    p.hook('YourTurn')
    p.advance(120 * MIN)
    expect(p.shown().map((o) => o.title)).toEqual(['proj · your turn'])
  })

  it('an EXTERNAL (non-launched) blocked session gets no alert and no reminders', () => {
    const p = pipeline(() => false)
    p.launch('Working')
    p.hook('NeedsPermission')
    p.advance(120 * MIN)
    expect(p.shown()).toHaveLength(0)
  })
})
