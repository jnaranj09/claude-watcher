// The session reducer tests (main-unit / node project) — native engine (Story 6.4).
//
// The c9watch line/snapshot boundary tests died with the CLI (applyLine /
// seedFromSnapshot are gone — the external fail-closed boundary is now the hook POST,
// covered in src/__fixtures__/fakeHookFeed.test.ts + hookServer.test.ts). What remains
// under test here is the reducer's surviving surface:
//   - upsertLaunched (Story 6.2 spawn-time synthesis; upsert semantics, delta shape),
//   - applyHookStatus (status transitions + removal; unknown-id no-op + value-free log;
//     Story 6.3 idempotent removal),
//   - the injected-now() determinism stamp and the defensive snapshotMap copy.
// All deterministic: injected `now()`, no live claude, no wall clock.
import { describe, it, expect, vi } from 'vitest'
import { createReducer, type SessionDelta } from './reducer'
import { launchedSession } from '../../__fixtures__/fakeSessions'

const FIXED_NOW = 1_750_000_000_000

describe('reducer — upsertLaunched (Story 6.2: spawn-time launch synthesis)', () => {
  it('emits ONE epoch-framed session.updated carrying the synthesized fields + enters the map', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch01-0000-4000-8000-000000000001'

    const deltas = r.upsertLaunched(
      launchedSession(id, { projectPath: '/home/op/proj', sessionName: 'proj', pid: 4242 })
    )

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event).toEqual({
      type: 'session.updated',
      id,
      sessionName: 'proj',
      projectPath: '/home/op/proj',
      status: 'Connecting'
    })
    // The delta is epoch-framed (the renderer's stale-discard contract).
    expect(deltas[0]?.epoch).toBe(r.epoch())
    // Session truth: the full synthesized session (incl. pid) is in the authoritative map.
    const stored = r.snapshotMap().get(id)
    expect(stored?.pid).toBe(4242)
    expect(stored?.status).toBe('Connecting')
    expect(r.lastAppliedAt()).toBe(FIXED_NOW) // injected clock, not the wall clock
  })

  it('a SECOND upsertLaunched for the SAME id is a NORMAL update — never a throw', () => {
    // DOCUMENTED DECISION (Story 6.2): a same-id re-upsert (a Reopen re-spawn under the
    // same frame) refreshes the stored session and emits ONE updated delta — no duplicate
    // card, no crash.
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch03-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    let deltas: SessionDelta[] = []
    expect(() => {
      deltas = r.upsertLaunched(launchedSession(id, { pid: 5151 }))
    }).not.toThrow()

    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.updated')
    expect(r.size()).toBe(1) // updated, not duplicated
    expect(r.snapshotMap().get(id)?.pid).toBe(5151) // the refresh landed
  })

  it('the upsert REPLACES wholesale — a fresh spawn is the new truth (Connecting again)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch04-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))
    // A hook transitions the session…
    r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
    // …then the frame re-spawns under the same id: the fresh upsert is the new truth.
    r.upsertLaunched(launchedSession(id))
    expect(r.snapshotMap().get(id)?.status).toBe('Connecting')
  })
})

describe('reducer — applyHookStatus (hooks own every status transition)', () => {
  it.each([
    ['Working'], // UserPromptSubmit / PreToolUse / PostToolUse / SessionStart
    ['WaitingForInput'], // Stop (plain prose)
    ['NeedsPermission'], // Notification(permission_prompt)
    ['NeedsAttention'] // PreToolUse(AskUserQuestion) / Stop ending in '?'
  ])('hook %s ships a session.updated CARRYING that status verbatim', (status) => {
    // The reducer's only job is to carry the FREE status string faithfully — the
    // status is NOT enum-locked and columnForStatus classifies it downstream.
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0001-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const deltas = r.applyHookStatus(id, { kind: 'status', status })
    expect(deltas).toHaveLength(1)
    const evt = deltas[0]?.event
    expect(evt?.type).toBe('session.updated')
    if (evt?.type === 'session.updated') expect(evt.status).toBe(status)
    expect(r.snapshotMap().get(id)?.status).toBe(status)
  })

  it('a status transition keeps the other synthesized fields (merge, not replace)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0002-0000-4000-8000-000000000001'
    r.upsertLaunched(
      launchedSession(id, {
        projectPath: '/home/op/keepme',
        sessionName: 'keepme',
        pid: 7777,
        pendingToolName: 'Agent'
      })
    )

    r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    const stored = r.snapshotMap().get(id)
    expect(stored?.projectPath).toBe('/home/op/keepme')
    expect(stored?.sessionName).toBe('keepme')
    expect(stored?.pid).toBe(7777)
    expect(stored?.pendingToolName).toBe('Agent')
  })

  it('hook removed emits session.removed and deletes from the map', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'hook0003-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const deltas = r.applyHookStatus(id, { kind: 'removed' })
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.event.type).toBe('session.removed')
    expect(r.snapshotMap().has(id)).toBe(false)
  })

  it('unknown session_id → [] + log { path: "(hook)", code: "hook_unknown_id" } (no upsert)', () => {
    // Hooks must NOT synthesize a card for an unknown session — external sessions
    // stay off the board (the native engine has no external discovery by design).
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000001' // NOT in the map

    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(deltas).toHaveLength(0) // no-op
    expect(r.snapshotMap().has(id)).toBe(false) // NOT upserted (deliberate)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = log.mock.calls[0]?.[0]
    expect(logged?.path).toBe('(hook)')
    expect(logged?.code).toBe('hook_unknown_id')
    // STRUCTURAL: only {path, code} — no body/value can ride the record.
    expect(Object.keys(logged ?? {}).sort()).toEqual(['code', 'path'])
  })

  it('Story 6.3 — unknown session_id + removed → [] SILENTLY (idempotent removal, no log)', () => {
    // The stop/exit fast-removal (index.ts) usually beats the belt-and-suspenders
    // SessionEnd hook; the late hook removing an already-removed id must be the
    // "already gone" no-op — emit nothing AND log nothing (no hook_unknown_id noise).
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000002' // NOT in the map

    const deltas = r.applyHookStatus(id, { kind: 'removed' })
    expect(deltas).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
  })

  it('Story 6.3 — double removal: hook-removed twice emits ONE session.removed then []', () => {
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const r = createReducer({ now: () => FIXED_NOW, log })
    const id = 'hook0004-0000-4000-8000-000000000003'
    r.upsertLaunched(launchedSession(id))

    const first = r.applyHookStatus(id, { kind: 'removed' })
    expect(first).toHaveLength(1)
    expect(first[0]?.event.type).toBe('session.removed')
    expect(r.snapshotMap().has(id)).toBe(false)

    const second = r.applyHookStatus(id, { kind: 'removed' })
    expect(second).toHaveLength(0) // idempotent
    expect(log).not.toHaveBeenCalled() // ...and quiet
  })

  it('a subsequent applyHookStatus TRANSITIONS the synthesized session (upsert-then-hook)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = 'launch02-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    // UserPromptSubmit → Working (NOT hook_unknown_id: the upsert made it known).
    const deltas = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    expect(deltas).toHaveLength(1)
    const evt = deltas[0]?.event
    expect(evt?.type).toBe('session.updated')
    if (evt?.type === 'session.updated') expect(evt.status).toBe('Working')
    expect(r.snapshotMap().get(id)?.status).toBe('Working')
  })
})

describe('reducer — determinism + map hygiene', () => {
  it('the apply stamp is the injected now(), not the wall clock', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    expect(r.lastAppliedAt()).toBeNull() // nothing applied yet
    r.upsertLaunched(launchedSession('12340000-0000-4000-8000-000000000001'))
    expect(r.lastAppliedAt()).toBe(FIXED_NOW)
  })

  it('snapshotMap returns a DEFENSIVE COPY — mutating it never touches session truth', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = '56780000-0000-4000-8000-000000000001'
    r.upsertLaunched(launchedSession(id))

    const snap = r.snapshotMap()
    snap.delete(id)
    expect(r.snapshotMap().has(id)).toBe(true) // the authority is untouched
    expect(r.size()).toBe(1)
  })

  it('every delta rides the SAME constant epoch frame (the renderer stale-drop contract)', () => {
    const r = createReducer({ now: () => FIXED_NOW })
    const id = '9abc0000-0000-4000-8000-000000000001'
    const a = r.upsertLaunched(launchedSession(id))
    const b = r.applyHookStatus(id, { kind: 'status', status: 'Working' })
    const c = r.applyHookStatus(id, { kind: 'removed' })
    for (const d of [...a, ...b, ...c]) {
      expect(d.epoch).toBe(r.epoch())
    }
  })
})
