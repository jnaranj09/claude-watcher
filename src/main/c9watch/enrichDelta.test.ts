// Story 1.4 — enrichDelta (validate-at-source) tests (AC-7; Tasks 7.3/7.4). main-unit
// (node) project. Story 6.4: migrated to the native-engine driver — the reducer is
// seeded via `upsertLaunched` (the spawn-time synthesis) instead of the retired c9watch
// `list` snapshot. Drives the REAL reducer + tracker with the launched-session fixtures
// and a FIXED injected now(), then enriches each delta and asserts:
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
import {
  fakeLaunchedSessions,
  WORKING_ID as DASHBOARD_ID, // Working → working
  NEEDS_ATTENTION_ID as WEBAPP_ID, // NeedsAttention → needs-you (pendingToolName 'Agent')
  IDLE_ID as REPORTS_ID // WaitingForInput → idle (no pendingToolName)
} from '../../__fixtures__/fakeSessions'

const FIXED_NOW = 1_750_000_000_000

/** Build a wired reducer+tracker seeded via upsertLaunched, mirroring index.ts order
 *  (tracker processes the delta BEFORE enrichment reads columnOf/enteredColumnAt). */
function seedWired(): {
  reducer: ReturnType<typeof createReducer>
  tracker: ReturnType<typeof createAttentionTracker>
} {
  const reducer = createReducer({ now: () => FIXED_NOW, log: () => {} })
  const tracker = createAttentionTracker({ now: () => FIXED_NOW })
  for (const session of fakeLaunchedSessions()) {
    for (const delta of reducer.upsertLaunched(session)) {
      // index.ts ordering: tracker sees the delta first, then enrichment reads it.
      tracker.onDelta(delta, reducer.snapshotMap())
    }
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
