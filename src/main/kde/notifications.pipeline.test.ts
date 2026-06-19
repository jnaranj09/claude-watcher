// Story 2.2 — the notifier PIPELINE test (main-unit / node project).
//
// Mirrors production (`main/index.ts#registerWatchFeed.onDelta`): drive the REAL reducer (the
// parse-once boundary) + REAL tracker with the EXISTING fake feed, then feed the tracker's
// `raisedEvents` array into the REAL notifier (with a fake notificationFactory DI seam). This
// proves the WIRING contract end-to-end without a live claude, a real OS notification, or any
// Electron import:
//   - AC-1: a needs-you ENTRY edge → exactly ONE notify (1:1 with attention.raised).
//   - AC-2: a working/idle ENTRY and a session.removed → ZERO notify (the notifier only ever
//     sees the tracker's needs-you-entry output, so it never fires on updated/removed).
// Uses injected now() for determinism. [Source: story 2.2 Task 6.2; AC-1/AC-2]
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import {
  createAttentionNotifier,
  type NotificationLike,
  type NotificationOptions
} from './notifications'
import { fakeListSnapshot } from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

const DASHBOARD_ID = '22222222-2222-4222-8222-222222222222' // Working → working (seed)
const AUTH_ID = '11111111-1111-4111-8111-111111111111' // WaitingForInput → idle (seed)

/** A valid `started`/`changed` watch line whose top-level sessionId === session.id. */
function watchLine(
  event: 'started' | 'changed',
  id: string,
  over: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    event,
    sessionId: id,
    timestamp: '2026-06-18T23:57:10.134+00:00',
    session: {
      id,
      status: 'Working',
      projectPath: '/home/u/projects/x',
      pid: 999,
      sessionName: 'x',
      ...over
    }
  })
}

/** A `stopped` line that removes the session (the reducer emits a session.removed delta). */
function stopLine(id: string): string {
  return JSON.stringify({ event: 'stopped', sessionId: id, session: { id } })
}

/** Build the production-shaped pipeline: reducer → tracker → notifier (fake factory). Returns
 *  helpers to push seed/lines and the count of notifications shown. Mirrors index.ts onDelta:
 *  tracker.onDelta FIRST (returns raisedEvents), then notify(raised) for each. */
function pipeline(): {
  seed(raw: unknown): void
  line(raw: string): void
  shownCount: () => number
  shown: () => NotificationOptions[]
} {
  const now = (): number => FIXED_NOW
  const reducer = createReducer({ now })
  const tracker = createAttentionTracker({ now })
  const shown: NotificationOptions[] = []
  const factory = (opts: NotificationOptions): NotificationLike => ({
    show(): void {
      shown.push(opts)
    }
  })
  const notifier = createAttentionNotifier({ notificationFactory: factory })

  function route(deltas: SessionDelta[]): void {
    for (const d of deltas) {
      // Fresh map snapshot per delta (mirrors production onDelta).
      const map = reducer.snapshotMap()
      const raisedEvents = tracker.onDelta(d, map)
      // 1:1 — notify for each raised event (NO extra debounce; the tracker already debounced).
      for (const raised of raisedEvents) notifier.notify(raised)
    }
  }
  return {
    seed: (raw) => route(reducer.seedFromSnapshot(raw).deltas),
    line: (raw) => route(reducer.applyLine(raw)),
    shownCount: () => shown.length,
    shown: () => shown
  }
}

describe('notifier pipeline — fires 1:1 on a needs-you ENTRY (AC-1)', () => {
  it('a Working→NeedsAttention entry edge fires exactly ONE notification', () => {
    const p = pipeline()
    p.seed(fakeListSnapshot) // cold-start seed suppresses raises (no launch storm)
    expect(p.shownCount()).toBe(0)
    // dashboard (working) crosses into NeedsAttention → needs-you ENTRY → ONE notify.
    p.line(
      watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention', pendingToolName: 'Bash' })
    )
    expect(p.shownCount()).toBe(1)
    const opts = p.shown()[0]
    expect(opts?.title).toContain('needs you')
    expect(opts?.body).toContain('Bash')
  })
})

describe('notifier pipeline — NEVER fires on working/idle entry or removal (AC-2)', () => {
  it('an idle (WaitingForInput) ENTRY fires ZERO notifications', () => {
    const p = pipeline()
    p.seed(fakeListSnapshot) // dashboard is Working
    // dashboard → WaitingForInput (entering IDLE) → no attention.raised → ZERO notify.
    p.line(watchLine('changed', DASHBOARD_ID, { status: 'WaitingForInput' }))
    expect(p.shownCount()).toBe(0)
  })

  it('a working ENTRY (idle→Working) fires ZERO notifications', () => {
    const p = pipeline()
    p.seed(fakeListSnapshot) // auth is WaitingForInput → idle
    expect(p.shownCount()).toBe(0)
    // auth → Working (entering WORKING) → no attention.raised → ZERO notify.
    p.line(watchLine('changed', AUTH_ID, { status: 'Working' }))
    expect(p.shownCount()).toBe(0)
  })

  it('a session.removed (stopped line) fires ZERO notifications', () => {
    const p = pipeline()
    p.seed(fakeListSnapshot)
    // Stop a NEEDS-YOU session (webapp is NeedsAttention at seed) — removal must NOT notify.
    const WEBAPP_ID = '47c6a173-9fe0-4f73-a8fc-0421af3fea24'
    p.line(stopLine(WEBAPP_ID))
    expect(p.shownCount()).toBe(0)
  })
})
