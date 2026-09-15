// Story 3.3 — `shouldShipToBoard` tests (main-unit / node project).
//
// The board-ship gate is a PURE function over the event `id` + the launched-set membership
// predicate. It decides whether a board delta crosses the main→renderer seam: ship ONLY
// launched-set members so the Board shows ONLY app-launched sessions (AC-2). An external/Konsole
// session's delta is dropped at the chokepoint, so the renderer board store never learns of it.
//
// Story 3.3 BEHAVIOR CHANGE (test diff = evidence, F4): pre-3.3 EVERY session.updated/removed
// was shipped (the board showed all sessions). The gate is the new narrowing.
//
// EDGE CASES covered here (story 3.3 FROZEN guidance #3):
//   (a) a LAUNCHED session that leaves the feed → its `session.removed` STILL ships (its id is
//       in the set), so the card vanishes — the filter never strands a stale card.
//   (b) a launched-but-not-yet-correlated session is simply not-yet-shipped (the gate returns
//       false until its id enters the set) — modeled by an empty / partial launched-set.
// [Source: story 3.3 Task 1/6; AC-2; F1/F3; src/main/c9watch/shipGate.ts]
import { describe, it, expect } from 'vitest'
import { shouldShipToBoard } from './shipGate'
import type {
  SessionUpdatedEvent,
  SessionRemovedEvent,
  AttentionRaisedEvent
} from '../../shared/ipc/contract'

/** A predicate from an explicit launched-id set (the production shape: `launchedSet.has`). */
function launchedFrom(ids: ReadonlyArray<string>): (id: string) => boolean {
  const set = new Set(ids)
  return (id) => set.has(id)
}

/** A minimal `session.updated` event keyed by id (only `id` is read by the gate). */
function updated(id: string): SessionUpdatedEvent {
  return {
    type: 'session.updated',
    id,
    sessionName: id,
    projectPath: `/p/${id}`,
    status: 'Working',
    column: 'working',
    enteredColumnAt: 0,
    pid: 1,
    workspaceId: 'default',
    tagIds: []
  }
}

/** A minimal `session.removed` event keyed by id. */
function removed(id: string): SessionRemovedEvent {
  return { type: 'session.removed', id, sessionName: id, projectPath: `/p/${id}` }
}

/** A minimal `attention.raised` event keyed by id (the gate only reads `id`). */
function raised(id: string): AttentionRaisedEvent {
  return {
    type: 'attention.raised',
    id,
    sessionName: id,
    projectPath: `/p/${id}`,
    status: 'NeedsAttention',
    timestamp: 0
  }
}

describe('shouldShipToBoard — ship ONLY launched-set members (Story 3.3 / AC-2)', () => {
  it('a LAUNCHED session.updated SHIPS (true)', () => {
    expect(shouldShipToBoard(updated('mine'), launchedFrom(['mine']))).toBe(true)
  })

  it('an EXTERNAL session.updated is NOT shipped (false) — never becomes a card', () => {
    // The load-bearing behavior change: pre-3.3 this shipped unconditionally.
    expect(shouldShipToBoard(updated('ext'), launchedFrom([]))).toBe(false)
  })

  it('edge (a): a LAUNCHED session.removed STILL ships (true) → its card vanishes, never stranded', () => {
    // A launched session that leaves the feed must still ship its removal so the card disappears;
    // the filter does NOT strand a stale card.
    expect(shouldShipToBoard(removed('mine'), launchedFrom(['mine']))).toBe(true)
  })

  it('an EXTERNAL session.removed is NOT shipped (false) — there was no card to remove', () => {
    expect(shouldShipToBoard(removed('ext'), launchedFrom([]))).toBe(false)
  })

  it('edge (b): a launched-but-not-yet-correlated id is NOT shipped (false) — not-yet-on-the-board', () => {
    // The id has not yet entered the launched-set (the Tgid join has not landed); the gate
    // returns false, so the session is simply not-yet-shipped. Once the join lands and the id
    // enters the set, the NEXT delta for it ships (production: correlateAgainst runs per delta).
    const notYetCorrelated = launchedFrom([]) // join not landed yet
    expect(shouldShipToBoard(updated('pending'), notYetCorrelated)).toBe(false)
    // After the join lands, the same id ships:
    expect(shouldShipToBoard(updated('pending'), launchedFrom(['pending']))).toBe(true)
  })

  it('also gates attention.raised by id (same membership source as updated/removed)', () => {
    expect(shouldShipToBoard(raised('mine'), launchedFrom(['mine']))).toBe(true)
    expect(shouldShipToBoard(raised('ext'), launchedFrom([]))).toBe(false)
  })

  it('a launched + external mix ships ONLY the launched ids', () => {
    const isLaunched = launchedFrom(['a', 'c'])
    expect(shouldShipToBoard(updated('a'), isLaunched)).toBe(true)
    expect(shouldShipToBoard(updated('b'), isLaunched)).toBe(false)
    expect(shouldShipToBoard(updated('c'), isLaunched)).toBe(true)
  })
})
