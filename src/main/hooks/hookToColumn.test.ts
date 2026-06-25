// Phase 2 END-TO-END (main-unit) — the one test that proves the WHOLE POINT:
// a Claude Code hook event flips the board to the `needs-you` column, instantly and
// by construction, with NO reducer/columns.ts change.
//
// The full chain under test (the real production wiring, mirrored from
// src/main/index.ts's hook chokepoint + handleDelta ordering):
//
//   Notification(permission_prompt)            (the inbound, schema-validated hook event)
//     ─hookStatus(evt)─▶ { kind:'status', status:'NeedsPermission' }
//     ─reducer.applyHookStatus─▶ SessionDelta (session.updated carrying NeedsPermission)
//     ─tracker.onDelta─▶ (computes the column from the delta's status)
//     ─enrichDelta─▶ enriched payload whose event.column === 'needs-you'
//
// We use the REAL tracker + REAL enrichDelta (not stubs) so the test fails if the
// status→column classifier, the tracker's column bookkeeping, or the enrich seam ever
// drift. The reducer's status is a FREE string and columnForStatus already maps
// NeedsPermission/NeedsAttention → needs-you, so emitting those statuses from a hook
// reaches the right column with no reducer/columns edit. [plan-hook-phase2; columns.ts:63]
import { describe, it, expect } from 'vitest'
import { createReducer } from '../c9watch/reducer'
import { createAttentionTracker } from '../c9watch/attention'
import { enrichDelta } from '../c9watch/enrichDelta'
import { hookStatus } from './hookStatus'
import { HookEventSchema } from '../../shared/schemas/hookEvent'

const FIXED_NOW = 1_750_000_000_000
const HOOK_AUTHORITY_MS = 10_000

/** A valid `started` watch line whose top-level sessionId === session.id (seeds a KNOWN id). */
function startedLine(id: string): string {
  return JSON.stringify({
    event: 'started',
    sessionId: id,
    timestamp: '2026-06-18T23:57:10.134+00:00',
    session: {
      id,
      status: 'Working',
      projectPath: '/home/u/projects/x',
      pid: 999,
      sessionName: 'x'
    }
  })
}

/**
 * Run the production chain for ONE hook event and return the enriched delta the
 * renderer would receive. Mirrors index.ts: tracker.onDelta FIRST (populates the
 * tracker's column map for this id), THEN enrichDelta reads the now-current tracker.
 */
function runHookToColumn(id: string, rawHookBody: unknown): ReturnType<typeof enrichDelta> {
  const reducer = createReducer({ now: () => FIXED_NOW })
  const tracker = createAttentionTracker({ now: () => FIXED_NOW })

  // The session must be KNOWN before a hook can change its status (applyHookStatus does
  // NOT upsert an unknown id — discovery stays c9watch's job).
  reducer.applyLine(startedLine(id))

  // The hook body crosses the SAME fail-closed Zod boundary it would over HTTP.
  const evt = HookEventSchema.parse(rawHookBody)

  const change = hookStatus(evt)
  expect(change).not.toBeNull()
  if (change === null) throw new Error('unreachable: change asserted non-null')

  const deltas = reducer.applyHookStatus(id, change, HOOK_AUTHORITY_MS)
  expect(deltas).toHaveLength(1)
  const delta = deltas[0]
  if (delta === undefined) throw new Error('unreachable: delta asserted present')

  // Production ordering (index.ts handleDelta): tracker FIRST, then enrich.
  tracker.onDelta(delta, reducer.snapshotMap())
  return enrichDelta(delta, tracker, reducer.snapshotMap())
}

describe('Phase 2 end-to-end — hook event → board column (the whole point)', () => {
  it('Notification(permission_prompt) for a KNOWN id enriches to column "needs-you"', () => {
    const id = 'e2e0perm-0000-4000-8000-000000000001'
    const enriched = runHookToColumn(id, {
      session_id: id,
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt'
    })

    expect(enriched).not.toBeNull()
    expect(enriched?.event.type).toBe('session.updated')
    if (enriched?.event.type === 'session.updated') {
      expect(enriched.event.status).toBe('NeedsPermission') // status carried verbatim
      expect(enriched.event.column).toBe('needs-you') // mapped by construction
      expect(enriched.event.id).toBe(id)
    }
  })

  it('PreToolUse(AskUserQuestion) for a KNOWN id enriches to column "needs-you"', () => {
    // The other needs-you driver — proves both NeedsAttention and NeedsPermission reach
    // the same column with no reducer/columns change.
    const id = 'e2e0attn-0000-4000-8000-000000000001'
    const enriched = runHookToColumn(id, {
      session_id: id,
      hook_event_name: 'PreToolUse',
      tool_name: 'AskUserQuestion'
    })

    expect(enriched).not.toBeNull()
    expect(enriched?.event.type).toBe('session.updated')
    if (enriched?.event.type === 'session.updated') {
      expect(enriched.event.status).toBe('NeedsAttention')
      expect(enriched.event.column).toBe('needs-you')
      expect(enriched.event.id).toBe(id)
    }
  })
})
