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
  archiveBoundSessions,
  deleteTerminalSession,
  removeBoundSession,
  stopTerminalAndRemoveBound,
  type RemovalReason,
  type StoppableTerminalManager
} from './launchRemoval'
import { createLaunchService, type LaunchService } from './launchSession'
import { buildLaunchedSession } from './launchSynthesis'
import { createLaunchedSet } from './launchedSet'
import { createReducer, type Reducer, type SessionDelta } from '../c9watch/reducer'
import { applyRemovalReason } from '../persistence/pastSessionRecord'
import { createPastSessionsStore, type PastSessionsStore } from '../persistence/pastSessions'

const FIXED_NOW = 1_750_000_000_000
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
      shipped.push(...reducer.applyHookStatus(sessionId, { kind: 'removed' }))
    },
    shipped
  }
}

/** Launch + mint + synthesize the instant card — the terminal:open handler's Story-6.2 steps. */
function launchAndSynthesize(
  svc: LaunchService,
  reducer: Reducer
): { terminalId: string; sessionId: string } {
  const { terminalId } = svc.launch({ cwd: CWD, name: 'proj' })
  const minted = svc.mintSpawn(terminalId)
  if (minted === null) throw new Error('unreachable — a launch terminalId always mints')
  // Session-naming: use the SHIPPED synthesis rather than a hand-rolled copy of the Session
  // shape (see launchMint.test.ts openMirror for the same fix and the rationale).
  reducer.upsertLaunched(buildLaunchedSession(minted, 51234, 'default', []))
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
    const late = reducer.applyHookStatus(sessionId, { kind: 'removed' })
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
    reducer.upsertLaunched(buildLaunchedSession(reopened, 51299, 'default', []))
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

// ---------------------------------------------------------------------------------------------
// Past sessions — the removal seam WITH the history. `historySeam` mirrors index.ts
// `removeLaunchedSession` exactly (applyRemovalReason → applyHookStatus removed), over the REAL
// launch service, the REAL reducer and the REAL past-sessions store.
// ---------------------------------------------------------------------------------------------
const ENDED = FIXED_NOW + 60_000

function multiLaunchService(): LaunchService {
  let t = 0
  let s = 0
  return createLaunchService({
    terminalManager: { pidOf: () => null },
    launchedSet: createLaunchedSet(),
    spawn: (sessionId) => ({ file: '/bin/bash', args: ['-l', '-c', `claude '${sessionId}'`] }),
    readStatus: () => {
      throw new Error('ENOENT')
    },
    newTerminalId: () => `t-${++t}`,
    newSessionId: () => `sess-${++s}`,
    now: () => FIXED_NOW,
    platform: 'linux'
  })
}

function historySeam(
  reducer: Reducer,
  store: PastSessionsStore
): { removeLaunched: (sessionId: string, reason: RemovalReason) => void } {
  return {
    removeLaunched: (sessionId, reason) => {
      applyRemovalReason(reason, sessionId, reducer.snapshotMap().get(sessionId), store, ENDED)
      reducer.applyHookStatus(sessionId, { kind: 'removed' })
    }
  }
}

// Past sessions (D-3) — a QUIT or a WINDOW CLOSE ends every live session without an onExit:
// `terminalManager.destroyAll()` / `stop()` dispose the exit listener BEFORE the kill, so the pty
// exit path that archives never runs. `archiveBoundSessions` is the step every such path runs
// FIRST.
describe('Past sessions — archiveBoundSessions (quit / window close archive every live session)', () => {
  function twoLiveSessions(): {
    svc: LaunchService
    reducer: Reducer
    store: PastSessionsStore
    seam: ReturnType<typeof historySeam>
  } {
    const svc = multiLaunchService()
    const reducer = createReducer({ now: () => FIXED_NOW })
    const store = createPastSessionsStore({ log: () => {} })
    for (const name of ['api', 'web']) {
      const { terminalId } = svc.launch({ cwd: `/home/op/${name}`, name })
      const minted = svc.mintSpawn(terminalId)
      if (minted === null) throw new Error('unreachable — a launch terminalId always mints')
      reducer.upsertLaunched(buildLaunchedSession(minted, 51234, 'default', []))
    }
    return { svc, reducer, store, seam: historySeam(reducer, store) }
  }

  it('archives EVERY bound session: one record each, cards gone, bindings consumed', () => {
    const { svc, reducer, store, seam } = twoLiveSessions()
    const log = vi.fn()

    const archived = archiveBoundSessions(
      svc,
      (_terminalId, sessionId) => seam.removeLaunched(sessionId, 'archive'),
      log
    )

    expect(archived).toEqual(['sess-1', 'sess-2'])
    expect(store.list().map((r) => [r.id, r.name, r.cwd, r.endedAt])).toEqual([
      ['sess-1', 'api', '/home/op/api', ENDED],
      ['sess-2', 'web', '/home/op/web', ENDED]
    ])
    expect(reducer.snapshotMap().size).toBe(0)
    expect(svc.bindings()).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('is idempotent: a second run archives nothing and the history keeps ONE record per session', () => {
    const { svc, store, seam } = twoLiveSessions()
    const archive = (_terminalId: string, sessionId: string): void =>
      seam.removeLaunched(sessionId, 'archive')

    archiveBoundSessions(svc, archive, vi.fn())
    const again = archiveBoundSessions(svc, archive, vi.fn())

    expect(again).toEqual([])
    expect(store.list().map((r) => r.id)).toEqual(['sess-1', 'sess-2'])
  })

  it('`include` narrows it to one window: the other terminal stays bound and on the board', () => {
    const { svc, reducer, store, seam } = twoLiveSessions()

    const archived = archiveBoundSessions(
      svc,
      (_terminalId, sessionId) => seam.removeLaunched(sessionId, 'archive'),
      vi.fn(),
      (terminalId) => terminalId === 't-2'
    )

    expect(archived).toEqual(['sess-2'])
    expect(store.list().map((r) => r.id)).toEqual(['sess-2'])
    expect(reducer.snapshotMap().has('sess-1')).toBe(true)
    expect(svc.sessionIdFor('t-1')).toBe('sess-1')
  })

  it('a failure on one session is contained: logs a code (no value), the rest still archive, never throws', () => {
    const { svc, store, seam } = twoLiveSessions()
    const log = vi.fn()

    const archived = archiveBoundSessions(
      svc,
      (_terminalId, sessionId) => {
        if (sessionId === 'sess-1') throw new Error('/home/op/api disk full')
        seam.removeLaunched(sessionId, 'archive')
      },
      log
    )

    expect(archived).toEqual(['sess-2'])
    expect(store.list().map((r) => r.id)).toEqual(['sess-2'])
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toMatch(/code=teardown_archive_failed$/)
    expect(line).not.toContain('/home/op')
    expect(line).not.toContain('sess-1')
  })

  it('a bindings() read that throws is contained too, and a null launch service is a no-op', () => {
    const log = vi.fn()
    const broken = {
      bindings: (): never => {
        throw new Error('boom')
      },
      sessionIdFor: (): null => null,
      unbind: (): void => {}
    }
    expect(archiveBoundSessions(broken, vi.fn(), log)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(archiveBoundSessions(null, vi.fn(), log)).toEqual([])
  })
})

// Past sessions (D-3/D-4) — CH.sessionDelete. A Delete pressed on a pane whose claude already
// exited finds NO binding (the exit archived the card and consumed it) and the renderer knows no
// id for it either (the card is gone), yet the record that exit wrote must go. Main owns the
// answer: the launch override remembers the id the terminal was LAST bound to.
describe('Past sessions — deleteTerminalSession (Delete drops the record, dead pane included)', () => {
  function sessions(names: readonly string[]): {
    svc: LaunchService
    reducer: Reducer
    store: PastSessionsStore
    manager: StoppableTerminalManager
    /** index.ts onExit for `terminalId`: forget, then the ARCHIVE via removeBoundSession. */
    exitPty: (terminalId: string) => void
    /** index.ts CH.sessionDelete for `terminalId`, with the renderer's hint. */
    del: (terminalId: string, hint: string | null) => void
  } {
    const svc = multiLaunchService()
    const reducer = createReducer({ now: () => FIXED_NOW })
    const store = createPastSessionsStore({ log: () => {} })
    const seam = historySeam(reducer, store)
    const { manager, spawn, exit } = fakeStoppableManager()
    for (const name of names) {
      const { terminalId } = svc.launch({ cwd: `/home/op/${name}`, name })
      const minted = svc.mintSpawn(terminalId)
      if (minted === null) throw new Error('unreachable — a launch terminalId always mints')
      reducer.upsertLaunched(buildLaunchedSession(minted, 51234, 'default', []))
      spawn(terminalId)
    }
    return {
      svc,
      reducer,
      store,
      manager,
      exitPty: (terminalId) => {
        exit(terminalId)
        svc.forget(terminalId)
        removeBoundSession(terminalId, svc, (id) => seam.removeLaunched(id, 'archive'))
      },
      del: (terminalId, hint) =>
        deleteTerminalSession(
          terminalId,
          hint,
          manager,
          svc,
          (id) => seam.removeLaunched(id, 'delete'),
          (id) => {
            store.remove(id)
          }
        )
    }
  }

  it('Delete on a pane whose claude already EXITED drops the record the exit archived', () => {
    const s = sessions(['api'])
    s.exitPty('t-1')
    expect(s.store.get('sess-1')).not.toBeNull() // the exit archived it

    s.del('t-1', null) // the card is gone, so the renderer's hint is null

    expect(s.store.list()).toEqual([])
  })

  it('after /clear, the dead-pane Delete drops the record under the NEW id', () => {
    const s = sessions(['api'])
    // index.ts adoptCard: re-key the card, move the binding, remove the old id.
    const stored = s.reducer.snapshotMap().get('sess-1')
    if (stored === undefined) throw new Error('unreachable — the card was synthesized')
    s.reducer.upsertLaunched({ ...stored, id: 'sess-cleared' })
    s.svc.rebind('t-1', 'sess-cleared')
    s.reducer.applyHookStatus('sess-1', { kind: 'removed' })
    s.exitPty('t-1')
    expect(s.store.list().map((r) => r.id)).toEqual(['sess-cleared'])

    s.del('t-1', null)

    expect(s.store.list()).toEqual([])
  })

  it('touches only THIS terminal: another pane’s record stays', () => {
    const s = sessions(['api', 'web'])
    s.exitPty('t-1')
    s.exitPty('t-2')

    s.del('t-1', null)

    expect(s.store.list().map((r) => r.id)).toEqual(['sess-2'])
  })

  it('Delete on a LIVE pane stops it, removes the card and drops any record for its id', () => {
    const s = sessions(['api'])
    // A record for a live id: a dead-pane Reopen of a resumed session re-runs a listed id.
    s.store.archive({
      id: 'sess-1',
      name: 'api',
      cwd: '/home/op/api',
      workspaceId: 'default',
      tagIds: [],
      launchedAt: FIXED_NOW,
      endedAt: FIXED_NOW
    })

    s.del('t-1', 'sess-1')

    expect(s.manager.has('t-1')).toBe(false)
    expect(s.reducer.snapshotMap().has('sess-1')).toBe(false)
    expect(s.store.list()).toEqual([])
  })

  it('a terminal with no launch recipe (a plain shell) drops nothing but the renderer’s own hint', () => {
    const s = sessions(['api'])
    s.exitPty('t-1')

    s.del('host-term-0', null)
    expect(s.store.list().map((r) => r.id)).toEqual(['sess-1'])

    s.del('host-term-0', 'sess-1')
    expect(s.store.list()).toEqual([])
  })
})
