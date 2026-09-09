// Story 6.2 — the SPAWN-TIME LAUNCH SYNTHESIS pipeline, end-to-end over the REAL stages
// (main-unit / node project; no Electron).
//
// This is the integration-ish proof the spec demands: the `upsertLaunched` delta must SURVIVE
// the SAME handleDelta chokepoint every c9watch/hook delta rides in index.ts —
//
//   reducer.upsertLaunched(session)          (the spawn-time synthesis)
//     → tracker.onDelta(delta, snapshotMap)  (stamps column/enteredColumnAt FIRST — 1.4 ordering)
//     → enrichDelta(delta, tracker, map)     (EnrichedSessionUpdatedSchema validate-at-source)
//     → shouldShipToBoard(event, launched)   (the Story-3.3 membership gate)
//
// — yielding a VALID enriched `session.updated` (sessionName/projectPath/status/pid present by
// construction; column/enteredColumnAt stamped by the tracker) that the ship gate passes because
// mintSpawn added the id to the launched-set BEFORE the delta was produced. A regression in ANY
// stage (a missing synthesized field, a tracker-ordering break, a gate miss) turns this red.
import { describe, it, expect, vi } from 'vitest'
import { createReducer } from './reducer'
import { createAttentionTracker } from './attention'
import { enrichDelta } from './enrichDelta'
import { shouldShipToBoard } from './shipGate'
import { createLaunchedSet } from '../pty/launchedSet'

const FIXED_NOW = 1_750_000_000_000
const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000001' // the launch-minted uuid
const CWD = '/home/op/projects/c9watch-webapp'
const PTY_PID = 51234

describe('Story 6.2 — upsertLaunched delta survives the full enrich/ship pipeline', () => {
  it('tracker + enrichDelta over the upsert delta yields a valid EnrichedSessionUpdated that ships', () => {
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    const launchedSet = createLaunchedSet()
    const log = vi.fn()

    // mintSpawn adds the id to the launched-set BEFORE the synthesized delta ships (a) —
    // modeled here in the same order the terminal:open handler runs it.
    launchedSet.add(SESSION_ID)

    // (b) the spawn-time synthesis — the EXACT Session shape index.ts constructs.
    const deltas = reducer.upsertLaunched({
      id: SESSION_ID,
      status: 'Connecting',
      projectPath: CWD,
      sessionName: 'c9watch-webapp', // basename(cwd)
      pid: PTY_PID,
      workspaceId: 'default'
    })
    expect(deltas).toHaveLength(1)
    const delta = deltas[0]
    if (delta === undefined) throw new Error('unreachable — asserted length above')

    // handleDelta ordering (Story 1.4): the tracker processes THIS delta FIRST, so
    // columnOf/enteredColumnAt reflect the edge when the enrichment reads them.
    const raised = tracker.onDelta(delta, reducer.snapshotMap())
    expect(raised).toEqual([]) // Connecting → idle: no attention.raised on entry

    // The enrichment must NOT fail closed — every EnrichedSessionUpdatedSchema field is present.
    const outbound = enrichDelta(delta, tracker, reducer.snapshotMap(), log)
    expect(log).not.toHaveBeenCalled() // nothing dropped by path/code
    expect(outbound).not.toBeNull()
    expect(outbound?.event).toEqual({
      type: 'session.updated',
      id: SESSION_ID,
      sessionName: 'c9watch-webapp',
      projectPath: CWD,
      status: 'Connecting',
      column: 'idle', // Connecting classifies into the idle column (fresh spawn = not claude's turn)
      enteredColumnAt: FIXED_NOW,
      pid: PTY_PID,
      workspaceId: 'default'
      // no pendingToolName — omitted, not undefined (exactOptionalPropertyTypes)
    })

    // The Story-3.3 board-ship gate passes — the instant card ships on the FIRST delta.
    if (outbound === null) throw new Error('unreachable — asserted non-null above')
    expect(shouldShipToBoard(outbound.event, (id) => launchedSet.has(id))).toBe(true)
  })

  it('the follow-up hook transition rides the SAME pipeline (hooks own the status post-spawn)', () => {
    const reducer = createReducer({ now: () => FIXED_NOW })
    const tracker = createAttentionTracker({ now: () => FIXED_NOW })
    const log = vi.fn()

    reducer
      .upsertLaunched({
        id: SESSION_ID,
        status: 'Connecting',
        projectPath: CWD,
        sessionName: 'c9watch-webapp',
        pid: PTY_PID,
        workspaceId: 'default'
      })
      .forEach((d) => tracker.onDelta(d, reducer.snapshotMap()))

    // Stop hook → WaitingForInput (idle). The synthesized card transitions, enriched + valid.
    const deltas = reducer.applyHookStatus(SESSION_ID, {
      kind: 'status',
      status: 'WaitingForInput'
    })
    expect(deltas).toHaveLength(1)
    const delta = deltas[0]
    if (delta === undefined) throw new Error('unreachable — asserted length above')
    tracker.onDelta(delta, reducer.snapshotMap())

    const outbound = enrichDelta(delta, tracker, reducer.snapshotMap(), log)
    expect(log).not.toHaveBeenCalled()
    expect(outbound?.event.type).toBe('session.updated')
    if (outbound?.event.type === 'session.updated') {
      expect(outbound.event.status).toBe('WaitingForInput')
      expect(outbound.event.column).toBe('idle')
      expect(outbound.event.pid).toBe(PTY_PID) // the synthesized pid persists through the merge
    }
  })
})
