// Story 3.2 (FR-11) + Story 5.5 — the launch-service DI-seam tests.
//
// Project: `main-unit` (environment: 'node'). NO real node-pty (the terminal manager is a
// fake), NO live `claude` (the `/proc` reader is an injected fake).
//
// Story 5.5 — the correlation is now SUBTREE ANCESTRY: a c9watch session matches a launched
// terminal iff the session's process (its Tgid) DESCENDS from the terminal's PTY leader pid
// (`pidOf`). The fixtures model claude 2.1.186's REAL shape captured live:
//     PTY leader (claude ELF, the shell exec'd it)
//       └─ npm exec claude
//          └─ MainThread        ← the c9watch-TRACKED session leader (Tgid)
//             └─ <wandering reported thread>   ← what c9watch reports as session.pid
// The pre-5.5 immediate-`claude`-child walk (readComm/listChildren) is gone — the tracked
// session is a DEEP descendant, not a child named `claude`.
//
// Covered:
//   - launch() registers a durable spawn override (file=claude, cwd=picked) + returns the opaque
//     terminalId; peekSpawnOverride is NON-consuming (Story 5.4); the terminal is typeable
//     immediately (no correlation blocking).
//   - the ancestry join: a session whose process descends from the PTY leader correlates (via the
//     wandering reported pid → Tgid → PPid walk), keyed on the stable id → enters the launched-set.
//   - no false claim: a session NOT under the PTY leader is never matched.
//   - the optimistic window: pidOf null (terminal not open yet) → pending, retry next delta.
//   - reconcile on a LATER delta (the reported pid wanders — never cached).
//   - never-crash: a fail-closed `/proc` read (gone/malformed) never throws + never adds a false
//     membership; one bad session never aborts the others.
//   - Linux gate: on a non-linux platform the correlation is skipped (launched-set stays empty).
import { describe, it, expect, vi } from 'vitest'
import { createLaunchService, type LaunchTerminalManager } from './launchSession'
import { createLaunchedSet } from './launchedSet'
import type { ReadStatus } from './pidCorrelation'
import type { Session } from '../../shared/schemas/session'

// ── SYNTHETIC `/proc` FIXTURES (grounded in the REAL Story-5.5 live tree) ──────────────────────
// A `/proc/<pid>/status` blob carrying the fields the correlation reads: Tgid (resolve a wandering
// thread to its process leader) + PPid (walk ancestry up to the PTY leader).
function status(pid: number, tgid: number, ppid: number, name = 'x'): string {
  return [
    `Name:\t${name}`,
    'State:\tS (sleeping)',
    `Tgid:\t${tgid}`,
    `Pid:\t${pid}`,
    `PPid:\t${ppid}`,
    ''
  ].join('\n')
}
function readStatusFrom(table: Readonly<Record<number, string>>): ReadStatus {
  return (pid: number): string => {
    const blob = table[pid]
    if (blob === undefined) throw new Error('ENOENT')
    return blob
  }
}

// The live claude 2.1.186 launch tree: leader → npm exec claude → MainThread (the tracked session)
// → a wandering reported thread. pidOf returns LEADER_PID; c9watch reports REPORTED_PID.
const ELECTRON_PID = 461573 // the PTY leader's parent (above the PTY — NOT under the leader)
const LEADER_PID = 462856 // the PTY leader (what pidOf returns); the claude ELF (shell exec'd it)
const NPM_PID = 463125 // `npm exec claude`, child of the leader
const SESSION_TGID = 463321 // the tracked session's process leader (MainThread), child of npm
const REPORTED_PID = 463325 // a wandering reported thread of the session (its Tgid == SESSION_TGID)

/** The readStatus table for a session that DESCENDS from LEADER_PID (the happy-path ancestry). */
function launchTree(): Record<number, string> {
  return {
    // the wandering reported thread → resolves to the session leader Tgid.
    [REPORTED_PID]: status(REPORTED_PID, SESSION_TGID, SESSION_TGID, 'MainThread'),
    // the session leader → parent is npm exec claude.
    [SESSION_TGID]: status(SESSION_TGID, SESSION_TGID, NPM_PID, 'MainThread'),
    // npm exec claude → parent is the PTY leader.
    [NPM_PID]: status(NPM_PID, NPM_PID, LEADER_PID, 'npm exec claude'),
    // the PTY leader → parent is electron (the ancestry walk STOPS at LEADER_PID, so this is only
    // for completeness; isAncestorOf checks `pid === LEADER_PID` before reading it).
    [LEADER_PID]: status(LEADER_PID, LEADER_PID, ELECTRON_PID, 'claude')
  }
}

/** A minimal Session for the correlation (only id + pid are read). The rest satisfy the type. */
function session(id: string, pid: number): Session {
  return {
    id,
    pid,
    status: 'Working',
    projectPath: '/p',
    sessionName: 'n'
  } as Session
}

/** A fake terminal manager: returns a fixed PTY-leader pid from pidOf() (the launch SPAWN rides the
 *  existing terminal:open handler — the service only reads pidOf for the ancestry correlation). */
function fakeTerminalManager(leaderByTerminal: Record<string, number | null>): {
  manager: LaunchTerminalManager
} {
  const manager: LaunchTerminalManager = {
    pidOf: (terminalId): number | null => leaderByTerminal[terminalId] ?? null
  }
  return { manager }
}

describe('launchSession.launch — raw claude via the REUSED terminal manager (AC-1)', () => {
  it('mints an opaque terminalId and registers a spawn override of file=claude + the picked cwd', () => {
    const { manager } = fakeTerminalManager({})
    let n = 0
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude', env: { PATH: '/usr/bin' } },
      readStatus: readStatusFrom({}),
      newTerminalId: () => `t-${++n}`,
      platform: 'linux'
    })

    const out = svc.launch({ cwd: '/home/op/proj' })
    expect(out.terminalId).toBe('t-1')
    // The spawn override main reads on terminal:open carries file=claude + the picked cwd.
    const ov = svc.peekSpawnOverride('t-1')
    expect(ov).toEqual({ file: 'claude', cwd: '/home/op/proj', env: { PATH: '/usr/bin' } })
    // NON-CONSUMING (Story 5.4): a second peek returns the SAME override. The recipe is durable so
    // a StrictMode dev double-mount's surviving open AND a Reopen both still spawn claude (a
    // consume-once read was the dev blank-terminal bug + the latent Reopen bug).
    expect(svc.peekSpawnOverride('t-1')).toEqual(ov)
  })

  it('a non-launch terminalId has no override (the Story-3.1 host path is unaffected)', () => {
    const { manager } = fakeTerminalManager({})
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude' },
      readStatus: readStatusFrom({}),
      platform: 'linux'
    })
    expect(svc.peekSpawnOverride('host-term-0')).toBeNull()
  })
})

describe('launchSession — optimistic card + the subtree-ancestry join (Story 5.5)', () => {
  it('the join lands: a session DESCENDING from the PTY leader correlates → its id enters the set', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    // The reported pid is a deep descendant's wandering thread, NOT the leader — the naive
    // spawnedPid===reportedPid (or even Tgid===leader) would FAIL; the ANCESTRY walk succeeds.
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])

    expect(set.has('sess-A')).toBe(true) // joined, keyed on the stable id
    expect(svc.isPending('t-1')).toBe(false) // reconciled
    expect(REPORTED_PID).not.toBe(LEADER_PID) // the tracked session is NOT the PTY leader
    expect(SESSION_TGID).not.toBe(LEADER_PID) // ...and its Tgid differs from the leader (deep nest)
  })

  it('no false claim: a session whose process is NOT under the PTY leader is never matched', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    // An UNRELATED claude (e.g. a different terminal, or the operator's own agent): its ancestry
    // reaches init (1) WITHOUT crossing our PTY leader.
    const OTHER_REPORTED = 990001
    const OTHER_TGID = 990000
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom({
        [OTHER_REPORTED]: status(OTHER_REPORTED, OTHER_TGID, OTHER_TGID, 'MainThread'),
        [OTHER_TGID]: status(OTHER_TGID, OTHER_TGID, 1, 'MainThread') // parent=init → not under us
      }),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-other', OTHER_REPORTED)])

    expect(set.size()).toBe(0) // NO false membership — the session isn't ours
    expect(svc.isPending('t-1')).toBe(true) // still App-launched-optimistic, awaiting OUR session
  })

  it('the optimistic window: pidOf null (terminal not open yet) → pending, NO membership', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': null }) // terminal not open → no leader pid yet
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])

    expect(svc.isPending('t-1')).toBe(true) // optimistic — retries when pidOf resolves
    expect(set.size()).toBe(0)
  })

  it('reconciles on a LATER delta (re-resolve each tick — the reported pid wanders, never cached)', () => {
    const set = createLaunchedSet()
    // pidOf is stable (the PTY leader does not wander). The session subtree appears only on tick 2,
    // and the reported pid is a DIFFERENT wandering thread each tick.
    const REPORTED_T2 = 463999
    const tableRef = { current: {} as Record<number, string> }
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: (pid: number): string => {
        const blob = tableRef.current[pid]
        if (blob === undefined) throw new Error('ENOENT')
        return blob
      },
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })

    // Tick 1: the session's process is not in /proc yet (subtree not spawned) → resolveTgid throws
    // → no match.
    svc.correlateAgainst([session('sess-A', 463900)])
    expect(set.size()).toBe(0)

    // Tick 2: the subtree exists + the session reports a DIFFERENT wandering pid → ancestry join.
    tableRef.current = {
      [REPORTED_T2]: status(REPORTED_T2, SESSION_TGID, SESSION_TGID, 'MainThread'),
      [SESSION_TGID]: status(SESSION_TGID, SESSION_TGID, NPM_PID, 'MainThread'),
      [NPM_PID]: status(NPM_PID, NPM_PID, LEADER_PID, 'npm exec claude')
    }
    svc.correlateAgainst([session('sess-A', REPORTED_T2)])
    expect(set.has('sess-A')).toBe(true)
  })
})

describe('launchSession — never-crash / fail-closed', () => {
  it('a process-gone reported pid fails closed (no throw, no false membership), keeps scanning', () => {
    const set = createLaunchedSet()
    const log = vi.fn()
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      // the FIRST session's pid is gone (readStatus throws → matched:false); the SECOND session
      // is a real descendant of the PTY leader → matches.
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux',
      log
    })
    svc.launch({ cwd: '/p' })
    // sess-gone's pid 999999 is absent from /proc (reader throws → fail closed); sess-A joins.
    expect(() =>
      svc.correlateAgainst([session('sess-gone', 999999), session('sess-A', REPORTED_PID)])
    ).not.toThrow()
    expect(set.has('sess-gone')).toBe(false)
    expect(set.has('sess-A')).toBe(true)
  })

  it('does not double-claim: a session already in the launched-set is skipped by other launches', () => {
    const set = createLaunchedSet()
    set.add('sess-A') // already claimed by a prior launch
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-2',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    // sess-A was already claimed → this launch stays pending (it does not steal the claim).
    expect(svc.isPending('t-2')).toBe(true)
    expect(set.size()).toBe(1)
  })
})

describe('launchSession — Linux gate (/proc is Linux)', () => {
  it('skips the correlation on a non-linux platform (the launched-set stays empty)', () => {
    const set = createLaunchedSet()
    const manager: LaunchTerminalManager = { pidOf: () => LEADER_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'darwin'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    expect(set.size()).toBe(0) // correlation skipped off-Linux; the terminal still works
  })
})

describe('Story 3.4 — onCorrelated fires the terminalId↔sessionId binding on a landed join', () => {
  it('fires ONCE with { terminalId, sessionId } when the ancestry join lands', () => {
    const set = createLaunchedSet()
    const onCorrelated = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])

    expect(onCorrelated).toHaveBeenCalledTimes(1)
    expect(onCorrelated).toHaveBeenCalledWith({ terminalId: 't-1', sessionId: 'sess-A' })

    // A SECOND correlateAgainst (the launch is already joined) does NOT re-fire it.
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    expect(onCorrelated).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire in the optimistic window (pidOf null → no leader → no binding)', () => {
    const onCorrelated = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': null }) // terminal not open yet
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', REPORTED_PID)])
    expect(onCorrelated).not.toHaveBeenCalled()
  })

  it('a THROWING onCorrelated never escapes the per-delta loop (fail-closed) and the join still lands', () => {
    const set = createLaunchedSet()
    const log = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': LEADER_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      readStatus: readStatusFrom(launchTree()),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated: () => {
        throw new Error('window destroyed')
      },
      log
    })
    svc.launch({ cwd: '/p' })
    expect(() => svc.correlateAgainst([session('sess-A', REPORTED_PID)])).not.toThrow()
    // The join STILL lands (the membership add precedes the callback) and the throw was logged code-only.
    expect(set.has('sess-A')).toBe(true)
    expect(log).toHaveBeenCalledWith('[c9watch][launch] code=on_correlated_failed')
  })
})

describe('launchSession — forget (drops correlation tracking, KEEPS the recipe)', () => {
  it('forget() drops a launch’s correlation tracking but KEEPS its spawn-override (idempotent)', () => {
    const manager: LaunchTerminalManager = { pidOf: () => null }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude' },
      readStatus: readStatusFrom({}),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    expect(svc.isPending('t-1')).toBe(true)
    svc.forget('t-1')
    // Correlation tracking dropped — the launch is no longer pending / re-correlated.
    expect(svc.isPending('t-1')).toBe(false)
    // ...but the spawn-override (the Reopen recipe) SURVIVES forget (Story 5.4): forget() runs when
    // claude exits FOR REAL, and a dead-pane Reopen must still re-spawn claude (not the default
    // $SHELL). A pre-5.4 forget that also deleted the override broke Reopen.
    expect(svc.peekSpawnOverride('t-1')).toEqual({ file: 'claude', cwd: '/p' })
    svc.forget('t-1') // idempotent
    expect(svc.peekSpawnOverride('t-1')).toEqual({ file: 'claude', cwd: '/p' })
  })
})
