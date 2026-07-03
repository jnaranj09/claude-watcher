// Story 6.3 — FAST REMOVAL: stop / PTY-exit remove the launched session's card IMMEDIATELY
// (main-unit / node project; no Electron).
//
// These tests run the extracted removal decision (launchRemoval.ts) over the REAL launch
// service (the spawn-time terminalId → sessionId binding from Story 6.2) and the REAL
// reducer (the hook-removal path `applyHookStatus(id, { kind: 'removed' })` that index.ts's
// per-window board seam dispatches). `removeSession` here mirrors index.ts EXACTLY:
// applyHookStatus → collect the deltas that would ride handleDelta → CH.watchEvents.
//
// What must hold (spec 6.3 ACs):
//   - CH.terminalStop → `session.removed` for the bound id emitted SYNCHRONOUSLY (no
//     dependency on any external event), binding cleared;
//   - a STALE-TOKEN stop (StrictMode transient — the manager no-ops) removes NOTHING;
//   - PTY exit (double ctrl+c) → the same immediate removal via removeBoundSession;
//   - double removal (stop, then the belt-and-suspenders SessionEnd hook) → the second
//     emits [] and logs NOTHING (idempotent, quiet);
//   - Reopen-after-exit: the fresh mint gets a FRESH binding — no stale-binding removal
//     of the new session.
import { describe, it, expect, vi } from 'vitest'
import {
  removeBoundSession,
  stopTerminalAndRemoveBound,
  type StoppableTerminalManager
} from './launchRemoval'
import { createLaunchService, type LaunchService } from './launchSession'
import { createLaunchedSet } from './launchedSet'
import { createReducer, type Reducer, type SessionDelta } from '../c9watch/reducer'

const FIXED_NOW = 1_750_000_000_000
const HOOK_AUTHORITY_MS = 10_000
const CWD = '/home/op/proj'

/** A fake terminal manager exposing EXACTLY the Story-5.6 stop semantics the gate relies on:
 *  live registry deleted on a landed stop; a provided-but-stale openToken is a NO-OP. */
function fakeStoppableManager(): {
  manager: StoppableTerminalManager
  spawn(terminalId: string, openToken?: string): void
  exit(terminalId: string): void
} {
  const live = new Map<string, string | undefined>() // terminalId → current openToken
  return {
    manager: {
      has: (terminalId) => live.has(terminalId),
      stop: (terminalId, openToken) => {
        if (!live.has(terminalId)) return // already gone — idempotent
        const stored = live.get(terminalId)
        if (openToken !== undefined && openToken !== stored) return // stale token — NO-OP
        live.delete(terminalId)
      }
    },
    spawn: (terminalId, openToken) => live.set(terminalId, openToken),
    exit: (terminalId) => live.delete(terminalId) // a natural pty exit (registry entry gone)
  }
}

/** The REAL launch service with deterministic ids (the ancestry/correlation seams are inert —
 *  removal only touches launch/mintSpawn/sessionIdFor/unbind). */
function realLaunchService(newSessionId: () => string): LaunchService {
  return createLaunchService({
    terminalManager: { pidOf: () => null },
    launchedSet: createLaunchedSet(),
    spawn: (sessionId) => ({ file: '/bin/bash', args: ['-l', '-c', `claude '${sessionId}'`] }),
    readStatus: () => {
      throw new Error('ENOENT') // never consulted on the removal path
    },
    newTerminalId: () => 't-1',
    newSessionId,
    platform: 'linux'
  })
}

/** The index.ts board-seam mirror: applyHookStatus(removed) → the deltas handleDelta ships. */
function boardSeam(reducer: Reducer): {
  removeLaunched: (sessionId: string) => void
  shipped: SessionDelta[]
} {
  const shipped: SessionDelta[] = []
  return {
    removeLaunched: (sessionId) => {
      shipped.push(...reducer.applyHookStatus(sessionId, { kind: 'removed' }, HOOK_AUTHORITY_MS))
    },
    shipped
  }
}

/** Launch + mint + synthesize the instant card — the terminal:open handler's Story-6.2 steps. */
function launchAndSynthesize(
  svc: LaunchService,
  reducer: Reducer
): { terminalId: string; sessionId: string } {
  const { terminalId } = svc.launch({ cwd: CWD })
  const minted = svc.mintSpawn(terminalId)
  if (minted === null) throw new Error('unreachable — a launch terminalId always mints')
  reducer.upsertLaunched({
    id: minted.sessionId,
    status: 'Connecting',
    projectPath: CWD,
    sessionName: 'proj',
    pid: 51234
  })
  return { terminalId, sessionId: minted.sessionId }
}

describe('Story 6.3 — CH.terminalStop → immediate session.removed (stopTerminalAndRemoveBound)', () => {
  it('a landed stop emits session.removed for the bound id SYNCHRONOUSLY and clears the binding', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const log = vi.fn()
    const reducer = createReducer({ now: () => FIXED_NOW, log })
    const seam = boardSeam(reducer)
    const { manager, spawn } = fakeStoppableManager()

    const { terminalId, sessionId } = launchAndSynthesize(svc, reducer)
    spawn(terminalId, 'tok-1')
    expect(reducer.snapshotMap().has(sessionId)).toBe(true) // the instant card is on the board

    // The user's Stop — same tick, no external event: the card must be gone NOW.
    const removed = stopTerminalAndRemoveBound(
      terminalId,
      undefined, // user-initiated stop omits the token (unconditional kill)
      manager,
      svc,
      seam.removeLaunched
    )

    expect(removed).toBe(sessionId)
    expect(seam.shipped).toHaveLength(1)
    expect(seam.shipped[0]?.event.type).toBe('session.removed')
    expect(seam.shipped[0]?.event.id).toBe(sessionId)
    expect(reducer.snapshotMap().has(sessionId)).toBe(false) // gone from session truth
    expect(svc.sessionIdFor(terminalId)).toBeNull() // binding cleared after the removal
    expect(manager.has(terminalId)).toBe(false) // the pty was actually stopped
    expect(log).not.toHaveBeenCalled()
  })

  it('a token-matched stop (EmbeddedTerminal unmount of the CURRENT open) also removes', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)
    const { manager, spawn } = fakeStoppableManager()

    const { terminalId, sessionId } = launchAndSynthesize(svc, reducer)
    spawn(terminalId, 'tok-1')

    const removed = stopTerminalAndRemoveBound(
      terminalId,
      'tok-1',
      manager,
      svc,
      seam.removeLaunched
    )
    expect(removed).toBe(sessionId)
    expect(seam.shipped.map((d) => d.event.type)).toEqual(['session.removed'])
  })

  it('a STALE-TOKEN stop (StrictMode transient) removes NOTHING — the live card stays', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)
    const { manager, spawn } = fakeStoppableManager()

    const { terminalId, sessionId } = launchAndSynthesize(svc, reducer)
    spawn(terminalId, 'tok-2') // the SURVIVING open's token is current

    // The superseded mount's cleanup-stop carries the OLD token → the manager no-ops.
    const removed = stopTerminalAndRemoveBound(
      terminalId,
      'tok-1',
      manager,
      svc,
      seam.removeLaunched
    )

    expect(removed).toBeNull()
    expect(seam.shipped).toHaveLength(0) // NO removal delta
    expect(reducer.snapshotMap().has(sessionId)).toBe(true) // the card is untouched
    expect(svc.sessionIdFor(terminalId)).toBe(sessionId) // binding intact
    expect(manager.has(terminalId)).toBe(true) // the pty is still alive
  })

  it('stopping an ALREADY-DEAD terminal removes nothing (the exit path owns that removal)', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)
    const { manager } = fakeStoppableManager() // never spawned → not live

    const { terminalId } = launchAndSynthesize(svc, reducer)

    const removed = stopTerminalAndRemoveBound(
      terminalId,
      undefined,
      manager,
      svc,
      seam.removeLaunched
    )
    expect(removed).toBeNull()
    expect(seam.shipped).toHaveLength(0)
  })

  it('a null launch service (startup race) still stops the pty and never crashes', () => {
    const { manager, spawn } = fakeStoppableManager()
    spawn('t-1', 'tok-1')
    const removeSession = vi.fn()

    const removed = stopTerminalAndRemoveBound('t-1', undefined, manager, null, removeSession)

    expect(removed).toBeNull()
    expect(manager.has('t-1')).toBe(false) // the stop itself always executes
    expect(removeSession).not.toHaveBeenCalled()
  })

  it('a plain-shell terminal (no binding) stops without any removal dispatch', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const { manager, spawn } = fakeStoppableManager()
    spawn('host-term-0') // a Story-3.1 shell terminal — never minted
    const removeSession = vi.fn()

    const removed = stopTerminalAndRemoveBound(
      'host-term-0',
      undefined,
      manager,
      svc,
      removeSession
    )

    expect(removed).toBeNull()
    expect(manager.has('host-term-0')).toBe(false)
    expect(removeSession).not.toHaveBeenCalled()
  })
})

describe('Story 6.3 — PTY exit (double ctrl+c) → immediate removal (removeBoundSession)', () => {
  it('the exit removes the bound session synchronously and clears the binding', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)

    const { terminalId, sessionId } = launchAndSynthesize(svc, reducer)

    // index.ts onExit: forget() (correlation tracking) is independent; then the removal.
    svc.forget(terminalId)
    const removed = removeBoundSession(terminalId, svc, seam.removeLaunched)

    expect(removed).toBe(sessionId)
    expect(seam.shipped.map((d) => d.event.type)).toEqual(['session.removed'])
    expect(reducer.snapshotMap().has(sessionId)).toBe(false)
    expect(svc.sessionIdFor(terminalId)).toBeNull()
  })

  it('a second trigger for the same terminal is a no-op (binding already consumed)', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)

    const { terminalId } = launchAndSynthesize(svc, reducer)

    expect(removeBoundSession(terminalId, svc, seam.removeLaunched)).not.toBeNull()
    expect(removeBoundSession(terminalId, svc, seam.removeLaunched)).toBeNull()
    expect(seam.shipped).toHaveLength(1) // exactly ONE session.removed ever shipped
  })
})

describe('Story 6.3 — double removal & the late SessionEnd hook (idempotent, quiet)', () => {
  it('stop-removal first, SessionEnd hook second → the hook emits [] and logs NOTHING', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const log = vi.fn()
    const reducer = createReducer({ now: () => FIXED_NOW, log })
    const seam = boardSeam(reducer)
    const { manager, spawn } = fakeStoppableManager()

    const { terminalId, sessionId } = launchAndSynthesize(svc, reducer)
    spawn(terminalId, 'tok-1')

    // 1) The in-app Stop wins the race — card removed immediately.
    stopTerminalAndRemoveBound(terminalId, undefined, manager, svc, seam.removeLaunched)
    expect(seam.shipped).toHaveLength(1)

    // 2) claude's SessionEnd hook lands LATER for the same id (belt-and-suspenders): the
    // hook-server path calls applyHookStatus(removed) — it must emit [] and stay silent
    // (no hook_unknown_id noise for an already-removed launched session).
    const late = reducer.applyHookStatus(sessionId, { kind: 'removed' }, HOOK_AUTHORITY_MS)
    expect(late).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('Story 6.3 — Reopen after exit: fresh binding, no stale removal', () => {
  it('the reopened session gets a FRESH binding; a later stop removes ONLY the new id', () => {
    let s = 0
    const svc = realLaunchService(() => `sess-${++s}`)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const seam = boardSeam(reducer)
    const { manager, spawn, exit } = fakeStoppableManager()

    // Spawn #1 → exits for real (double ctrl+c): card removed, binding cleared.
    const { terminalId, sessionId: firstId } = launchAndSynthesize(svc, reducer)
    spawn(terminalId, 'tok-1')
    exit(terminalId)
    svc.forget(terminalId)
    removeBoundSession(terminalId, svc, seam.removeLaunched)
    expect(firstId).toBe('sess-1')
    expect(svc.sessionIdFor(terminalId)).toBeNull()

    // Reopen → a NEW actual spawn mints a FRESH identity + binding + instant card.
    const reopened = svc.mintSpawn(terminalId)
    if (reopened === null) throw new Error('unreachable — the durable recipe survives')
    expect(reopened.sessionId).toBe('sess-2')
    expect(svc.sessionIdFor(terminalId)).toBe('sess-2')
    reducer.upsertLaunched({
      id: reopened.sessionId,
      status: 'Connecting',
      projectPath: CWD,
      sessionName: 'proj',
      pid: 51299
    })
    spawn(terminalId, 'tok-2')

    // A later stop removes EXACTLY the new session — never a stale-binding removal.
    const removed = stopTerminalAndRemoveBound(
      terminalId,
      undefined,
      manager,
      svc,
      seam.removeLaunched
    )
    expect(removed).toBe('sess-2')
    const removedIds = seam.shipped
      .filter((d) => d.event.type === 'session.removed')
      .map((d) => d.event.id)
    expect(removedIds).toEqual(['sess-1', 'sess-2']) // each removed exactly once
    expect(reducer.snapshotMap().size).toBe(0)
  })
})
