// Story 1.4 — enrichDelta (validate-at-source) tests (AC-7; Tasks 7.3/7.4). main-unit
// (node) project. Drives the REAL reducer + tracker with the EXISTING fake feed and a
// FIXED injected now(), then enriches each delta and asserts:
//   - a session.updated carries column + enteredColumnAt + pid (+ pendingToolName when
//     present), validated at source;
//   - a session.removed passes through UNCHANGED (no enrichment of the frozen member);
//   - the fail-closed path: when the tracker has NO column for an updated id, the delta
//     is DROPPED (returns null) and logged by PATH + CODE only — never the value
//     (privacy: the log contains no sessionName/projectPath/pendingToolName/raw line).
// NO live claude, NO deep vi.mock — only the DI seams (now()).
import { describe, it, expect, vi } from 'vitest'
import { createReducer } from './reducer'
import { createAttentionTracker } from './attention'
import { enrichDelta, type EnrichErrorRecord } from './enrichDelta'
import { columnForStatus } from './columns'
import { fakeListSnapshot } from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

const DASHBOARD_ID = '22222222-2222-4222-8222-222222222222' // Working → working
const WEBAPP_ID = '47c6a173-9fe0-4f73-a8fc-0421af3fea24' // NeedsAttention → needs-you
const REPORTS_ID = '77777777-7777-4777-8777-777777777777' // WaitingForInput → idle

/** Build a wired reducer+tracker seeded from the fake list, mirroring index.ts order
 *  (tracker processes the delta BEFORE enrichment reads columnOf/enteredColumnAt). */
function seedWired(): {
  reducer: ReturnType<typeof createReducer>
  tracker: ReturnType<typeof createAttentionTracker>
} {
  const reducer = createReducer({ now: () => FIXED_NOW, log: () => {} })
  const tracker = createAttentionTracker({ now: () => FIXED_NOW })
  const { deltas } = reducer.seedFromSnapshot(fakeListSnapshot)
  for (const delta of deltas) {
    // index.ts ordering: tracker sees the delta first, then enrichment reads it.
    tracker.onDelta(delta, reducer.snapshotMap())
  }
  return { reducer, tracker }
}

describe('enrichDelta — session.updated is enriched + validated at source (AC-7)', () => {
  it('carries column + enteredColumnAt + pid (+ pendingToolName) from the tracker/map', () => {
    const { reducer, tracker } = seedWired()
    // A bare session.updated for the dashboard (Working → working). Enrich it.
    const bare = {
      epoch: reducer.epoch(),
      event: {
        type: 'session.updated' as const,
        id: DASHBOARD_ID,
        sessionName: 'dashboard',
        projectPath: '/home/u/projects/dashboard',
        status: 'Working'
      }
    }
    const out = enrichDelta(bare, tracker, reducer.snapshotMap())
    expect(out).not.toBeNull()
    expect(out?.event.type).toBe('session.updated')
    if (out?.event.type === 'session.updated') {
      expect(out.event.column).toBe('working')
      expect(out.event.column).toBe(columnForStatus('Working'))
      expect(out.event.enteredColumnAt).toBe(FIXED_NOW)
      expect(out.event.pid).toBe(847333) // verbatim from the fake list
    }
  })

  it('includes pendingToolName when the session has one, omits it otherwise', () => {
    const { reducer, tracker } = seedWired()
    // webapp (NeedsAttention) has pendingToolName 'Agent' in the fake list.
    const withTool = enrichDelta(
      {
        epoch: reducer.epoch(),
        event: {
          type: 'session.updated',
          id: WEBAPP_ID,
          sessionName: 'webapp',
          projectPath: '/home/u/projects/c9watch-webapp',
          status: 'NeedsAttention'
        }
      },
      tracker,
      reducer.snapshotMap()
    )
    expect(withTool?.event.type === 'session.updated' && withTool.event.pendingToolName).toBe(
      'Agent'
    )
    expect(withTool?.event.type === 'session.updated' && withTool.event.column).toBe('needs-you')

    // reports (WaitingForInput) has NO pendingToolName.
    const noTool = enrichDelta(
      {
        epoch: reducer.epoch(),
        event: {
          type: 'session.updated',
          id: REPORTS_ID,
          sessionName: 'reports',
          projectPath: '/home/u/projects/reports',
          status: 'WaitingForInput'
        }
      },
      tracker,
      reducer.snapshotMap()
    )
    expect(noTool?.event.type === 'session.updated' && 'pendingToolName' in noTool.event).toBe(
      false
    )
    expect(noTool?.event.type === 'session.updated' && noTool.event.column).toBe('idle')
  })

  it('passes a session.removed through UNCHANGED (no enrichment of the frozen member)', () => {
    const { reducer, tracker } = seedWired()
    const bare = {
      epoch: reducer.epoch(),
      event: {
        type: 'session.removed' as const,
        id: DASHBOARD_ID,
        sessionName: 'dashboard',
        projectPath: '/x'
      }
    }
    const out = enrichDelta(bare, tracker, reducer.snapshotMap())
    expect(out).toEqual(bare) // unchanged
  })
})

describe('enrichDelta — fail-closed when the tracker has no column (Tasks 7.3/7.4)', () => {
  it('DROPS the delta (returns null) and logs PATH + CODE only — never the value', () => {
    const { reducer, tracker } = seedWired()
    const log = vi.fn<(err: EnrichErrorRecord) => void>()
    // An id the tracker never saw → columnOf/enteredColumnAt are undefined → fail closed.
    const SECRET_NAME = 'super-secret-session-name'
    const SECRET_PATH = '/home/u/.secrets/private-repo'
    const out = enrichDelta(
      {
        epoch: reducer.epoch(),
        event: {
          type: 'session.updated',
          id: 'ghost-id-never-tracked',
          sessionName: SECRET_NAME,
          projectPath: SECRET_PATH,
          status: 'Working'
        }
      },
      tracker,
      reducer.snapshotMap(),
      log
    )
    // Half-formed delta is NEVER shipped.
    expect(out).toBeNull()
    // Logged exactly once, by path + code only.
    expect(log).toHaveBeenCalledTimes(1)
    const record = log.mock.calls[0]?.[0]
    expect(record).toBeDefined()
    expect(typeof record?.path).toBe('string')
    expect(typeof record?.code).toBe('string')
    // The failure path points at the first missing enrichment field (column).
    expect(record?.path).toBe('column')
    // PRIVACY: the log record carries ONLY path + code — never any session value.
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain(SECRET_NAME)
    expect(serialized).not.toContain(SECRET_PATH)
    expect(serialized).not.toContain('ghost-id-never-tracked')
    expect(Object.keys(record ?? {}).sort()).toEqual(['code', 'path'])
  })
})
