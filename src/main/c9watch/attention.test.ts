// Story 1.2 — the column-transition tracker tests (main-unit / node project).
//
// Drives the REAL reducer (the parse-once boundary) with the EXISTING fake feed
// (fakeListSnapshot + fakeWatchLines) and a FIXED injected now(), then feeds each
// reducer delta through the tracker and asserts the emitted attention transitions.
// NO live claude, NO deep vi.mock — only the DI seams (now(), debounceMs).
//
// CORRECTED 2026-06-18 (the prior inverted mapping is SUPERSEDED — contract §4.3):
//   Working/Connecting → working; NeedsAttention/NeedsPermission/unknown → needs-you;
//   WaitingForInput → idle. attention.raised fires ONLY on entry into needs-you
//   (NOT idle, NOT working). An exited session VANISHES (session.removed; no event).
//
// Covers:
//   - cold-start seed suppresses attention.raised for needs-you sessions
//   - column assignment incl. Connecting→working and WaitingForInput→idle
//   - an unknown status → needs-you (never throws)
//   - a Working→NeedsAttention `changed` emits exactly ONE attention.raised (with
//     pendingToolName populated when present, omitted when absent)
//   - a Working→WaitingForInput change (entering IDLE) emits NO attention.raised
//   - a WaitingForInput→Working change (entering WORKING) emits NO attention.raised
//   - a `stopped` line / absence-from-reconcile removes the session and drops the
//     tracker entry, emitting NO attention event (D2 — exited vanishes)
//   - debounce: a needs-you→working→needs-you flap inside the window emits ONE raise
//   - reconnect (later epoch) re-raises a needs-you (re)entry level-triggered (NFR-2)
//   - time-entered-column is stamped via injected now() (D4)
//   - privacy: an emitted attention.raised carries EXACTLY the union's keys
// [Source: story 1.2 Task 5; D1-D5; contract §4.3; .claude/rules/zod-boundaries.md#Never-log]
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta } from './reducer'
import { createAttentionTracker, ATTENTION_DEBOUNCE_MS, type AttentionTracker } from './attention'
import type { AttentionRaisedEvent } from '../../shared/ipc/contract'
import {
  fakeListSnapshot,
  fakeWatchLines,
  MALFORMED_LINE_INDEX
} from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

const DASHBOARD_ID = '22222222-2222-4222-8222-222222222222' // Working → working (seed)
const AUTH_ID = '11111111-1111-4111-8111-111111111111' // WaitingForInput → idle (seed)
const WEBAPP_ID = '47c6a173-9fe0-4f73-a8fc-0421af3fea24' // NeedsAttention → needs-you (seed)
const INFRA_ID = '33333333-3333-4333-8333-333333333333' // NeedsPermission → needs-you (seed)
const PAYMENTS_ID = '66666666-6666-4666-8666-666666666666' // Connecting → working (seed)
const REPORTS_ID = '77777777-7777-4777-8777-777777777777' // WaitingForInput → idle (seed)

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

/** A controllable clock so debounce-window timing is deterministic. */
function makeClock(start = FIXED_NOW): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    }
  }
}

/** Build a reducer + tracker pair; returns helpers to push lines/snapshots and the
 *  ATTENTION events the tracker emitted (the tracker only emits attention.raised —
 *  session.updated/removed are the reducer's deltas). */
function harness(opts: { now?: () => number; debounceMs?: number } = {}): {
  tracker: AttentionTracker
  attention: AttentionRaisedEvent[]
  seed(raw: unknown): void
  line(raw: string): void
} {
  const now = opts.now ?? (() => FIXED_NOW)
  const reducer = createReducer({ now })
  const tracker = createAttentionTracker({
    now,
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {})
  })
  const attention: AttentionRaisedEvent[] = []

  function route(deltas: SessionDelta[]): void {
    // Mirror production (index.ts onDelta): take a FRESH map snapshot per delta so
    // the tracker sees the reducer state AFTER each prior delta in the batch — not a
    // single pre-loop snapshot shared across the batch.
    for (const d of deltas) {
      const map = reducer.snapshotMap()
      for (const ev of tracker.onDelta(d, map)) attention.push(ev)
    }
  }
  return {
    tracker,
    attention,
    seed(raw: unknown): void {
      route(reducer.seedFromSnapshot(raw).deltas)
    },
    line(raw: string): void {
      route(reducer.applyLine(raw))
    }
  }
}

describe('attention tracker — column assignment from the seed (D1, corrected mapping)', () => {
  it('assigns each seed session to its corrected column', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('working') // Working
    expect(h.tracker.columnOf(PAYMENTS_ID)).toBe('working') // Connecting → working
    expect(h.tracker.columnOf(WEBAPP_ID)).toBe('needs-you') // NeedsAttention
    expect(h.tracker.columnOf(INFRA_ID)).toBe('needs-you') // NeedsPermission
    expect(h.tracker.columnOf(AUTH_ID)).toBe('idle') // WaitingForInput → idle
    expect(h.tracker.columnOf(REPORTS_ID)).toBe('idle') // WaitingForInput → idle
  })

  it('places an unknown status into needs-you (fail-toward-attention)', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'SomeBrandNewStatus' }))
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('needs-you')
  })
})

describe('attention tracker — cold-start seed suppression (D3)', () => {
  it('seeds needs-you sessions WITHOUT firing attention.raised on launch', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    // The seed contains NeedsAttention / NeedsPermission sessions (both needs-you) but
    // NONE may raise — the operator is just starting up.
    expect(h.attention).toHaveLength(0)
    // The tracker still established their column baseline.
    expect(h.tracker.columnOf(WEBAPP_ID)).toBe('needs-you')
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('working')
  })
})

describe('attention tracker — needs-you entry raises exactly once (AC-3, D3)', () => {
  it('a Working→NeedsAttention changed emits ONE attention.raised', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // dashboard is Working
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('working')

    // fakeWatchLines[0] is the dashboard crossing into NeedsAttention.
    h.line(fakeWatchLines[0]!)
    expect(h.attention).toHaveLength(1)
    const ev = h.attention[0]!
    expect(ev.type).toBe('attention.raised')
    expect(ev.id).toBe(DASHBOARD_ID)
    expect(ev.status).toBe('NeedsAttention')
    expect(ev.timestamp).toBe(FIXED_NOW)
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('needs-you')
  })

  it('an idle (WaitingForInput) session crossing into needs-you raises once', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // auth is WaitingForInput → idle
    expect(h.tracker.columnOf(AUTH_ID)).toBe('idle')
    h.line(watchLine('changed', AUTH_ID, { status: 'NeedsPermission', pendingToolName: 'Bash' }))
    expect(h.attention).toHaveLength(1)
    expect(h.attention[0]!.id).toBe(AUTH_ID)
    expect(h.attention[0]!.status).toBe('NeedsPermission')
    expect(h.tracker.columnOf(AUTH_ID)).toBe('needs-you')
  })

  it('populates pendingToolName when present, omits it when absent', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.seed(fakeListSnapshot)
    // dashboard (working) → NeedsPermission WITH a pendingToolName.
    h.line(
      watchLine('changed', DASHBOARD_ID, { status: 'NeedsPermission', pendingToolName: 'Bash' })
    )
    expect(h.attention).toHaveLength(1)
    expect(h.attention[0]!.pendingToolName).toBe('Bash')

    // webapp (already needs-you at seed) → working → needs-you again WITHOUT a tool.
    // Advance past the debounce window so the re-entry genuinely raises (the no-tool
    // case is what we are asserting, not the debounce).
    h.line(watchLine('changed', WEBAPP_ID, { status: 'Working' })) // leave needs-you
    clock.advance(600) // > 500ms window
    h.line(watchLine('changed', WEBAPP_ID, { status: 'NeedsAttention' })) // re-enter, no tool
    const last = h.attention[h.attention.length - 1]!
    expect(last.id).toBe(WEBAPP_ID)
    expect('pendingToolName' in last).toBe(false)
  })

  it('does NOT re-raise while a session STAYS in needs-you (level-triggered entry edge only)', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // enter needs-you → raise
    expect(h.attention).toHaveLength(1)
    // NeedsAttention → NeedsPermission is still needs-you (no column change) → NO raise.
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsPermission' }))
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'SomeUnknownStatus' })) // still needs-you
    expect(h.attention).toHaveLength(1)
  })
})

describe('attention tracker — no event on entering working or idle (AC-4)', () => {
  it('a WaitingForInput(idle)→Working change emits NO attention.raised', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // auth is WaitingForInput → idle
    expect(h.tracker.columnOf(AUTH_ID)).toBe('idle')
    h.line(watchLine('changed', AUTH_ID, { status: 'Working' }))
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(AUTH_ID)).toBe('working')
  })

  it('a Working→WaitingForInput change (entering IDLE) emits NO attention.raised', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // dashboard is Working
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('working')
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'WaitingForInput' }))
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('idle')
  })

  it('a needs-you→idle change emits NO attention.raised (leaving needs-you for idle)', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // webapp is NeedsAttention → needs-you
    expect(h.tracker.columnOf(WEBAPP_ID)).toBe('needs-you')
    h.line(watchLine('changed', WEBAPP_ID, { status: 'WaitingForInput' }))
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(WEBAPP_ID)).toBe('idle')
  })

  it('a started Working session (first observation) emits NO attention.raised', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    // fakeWatchLines[2] starts a brand-new Working session.
    h.line(fakeWatchLines[2]!)
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf('55555555-5555-4555-8555-555555555555')).toBe('working')
  })

  it('a started Connecting session (first observation) → working, NO attention.raised', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    const id = '88888888-8888-4888-8888-888888888888'
    h.line(watchLine('started', id, { status: 'Connecting' }))
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(id)).toBe('working')
  })
})

describe('attention tracker — exited session VANISHES (D2, AC-2/AC-3)', () => {
  it('a stopped line removes the session and drops the tracker entry (no synthetic event)', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    expect(h.tracker.columnOf(AUTH_ID)).toBe('idle')
    // fakeWatchLines[3] is the auth session stopping.
    h.line(fakeWatchLines[3]!)
    // The tracker emits NO attention.raised for a removal (session.removed from the
    // reducer IS the vanish signal Epic 2 consumes — the tracker just drops its entry).
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(AUTH_ID)).toBeUndefined()
  })

  it('a needs-you session that STOPS vanishes and emits NO attention event', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    expect(h.tracker.columnOf(INFRA_ID)).toBe('needs-you')
    h.line(
      JSON.stringify({
        event: 'stopped',
        sessionId: INFRA_ID,
        timestamp: '2026-06-18T23:59:00.000+00:00',
        session: {
          id: INFRA_ID,
          status: 'NeedsPermission',
          projectPath: '/home/u/projects/infra',
          pid: 847990,
          sessionName: 'infra'
        }
      })
    )
    expect(h.tracker.columnOf(INFRA_ID)).toBeUndefined()
    expect(h.attention.some((e) => e.id === INFRA_ID)).toBe(false)
  })

  it('a session ABSENT from a fresh list reconcile is removed and dropped from the tracker', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    expect(h.tracker.columnOf(INFRA_ID)).toBe('needs-you')
    // A reconnect reconcile whose snapshot OMITS infra → reducer emits session.removed.
    const withoutInfra = {
      ...fakeListSnapshot,
      sessions: fakeListSnapshot.sessions.filter((s) => s.id !== INFRA_ID)
    }
    h.seed(withoutInfra)
    expect(h.tracker.columnOf(INFRA_ID)).toBeUndefined()
    // Removal is not an attention.raised; it rides as the reducer's session.removed.
    expect(h.attention.some((e) => e.id === INFRA_ID)).toBe(false)
  })
})

describe('attention tracker — emission debounce/hysteresis (D5)', () => {
  it('a needs-you→working→needs-you flap within the window emits ONE raise, not two', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.seed(fakeListSnapshot)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // enter → raise #1
    expect(h.attention).toHaveLength(1)
    clock.advance(100)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'Working' })) // leave needs-you
    clock.advance(100) // total 200ms < 500ms window
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // re-enter → SUPPRESSED
    expect(h.attention).toHaveLength(1)
  })

  it('a needs-you→idle→needs-you flap within the window is also debounced (leaving via idle)', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.seed(fakeListSnapshot)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // enter → raise #1
    expect(h.attention).toHaveLength(1)
    clock.advance(100)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'WaitingForInput' })) // leave to idle
    clock.advance(100) // total 200ms < 500ms window
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // re-enter → SUPPRESSED
    expect(h.attention).toHaveLength(1)
  })

  it('a re-entry AFTER the window elapses DOES raise again', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.seed(fakeListSnapshot)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // raise #1
    clock.advance(100)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'Working' })) // leave
    clock.advance(600) // > 500ms window
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // re-enter → raise #2
    expect(h.attention).toHaveLength(2)
  })

  it('has a sane named default debounce window', () => {
    expect(ATTENTION_DEBOUNCE_MS).toBeGreaterThan(0)
  })
})

describe('attention tracker — reconnect re-raise (D3, NFR-2, later epoch)', () => {
  it('a needs-you session lost across a gap re-raises on the reconnect reconcile', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // cold start, suppress
    expect(h.attention).toHaveLength(0)

    // Simulate the gap: the dashboard goes Working (so the tracker holds it in working),
    // then we lose it. On reconnect the fresh list shows it back in needs-you.
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'Working' }))
    expect(h.tracker.columnOf(DASHBOARD_ID)).toBe('working')

    // Reconnect reconcile (later epoch): dashboard is now NeedsAttention in the snapshot.
    const reconnectSnap = {
      ...fakeListSnapshot,
      sessions: fakeListSnapshot.sessions.map((s) =>
        s.id === DASHBOARD_ID ? { ...s, status: 'NeedsAttention' } : s
      )
    }
    h.seed(reconnectSnap)
    // The dashboard crossed working→needs-you across the reconcile → MUST re-raise.
    expect(h.attention.filter((e) => e.id === DASHBOARD_ID)).toHaveLength(1)
  })

  it('a session ALREADY needs-you across a reconnect (column unchanged) does NOT re-raise', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // webapp NeedsAttention → needs-you (suppressed at cold start)
    expect(h.tracker.columnOf(WEBAPP_ID)).toBe('needs-you')
    // Reconnect reconcile (later epoch) with webapp STILL NeedsAttention (no column change).
    h.seed(fakeListSnapshot)
    // Level-triggered on the ENTRY edge only — an unchanged needs-you is not a (re)entry.
    expect(h.attention.some((e) => e.id === WEBAPP_ID)).toBe(false)
  })

  it('an idle session surfacing across a reconnect does NOT raise (idle entry is silent)', () => {
    const h = harness()
    h.seed(fakeListSnapshot) // auth WaitingForInput → idle (suppressed at cold start)
    expect(h.tracker.columnOf(AUTH_ID)).toBe('idle')
    // Reconnect reconcile with auth still WaitingForInput.
    h.seed(fakeListSnapshot)
    expect(h.attention.some((e) => e.id === AUTH_ID)).toBe(false)
  })
})

describe('attention tracker — time-entered-column stamp (D4)', () => {
  it('stamps enteredColumnAt = now() on a column change', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now })
    h.seed(fakeListSnapshot)
    expect(h.tracker.enteredColumnAt(DASHBOARD_ID)).toBe(FIXED_NOW) // stamped at seed
    clock.advance(5000)
    h.line(watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention' })) // column change
    expect(h.tracker.enteredColumnAt(DASHBOARD_ID)).toBe(FIXED_NOW + 5000)
  })

  it('does NOT re-stamp enteredColumnAt when the column is unchanged', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now })
    h.seed(fakeListSnapshot)
    const stampedAt = h.tracker.enteredColumnAt(WEBAPP_ID) // needs-you at seed
    clock.advance(3000)
    // NeedsAttention→NeedsPermission is still needs-you (no column change) → no re-stamp.
    h.line(watchLine('changed', WEBAPP_ID, { status: 'NeedsPermission' }))
    expect(h.tracker.enteredColumnAt(WEBAPP_ID)).toBe(stampedAt)
  })
})

describe('attention tracker — privacy (never leak a session value)', () => {
  it('an emitted attention.raised carries EXACTLY the union keys (no prompt/message leak)', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    // dashboard → NeedsAttention with a pendingToolName so the optional key is present.
    h.line(
      watchLine('changed', DASHBOARD_ID, { status: 'NeedsAttention', pendingToolName: 'Bash' })
    )
    expect(h.attention).toHaveLength(1)
    const keys = Object.keys(h.attention[0]!).sort()
    expect(keys).toEqual(
      ['id', 'pendingToolName', 'projectPath', 'sessionName', 'status', 'timestamp', 'type'].sort()
    )
    // explicitly assert NO session-body fields leaked through. Widen the known
    // AttentionRaisedEvent to Record<string, unknown> so the `in` operator can probe
    // for keys the compile-time type EXCLUDES (a safe known→wider cast, test-only).
    const ev = h.attention[0]! as Record<string, unknown>
    expect('firstPrompt' in ev).toBe(false)
    expect('latestMessage' in ev).toBe(false)
    expect('pendingToolInput' in ev).toBe(false)
    expect('pid' in ev).toBe(false)
  })

  it('drops a malformed line without emitting any attention event', () => {
    const h = harness()
    h.seed(fakeListSnapshot)
    const before = h.attention.length
    h.line(fakeWatchLines[MALFORMED_LINE_INDEX]!) // the corrupt line
    expect(h.attention).toHaveLength(before)
  })
})
