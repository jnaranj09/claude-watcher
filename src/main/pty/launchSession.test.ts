// Story 3.2 (FR-11) — the launch-service DI-seam tests (AC: #1, #2, #3, #4).
//
// Project: `main-unit` (environment: 'node'). NO real node-pty (the terminal manager is a
// fake), NO live `claude` (the `/proc` readers are injected fakes grounded in the REAL shapes
// captured in Story 0.4). Reuses the Story-0.4 pidCorrelation.test.ts fake-`/proc` pattern.
//
// Covered:
//   - launch() spawns through the REUSED terminal manager (file='claude', cwd=picked) + returns
//     the opaque terminalId; the terminal is typeable immediately (no correlation blocking).
//   - the optimistic-card window (t0): before the join lands, the launch is pending + NO
//     launched-set membership (no false membership in the t0 window — UX-DR19).
//   - the Tgid join: a wandering reported pid correlates via Tgid (NOT spawnedPid===reportedPid),
//     keyed on the stable session id → the id enters the launched-set (AC-2/4).
//   - re-resolve on each delta: a launch whose claude appears only on a LATER delta reconciles
//     then (the reported pid wanders — never cached).
//   - never-crash: a fail-closed `/proc` read (gone/malformed) never throws + never adds a false
//     membership; one bad session never aborts the others.
//   - Linux gate: on a non-linux platform the correlation is skipped (launched-set stays empty).
import { describe, it, expect, vi } from 'vitest'
import { createLaunchService, type LaunchTerminalManager } from './launchSession'
import { createLaunchedSet } from './launchedSet'
import type { ReadStatus, ReadComm, ListChildren } from './pidCorrelation'
import type { Session } from '../../shared/schemas/session'

// ── SYNTHETIC `/proc` FIXTURES (grounded in the REAL Story-0.4 shapes) ────────────────────────
// Wandering thread: Name HeapHelper, Tgid != Pid. Leader: Name claude, Tgid == Pid.
function statusThread(pid: number, tgid: number, name = 'HeapHelper'): string {
  return [`Name:\t${name}`, 'State:\tS (sleeping)', `Tgid:\t${tgid}`, `Pid:\t${pid}`, ''].join('\n')
}
function statusLeader(pid: number, name = 'claude'): string {
  return statusThread(pid, pid, name)
}
function readStatusFrom(table: Readonly<Record<number, string>>): ReadStatus {
  return (pid: number): string => {
    const blob = table[pid]
    if (blob === undefined) throw new Error('ENOENT')
    return blob
  }
}
function readCommFrom(table: Readonly<Record<number, string>>): ReadComm {
  return (pid: number): string => {
    const comm = table[pid]
    if (comm === undefined) throw new Error('ENOENT')
    return comm
  }
}
function listChildrenFrom(table: Readonly<Record<number, readonly number[]>>): ListChildren {
  return (shellPid: number): readonly number[] => table[shellPid] ?? []
}

/** A minimal Session for the correlation (only id + pid are read by correlate). The rest are
 *  filled to satisfy the type; they are never touched by the join. */
function session(id: string, pid: number): Session {
  return {
    id,
    pid,
    status: 'Working',
    projectPath: '/p',
    sessionName: 'n'
  } as Session
}

/** A fake terminal manager: returns a fixed shell pid from pidOf() (the launch SPAWN rides the
 *  existing terminal:open handler — the service only reads pidOf for the correlation walk). */
function fakeTerminalManager(shellPidByTerminal: Record<string, number | null>): {
  manager: LaunchTerminalManager
} {
  const manager: LaunchTerminalManager = {
    pidOf: (terminalId): number | null => shellPidByTerminal[terminalId] ?? null
  }
  return { manager }
}

const REAL_CLAUDE_TGID = 664817
const SHELL_PID = 189223

describe('launchSession.launch — raw claude via the REUSED terminal manager (AC-1)', () => {
  it('mints an opaque terminalId and registers a spawn override of file=claude + the picked cwd', () => {
    const { manager } = fakeTerminalManager({})
    let n = 0
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude', env: { PATH: '/usr/bin' } },
      readStatus: readStatusFrom({}),
      readComm: readCommFrom({}),
      listChildren: listChildrenFrom({}),
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
      readComm: readCommFrom({}),
      listChildren: listChildrenFrom({}),
      platform: 'linux'
    })
    expect(svc.peekSpawnOverride('host-term-0')).toBeNull()
  })
})

describe('launchSession — optimistic card + the Tgid join (AC-2, AC-3, AC-4)', () => {
  it('the t0 window: claude not resolvable yet → launch pending, NO launched-set membership', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': SHELL_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      // Shell exists but only a bash child so far — claude NOT spawned/scanned yet (t0 gap).
      listChildren: listChildrenFrom({ [SHELL_PID]: [200001] }),
      readComm: readCommFrom({ 200001: 'bash' }),
      readStatus: readStatusFrom({}),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', 664819)])

    expect(svc.isPending('t-1')).toBe(true) // still App-launched-optimistic
    expect(set.size()).toBe(0) // NO false membership in the t0 window (UX-DR19)
  })

  it('the join lands: a wandering reported pid correlates via Tgid → the session id enters the set', () => {
    const set = createLaunchedSet()
    const { manager } = fakeTerminalManager({ 't-1': SHELL_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      // shell → claude(664817) child; comm validates it is claude (not the bash leader).
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      // app claude leader (Tgid==Pid) + the session's WANDERING reported pid 664819 → Tgid 664817.
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    // The reported pid 664819 != the app claude Tgid 664817 — the NAIVE spawnedPid===reportedPid
    // would FAIL; the Tgid join SUCCEEDS, keyed on the stable id.
    svc.correlateAgainst([session('sess-A', 664819)])

    expect(set.has('sess-A')).toBe(true) // joined, keyed on the stable id
    expect(svc.isPending('t-1')).toBe(false) // reconciled
    expect(664819).not.toBe(REAL_CLAUDE_TGID) // the wandering reported pid is NOT the app Tgid
  })

  it('reconciles on a LATER delta (re-resolve each tick — the reported pid wanders, never cached)', () => {
    const set = createLaunchedSet()
    // pidOf returns the shell pid; the children list FLIPS from bash-only → claude on tick 2.
    const childrenRef: { current: Record<number, readonly number[]> } = {
      current: { [SHELL_PID]: [200001] }
    }
    const manager: LaunchTerminalManager = {
      pidOf: () => SHELL_PID
    }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: (shellPid): readonly number[] => childrenRef.current[shellPid] ?? [],
      readComm: readCommFrom({ 200001: 'bash', [REAL_CLAUDE_TGID]: 'claude' }),
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664822: statusThread(664822, REAL_CLAUDE_TGID) // a DIFFERENT wandering pid on tick 2
      }),
      newTerminalId: () => 't-1',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })

    // Tick 1: claude not a child yet → no join.
    svc.correlateAgainst([session('sess-A', 664819)])
    expect(set.size()).toBe(0)

    // Tick 2: claude now a child + the session reports a DIFFERENT wandering pid → join lands.
    childrenRef.current = { [SHELL_PID]: [REAL_CLAUDE_TGID] }
    svc.correlateAgainst([session('sess-A', 664822)])
    expect(set.has('sess-A')).toBe(true)
  })
})

describe('launchSession — never-crash / fail-closed (AC-3, AC-9)', () => {
  it('a process-gone reported pid fails closed (no throw, no false membership), keeps scanning', () => {
    const set = createLaunchedSet()
    const log = vi.fn()
    const manager: LaunchTerminalManager = { pidOf: () => SHELL_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      // app claude resolves; the FIRST session's pid is gone (throws → matched:false); the
      // SECOND session is a real wandering thread of the app claude → matches.
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-1',
      platform: 'linux',
      log
    })
    svc.launch({ cwd: '/p' })
    // sess-gone's pid 999999 is absent from /proc (reader throws → fail closed); sess-A joins.
    expect(() =>
      svc.correlateAgainst([session('sess-gone', 999999), session('sess-A', 664819)])
    ).not.toThrow()
    expect(set.has('sess-gone')).toBe(false)
    expect(set.has('sess-A')).toBe(true)
  })

  it('does not double-claim: a session already in the launched-set is skipped by other launches', () => {
    const set = createLaunchedSet()
    set.add('sess-A') // already claimed by a prior launch
    const manager: LaunchTerminalManager = { pidOf: () => SHELL_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-2',
      platform: 'linux'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', 664819)])
    // sess-A was already claimed → this launch stays pending (it does not steal the claim).
    expect(svc.isPending('t-2')).toBe(true)
    expect(set.size()).toBe(1)
  })
})

describe('launchSession — Linux gate (AC-3, /proc is Linux)', () => {
  it('skips the correlation on a non-linux platform (the launched-set stays empty)', () => {
    const set = createLaunchedSet()
    const manager: LaunchTerminalManager = { pidOf: () => SHELL_PID }
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-1',
      platform: 'darwin'
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', 664819)])
    expect(set.size()).toBe(0) // correlation skipped off-Linux; the terminal still works
  })
})

describe('Story 3.4 — onCorrelated fires the terminalId↔sessionId binding on a landed join', () => {
  it('fires ONCE with { terminalId, sessionId } when the Tgid join lands', () => {
    const set = createLaunchedSet()
    const onCorrelated = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': SHELL_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', 664819)])

    expect(onCorrelated).toHaveBeenCalledTimes(1)
    expect(onCorrelated).toHaveBeenCalledWith({ terminalId: 't-1', sessionId: 'sess-A' })

    // A SECOND correlateAgainst (the launch is already joined) does NOT re-fire it.
    svc.correlateAgainst([session('sess-A', 664819)])
    expect(onCorrelated).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire in the t0 window (no join yet → no binding)', () => {
    const onCorrelated = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': SHELL_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: createLaunchedSet(),
      spawn: { file: 'claude' },
      // claude not a child yet — the join cannot land.
      listChildren: listChildrenFrom({ [SHELL_PID]: [200001] }),
      readComm: readCommFrom({ 200001: 'bash' }),
      readStatus: readStatusFrom({}),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated
    })
    svc.launch({ cwd: '/p' })
    svc.correlateAgainst([session('sess-A', 664819)])
    expect(onCorrelated).not.toHaveBeenCalled()
  })

  it('a THROWING onCorrelated never escapes the per-delta loop (fail-closed) and the join still lands', () => {
    const set = createLaunchedSet()
    const log = vi.fn()
    const { manager } = fakeTerminalManager({ 't-1': SHELL_PID })
    const svc = createLaunchService({
      terminalManager: manager,
      launchedSet: set,
      spawn: { file: 'claude' },
      listChildren: listChildrenFrom({ [SHELL_PID]: [REAL_CLAUDE_TGID] }),
      readComm: readCommFrom({ [REAL_CLAUDE_TGID]: 'claude' }),
      readStatus: readStatusFrom({
        [REAL_CLAUDE_TGID]: statusLeader(REAL_CLAUDE_TGID),
        664819: statusThread(664819, REAL_CLAUDE_TGID)
      }),
      newTerminalId: () => 't-1',
      platform: 'linux',
      onCorrelated: () => {
        throw new Error('window destroyed')
      },
      log
    })
    svc.launch({ cwd: '/p' })
    expect(() => svc.correlateAgainst([session('sess-A', 664819)])).not.toThrow()
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
      readComm: readCommFrom({}),
      listChildren: listChildrenFrom({}),
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
