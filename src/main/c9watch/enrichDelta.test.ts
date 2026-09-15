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
import type { Session } from '../../shared/schemas/session'
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

describe('enrichDelta — workspaceId rides the pid path (Task 4)', () => {
  it('carries workspaceId from the session map onto the enriched delta', () => {
    const enriched = enrichDelta(
      {
        epoch: 0,
        event: {
          type: 'session.updated',
          id: 's1',
          sessionName: 'n',
          projectPath: '/p',
          status: 'Working'
        }
      },
      { columnOf: () => 'working', enteredColumnAt: () => 10 },
      new Map([
        [
          's1',
          {
            id: 's1',
            status: 'Working',
            projectPath: '/p',
            pid: 7,
            sessionName: 'n',
            workspaceId: 'w1',
            tagIds: [],
            templateId: null
          }
        ]
      ]),
      () => {}
    )
    expect(enriched?.event).toMatchObject({ type: 'session.updated', workspaceId: 'w1' })
  })

  // CORRECTED per review: the session map below has a session with a VALID pid but NO
  // workspaceId, so the drop is caused ONLY by the missing workspaceId. An empty map would
  // already drop on the missing `pid` and prove nothing about this field.
  it('DROPS an updated delta whose session has no workspaceId, logging path+code only', () => {
    const log = vi.fn()
    const enriched = enrichDelta(
      {
        epoch: 0,
        event: {
          type: 'session.updated',
          id: 's1',
          sessionName: 'n',
          projectPath: '/secret/path',
          status: 'Working'
        }
      },
      { columnOf: () => 'working', enteredColumnAt: () => 10 },
      new Map([
        [
          's1',
          {
            id: 's1',
            status: 'Working',
            projectPath: '/secret/path',
            pid: 7,
            sessionName: 'n'
          } as unknown as Session
        ]
      ]),
      log
    )
    expect(enriched).toBeNull()
    expect(log).toHaveBeenCalled()
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('/secret/path')
  })
})

describe('enrichDelta — tags ride the enriched delta (spec §3)', () => {
  const bare = {
    epoch: 0,
    event: {
      type: 'session.updated' as const,
      id: 's1',
      sessionName: 'n',
      projectPath: '/p',
      status: 'Working'
    }
  }
  const tracker = { columnOf: () => 'working' as const, enteredColumnAt: () => 10 }
  const session: Session = {
    id: 's1',
    status: 'Working',
    projectPath: '/p',
    pid: 7,
    sessionName: 'n',
    workspaceId: 'w1',
    tagIds: ['t1', 't2'],
    templateId: 'tpl-1'
  }

  it('copies the session tagIds onto the delta, and never the templateId', () => {
    const out = enrichDelta(bare, tracker, new Map([['s1', session]]))
    expect(out?.event.type === 'session.updated' && out.event.tagIds).toEqual(['t1', 't2'])
    expect(out?.event).not.toHaveProperty('templateId')
  })

  it('drops a delta whose session carries no tagIds, logging path + code only', () => {
    const log = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tagIds: _drop, ...untagged } = session
    const out = enrichDelta(bare, tracker, new Map([['s1', untagged as unknown as Session]]), log)
    expect(out).toBeNull()
    expect(log).toHaveBeenCalledWith({ path: 'tagIds', code: 'invalid_type' })
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
