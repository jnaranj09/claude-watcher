// Story 1.2 — the column-transition tracker tests (main-unit / node project).
// Story 6.4 — migrated to the NATIVE ENGINE drivers: sessions are born via
// `reducer.upsertLaunched` (the spawn-time synthesis) and transitioned/removed via
// `reducer.applyHookStatus` (the hook ingest). The retired c9watch seed/line drivers
// (and the reconnect-reconcile re-raise cases, which died with `seedFromSnapshot`)
// are gone; the tracker itself is UNCHANGED.
//
// Column mapping (contract §4.3, corrected): Working → working; Connecting → idle;
// NeedsAttention/NeedsPermission/unknown → needs-you; WaitingForInput → idle.
// attention.raised fires ONLY on entry into needs-you (NOT idle, NOT working).
// A removed session VANISHES (session.removed; no event).
//
// Covers:
//   - column assignment at launch + across hook transitions (incl. Connecting→idle)
//   - first observation NEVER raises (the cold-start baseline), even into needs-you
//   - an unknown status → needs-you (never throws)
//   - a Working→NeedsAttention hook transition emits exactly ONE attention.raised
//     (with pendingToolName populated when present, omitted when absent)
//   - entering IDLE or WORKING emits NO attention.raised
//   - a removal drops the tracker entry, emitting NO attention event (D2)
//   - debounce: a needs-you→working→needs-you flap inside the window emits ONE raise
//   - time-entered-column is stamped via injected now() (D4)
//   - privacy: an emitted attention.raised carries EXACTLY the union's keys
// [Source: story 1.2 Task 5; D1-D5; contract §4.3; .claude/rules/zod-boundaries.md#Never-log]
import { describe, it, expect } from 'vitest'
import { createReducer, type SessionDelta, type Reducer } from './reducer'
import { createAttentionTracker, ATTENTION_DEBOUNCE_MS, type AttentionTracker } from './attention'
import type { AttentionRaisedEvent } from '../../shared/ipc/contract'
import {
  launchedSession,
  fakeLaunchedSessions,
  WORKING_ID,
  NEEDS_ATTENTION_ID,
  NEEDS_PERMISSION_ID,
  IDLE_ID,
  CONNECTING_ID
} from '../../__fixtures__/fakeSessions'

const FIXED_NOW = 1_750_000_000_000

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

/** Build a reducer + tracker pair; returns the native-engine drivers (launch/hook/
 *  remove) and the ATTENTION events the tracker emitted (the tracker only emits
 *  attention.raised — session.updated/removed are the reducer's deltas). */
function harness(opts: { now?: () => number; debounceMs?: number } = {}): {
  tracker: AttentionTracker
  reducer: Reducer
  attention: AttentionRaisedEvent[]
  launch(session: Parameters<Reducer['upsertLaunched']>[0]): void
  launchAll(): void
  hook(id: string, status: string): void
  /** A PreToolUse for `toolName` (Working, from a tool) — what names a later permission prompt. */
  tool(id: string, toolName: string): void
  remove(id: string): void
} {
  const now = opts.now ?? (() => FIXED_NOW)
  const reducer = createReducer({ now })
  const tracker = createAttentionTracker({
    now,
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {})
  })
  const attention: AttentionRaisedEvent[] = []

  function route(deltas: SessionDelta[]): void {
    // Mirror production (index.ts handleDelta): take a FRESH map snapshot per delta so
    // the tracker sees the reducer state AFTER each prior delta in the batch.
    for (const d of deltas) {
      const map = reducer.snapshotMap()
      for (const ev of tracker.onDelta(d, map)) attention.push(ev)
    }
  }
  return {
    tracker,
    reducer,
    attention,
    launch(session): void {
      route(reducer.upsertLaunched(session))
    },
    launchAll(): void {
      for (const s of fakeLaunchedSessions()) route(reducer.upsertLaunched(s))
    },
    hook(id, status): void {
      route(reducer.applyHookStatus(id, { kind: 'status', status }))
    },
    tool(id, toolName): void {
      route(
        reducer.applyHookStatus(id, { kind: 'status', status: 'Working', toolName, fromTool: true })
      )
    },
    remove(id): void {
      route(reducer.applyHookStatus(id, { kind: 'removed' }))
    }
  }
}

describe('attention tracker — column assignment from launch + hooks (D1, corrected mapping)', () => {
  it('assigns each launched session to its corrected column', () => {
    const h = harness()
    h.launchAll()
    expect(h.tracker.columnOf(WORKING_ID)).toBe('working') // Working
    expect(h.tracker.columnOf(CONNECTING_ID)).toBe('idle') // Connecting → idle (not yet claude's turn)
    expect(h.tracker.columnOf(NEEDS_ATTENTION_ID)).toBe('needs-you') // NeedsAttention
    expect(h.tracker.columnOf(NEEDS_PERMISSION_ID)).toBe('needs-you') // NeedsPermission
    expect(h.tracker.columnOf(IDLE_ID)).toBe('idle') // WaitingForInput → idle
  })

  it('places an unknown status into needs-you (fail-toward-attention)', () => {
    const h = harness()
    h.launchAll()
    h.hook(WORKING_ID, 'SomeBrandNewStatus')
    expect(h.tracker.columnOf(WORKING_ID)).toBe('needs-you')
  })
})

describe('attention tracker — first observation never raises (D3 cold-start baseline)', () => {
  it('launching sessions already in needs-you does NOT fire attention.raised', () => {
    const h = harness()
    h.launchAll()
    // The launch set contains NeedsAttention / NeedsPermission sessions (both needs-you)
    // but NONE may raise — a first observation establishes the baseline only.
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(NEEDS_ATTENTION_ID)).toBe('needs-you')
    expect(h.tracker.columnOf(WORKING_ID)).toBe('working')
  })

  it('a freshly launched Connecting session (the real spawn shape) raises nothing', () => {
    const h = harness()
    h.launch(launchedSession('88888888-8888-4888-8888-888888888888'))
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf('88888888-8888-4888-8888-888888888888')).toBe('idle')
  })
})

describe('attention tracker — needs-you entry raises exactly once (AC-3, D3)', () => {
  it('a Working→NeedsAttention hook transition emits ONE attention.raised', () => {
    const h = harness()
    h.launchAll() // dashboard is Working
    expect(h.tracker.columnOf(WORKING_ID)).toBe('working')

    h.hook(WORKING_ID, 'NeedsAttention')
    expect(h.attention).toHaveLength(1)
    const ev = h.attention[0]!
    expect(ev.type).toBe('attention.raised')
    expect(ev.id).toBe(WORKING_ID)
    expect(ev.status).toBe('NeedsAttention')
    expect(ev.timestamp).toBe(FIXED_NOW)
    expect(h.tracker.columnOf(WORKING_ID)).toBe('needs-you')
  })

  it('an idle (WaitingForInput) session crossing into needs-you raises once', () => {
    const h = harness()
    h.launchAll() // auth is WaitingForInput → idle
    expect(h.tracker.columnOf(IDLE_ID)).toBe('idle')
    h.hook(IDLE_ID, 'NeedsPermission')
    expect(h.attention).toHaveLength(1)
    expect(h.attention[0]!.id).toBe(IDLE_ID)
    expect(h.attention[0]!.status).toBe('NeedsPermission')
    expect(h.tracker.columnOf(IDLE_ID)).toBe('needs-you')
  })

  it('populates pendingToolName when present, omits it when absent', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.launchAll()
    // A PreToolUse(Agent) leaves needs-you; past the debounce window its permission prompt
    // re-enters: the raise names the tool the prompt is for (R14).
    h.tool(NEEDS_ATTENTION_ID, 'Agent') // leave needs-you
    clock.advance(600) // > 500ms window
    h.hook(NEEDS_ATTENTION_ID, 'NeedsPermission') // re-enter
    expect(h.attention).toHaveLength(1)
    expect(h.attention[0]!.pendingToolName).toBe('Agent')

    // dashboard has NO pendingToolName — its raise omits the key entirely.
    h.hook(WORKING_ID, 'NeedsAttention')
    const last = h.attention[h.attention.length - 1]!
    expect(last.id).toBe(WORKING_ID)
    expect('pendingToolName' in last).toBe(false)
  })

  it('does NOT re-raise while a session STAYS in needs-you (level-triggered entry edge only)', () => {
    const h = harness()
    h.launchAll()
    h.hook(WORKING_ID, 'NeedsAttention') // enter needs-you → raise
    expect(h.attention).toHaveLength(1)
    // NeedsAttention → NeedsPermission is still needs-you (no column change) → NO raise.
    h.hook(WORKING_ID, 'NeedsPermission')
    h.hook(WORKING_ID, 'SomeUnknownStatus') // still needs-you
    expect(h.attention).toHaveLength(1)
  })
})

describe('attention tracker — no event on entering working or idle (AC-4)', () => {
  it('a WaitingForInput(idle)→Working transition emits NO attention.raised', () => {
    const h = harness()
    h.launchAll() // auth is WaitingForInput → idle
    expect(h.tracker.columnOf(IDLE_ID)).toBe('idle')
    h.hook(IDLE_ID, 'Working')
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(IDLE_ID)).toBe('working')
  })

  it('a Working→WaitingForInput transition (entering IDLE) emits NO attention.raised', () => {
    const h = harness()
    h.launchAll() // dashboard is Working
    expect(h.tracker.columnOf(WORKING_ID)).toBe('working')
    h.hook(WORKING_ID, 'WaitingForInput')
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(WORKING_ID)).toBe('idle')
  })

  it('a needs-you→idle transition emits NO attention.raised (leaving needs-you for idle)', () => {
    const h = harness()
    h.launchAll() // webapp is NeedsAttention → needs-you
    expect(h.tracker.columnOf(NEEDS_ATTENTION_ID)).toBe('needs-you')
    h.hook(NEEDS_ATTENTION_ID, 'WaitingForInput')
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(NEEDS_ATTENTION_ID)).toBe('idle')
  })

  it('the idle→Working flip (UserPromptSubmit after spawn) emits NO attention.raised', () => {
    const h = harness()
    const id = '99999999-9999-4999-8999-999999999999'
    h.launch(launchedSession(id)) // Connecting → working column
    h.hook(id, 'Working') // same column — the canonical first hook transition
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(id)).toBe('working')
  })
})

describe('attention tracker — removed session VANISHES (D2, AC-2/AC-3)', () => {
  it('a removal drops the tracker entry (no synthetic event)', () => {
    const h = harness()
    h.launchAll()
    expect(h.tracker.columnOf(IDLE_ID)).toBe('idle')
    h.remove(IDLE_ID)
    // The tracker emits NO attention.raised for a removal (session.removed from the
    // reducer IS the vanish signal Epic 2 consumes — the tracker just drops its entry).
    expect(h.attention).toHaveLength(0)
    expect(h.tracker.columnOf(IDLE_ID)).toBeUndefined()
  })

  it('a needs-you session that is REMOVED vanishes and emits NO attention event', () => {
    const h = harness()
    h.launchAll()
    expect(h.tracker.columnOf(NEEDS_PERMISSION_ID)).toBe('needs-you')
    h.remove(NEEDS_PERMISSION_ID)
    expect(h.tracker.columnOf(NEEDS_PERMISSION_ID)).toBeUndefined()
    expect(h.attention.some((e) => e.id === NEEDS_PERMISSION_ID)).toBe(false)
  })
})

describe('attention tracker — emission debounce/hysteresis (D5)', () => {
  it('a needs-you→working→needs-you flap within the window emits ONE raise, not two', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.launchAll()
    h.hook(WORKING_ID, 'NeedsAttention') // enter → raise #1
    expect(h.attention).toHaveLength(1)
    clock.advance(100)
    h.hook(WORKING_ID, 'Working') // leave needs-you
    clock.advance(100) // total 200ms < 500ms window
    h.hook(WORKING_ID, 'NeedsAttention') // re-enter → SUPPRESSED
    expect(h.attention).toHaveLength(1)
  })

  it('a needs-you→idle→needs-you flap within the window is also debounced (leaving via idle)', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.launchAll()
    h.hook(WORKING_ID, 'NeedsAttention') // enter → raise #1
    expect(h.attention).toHaveLength(1)
    clock.advance(100)
    h.hook(WORKING_ID, 'WaitingForInput') // leave to idle
    clock.advance(100) // total 200ms < 500ms window
    h.hook(WORKING_ID, 'NeedsAttention') // re-enter → SUPPRESSED
    expect(h.attention).toHaveLength(1)
  })

  it('a re-entry AFTER the window elapses DOES raise again', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now, debounceMs: 500 })
    h.launchAll()
    h.hook(WORKING_ID, 'NeedsAttention') // raise #1
    clock.advance(100)
    h.hook(WORKING_ID, 'Working') // leave
    clock.advance(600) // > 500ms window
    h.hook(WORKING_ID, 'NeedsAttention') // re-enter → raise #2
    expect(h.attention).toHaveLength(2)
  })

  it('has a sane named default debounce window', () => {
    expect(ATTENTION_DEBOUNCE_MS).toBeGreaterThan(0)
  })
})

describe('attention tracker — time-entered-column stamp (D4)', () => {
  it('stamps enteredColumnAt = now() on a column change', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now })
    h.launchAll()
    expect(h.tracker.enteredColumnAt(WORKING_ID)).toBe(FIXED_NOW) // stamped at launch
    clock.advance(5000)
    h.hook(WORKING_ID, 'NeedsAttention') // column change
    expect(h.tracker.enteredColumnAt(WORKING_ID)).toBe(FIXED_NOW + 5000)
  })

  it('does NOT re-stamp enteredColumnAt when the column is unchanged', () => {
    const clock = makeClock()
    const h = harness({ now: clock.now })
    h.launchAll()
    const stampedAt = h.tracker.enteredColumnAt(NEEDS_ATTENTION_ID) // needs-you at launch
    clock.advance(3000)
    // NeedsAttention→NeedsPermission is still needs-you (no column change) → no re-stamp.
    h.hook(NEEDS_ATTENTION_ID, 'NeedsPermission')
    expect(h.tracker.enteredColumnAt(NEEDS_ATTENTION_ID)).toBe(stampedAt)
  })
})

describe('attention tracker — privacy (never leak a session value)', () => {
  it('an emitted attention.raised carries EXACTLY the union keys (no prompt/message leak)', () => {
    const h = harness()
    // Launch a session carrying every sensitive optional the Session shape admits.
    const id = 'aaaa9999-0000-4000-8000-000000000001'
    h.launch(
      launchedSession(id, {
        status: 'Working',
        pendingToolName: 'Bash',
        firstPrompt: 'the-secret-first-prompt',
        latestMessage: 'the-secret-latest-message',
        pendingToolInput: 'Allow running: ./deploy.sh staging'
      })
    )
    h.tool(id, 'Bash')
    h.hook(id, 'NeedsPermission')
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
})
