// Story 4.1 — SM-3 = 0 orphans unit test.
// Story 6.4 — the feed-stopped assertions died with the c9watch feed (there is no
// long-lived watch child to reap anymore; the hook listener closes per-window in
// index.ts, not on this quit path).
//
// Proves the centralized teardown invariants via INJECTED fakes (NO real node-pty,
// NO real MessagePort — ban deep vi.mock — AR-11):
//
//   (a) For EVERY terminal, port.close() is called BEFORE pty.kill() — ordering.
//   (b) Teardown is IDEMPOTENT — a second call is a safe no-op (no double-kill throw).
//   (c) After teardown, terminalManager.has(id) is false for every prior id (0 orphans).
//   (d) A terminal that already exited (pty onExit fired) is NOT double-killed.
//   (e) After teardown, clearTerminalOwners is called.
//   (f) Past sessions (D-3): every live session is archived FIRST, and a failing archive never
//       stops the teardown.
//
// The teardown ORDER is:
//   archiveLiveSessions() → terminalManager.destroyAll() → clearTerminalOwners()
//
// Mirrors terminalManager.test.ts's destroy-ordering assertion.
// [Source: story 4.1 Tasks 3; AC #1/#3/#5; SM-3; AR-11; FROZEN #2]

import { describe, it, expect, vi } from 'vitest'
import { createTerminalManager, type PortLike } from '../pty/terminalManager'
import type { IPtyLike, PtyFactory } from '../pty/ptyFactory'
import { teardownAllSessions, type TeardownDeps } from './teardownAllSessions'
import type { TerminalPortRendererMessage } from '../../shared/ipc/contract'

// ---------------------------------------------------------------------------
// Fake pty — records calls + exposes trigger hooks (no real node-pty, AR-11).
// ---------------------------------------------------------------------------
function makeFakePty(): {
  pty: IPtyLike
  emitExit: (exitCode: number) => void
  killed: () => boolean
} {
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null
  let killed = false
  const pty: IPtyLike = {
    pid: 9001,
    onData: () => ({ dispose: () => {} }),
    onExit: (cb) => {
      exitCb = cb
      return { dispose: () => (exitCb = null) }
    },
    write: () => {},
    resize: () => {},
    pause: () => {},
    resume: () => {},
    kill: () => {
      killed = true
    }
  }
  return {
    pty,
    emitExit: (exitCode) => exitCb?.({ exitCode }),
    killed: () => killed
  }
}

// ---------------------------------------------------------------------------
// Fake port — captures call order (port.close vs pty.kill) via the shared log.
// ---------------------------------------------------------------------------
function makeFakePort(callLog: string[], portId: string): PortLike {
  let msgCb: ((m: TerminalPortRendererMessage) => void) | null = null
  return {
    postMessage: () => {},
    onMessage: (cb) => {
      msgCb = cb
      void msgCb // prevent unused-var lint (msgCb is stored for interface compliance)
    },
    start: () => {},
    close: () => {
      callLog.push(`port.close:${portId}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Wrap makeFakePty so we can capture kill AFTER the port close.
// ---------------------------------------------------------------------------
function makeFakePtyWithLog(callLog: string[], ptyId: string): ReturnType<typeof makeFakePty> {
  const base = makeFakePty()
  const origKill = base.pty.kill.bind(base.pty)
  ;(base.pty as { kill: () => void }).kill = () => {
    callLog.push(`pty.kill:${ptyId}`)
    origKill()
  }
  return base
}

const SPAWN_DEFAULTS = { file: '/bin/bash' }

// ---------------------------------------------------------------------------
// (a) + (c) Core SM-3 invariant: port.close BEFORE pty.kill, 0 orphans after.
// ---------------------------------------------------------------------------
describe('teardownAllSessions — SM-3 = 0 orphans (AC #1/#3/#5)', () => {
  it('tears down N terminals: port.close() BEFORE pty.kill() for every terminal, 0 live after', () => {
    const callLog: string[] = []
    const ptys = [
      makeFakePtyWithLog(callLog, 't1'),
      makeFakePtyWithLog(callLog, 't2'),
      makeFakePtyWithLog(callLog, 't3')
    ]
    let ptyIdx = 0
    const ptyFactory: PtyFactory = () => {
      const p = ptys[ptyIdx++]
      if (!p) throw new Error('unexpected spawn')
      return p.pty
    }

    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })

    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)
    mgr.open('t2', makeFakePort(callLog, 't2'), 80, 24)
    mgr.open('t3', makeFakePort(callLog, 't3'), 80, 24)

    expect(mgr.has('t1')).toBe(true)
    expect(mgr.has('t2')).toBe(true)
    expect(mgr.has('t3')).toBe(true)

    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      archiveLiveSessions: vi.fn(),
      terminalManager: mgr,
      clearTerminalOwners: clearOwners
    }

    teardownAllSessions(deps)

    // (c) 0 live terminals after — SM-3
    expect(mgr.has('t1')).toBe(false)
    expect(mgr.has('t2')).toBe(false)
    expect(mgr.has('t3')).toBe(false)

    // (a) port.close() precedes pty.kill() FOR EACH terminal
    // The log contains interleaved entries; for each terminal its close must come before its kill.
    for (const id of ['t1', 't2', 't3']) {
      const closeIdx = callLog.indexOf(`port.close:${id}`)
      const killIdx = callLog.indexOf(`pty.kill:${id}`)
      expect(closeIdx).toBeGreaterThanOrEqual(0)
      expect(killIdx).toBeGreaterThanOrEqual(0)
      expect(closeIdx).toBeLessThan(killIdx)
    }

    // clearTerminalOwners must have been called
    expect(clearOwners).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — a second teardownAllSessions call is a safe no-op (no double-kill throw)', () => {
    const callLog: string[] = []
    const fakePty = makeFakePtyWithLog(callLog, 't1')
    const ptyFactory: PtyFactory = () => fakePty.pty

    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)

    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      archiveLiveSessions: vi.fn(),
      terminalManager: mgr,
      clearTerminalOwners: clearOwners
    }

    // First call tears everything down.
    expect(() => teardownAllSessions(deps)).not.toThrow()
    expect(mgr.has('t1')).toBe(false)

    // Second call is a no-op — the manager guards double-teardown.
    expect(() => teardownAllSessions(deps)).not.toThrow()
    expect(mgr.has('t1')).toBe(false)

    // pty.kill was logged exactly once despite two teardown calls.
    const killEntries = callLog.filter((e) => e === 'pty.kill:t1')
    expect(killEntries).toHaveLength(1)
  })

  it('a terminal that already exited (pty onExit fired) is NOT double-killed by teardownAllSessions', () => {
    const callLog: string[] = []
    const fakePty = makeFakePtyWithLog(callLog, 't1')
    const onExit = vi.fn()
    const ptyFactory: PtyFactory = () => fakePty.pty

    const mgr = createTerminalManager({ ptyFactory, spawnDefaults: SPAWN_DEFAULTS, onExit })
    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)

    // Simulate the PTY exiting naturally (onExit fires → manager tears it down internally).
    fakePty.emitExit(0)
    expect(mgr.has('t1')).toBe(false) // already removed by natural exit

    const killsBefore = callLog.filter((e) => e === 'pty.kill:t1').length

    // Now run teardownAllSessions — 't1' is no longer in the manager, so nothing new fires.
    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      archiveLiveSessions: vi.fn(),
      terminalManager: mgr,
      clearTerminalOwners: clearOwners
    }
    expect(() => teardownAllSessions(deps)).not.toThrow()

    // pty.kill count must not have grown — no double-kill.
    const killsAfter = callLog.filter((e) => e === 'pty.kill:t1').length
    expect(killsAfter).toBe(killsBefore)
  })

  it('teardownAllSessions with null terminalManager is a safe no-op (handles pre-ready quit)', () => {
    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      archiveLiveSessions: vi.fn(),
      terminalManager: null,
      clearTerminalOwners: clearOwners
    }
    expect(() => teardownAllSessions(deps)).not.toThrow()
    expect(clearOwners).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// (e) clearTerminalOwners is called.
// ---------------------------------------------------------------------------
describe('teardownAllSessions — clearTerminalOwners called after destroyAll (AC #3)', () => {
  it('clearTerminalOwners is invoked once per teardown call', () => {
    const clear = vi.fn()
    teardownAllSessions({
      archiveLiveSessions: vi.fn(),
      terminalManager: null,
      clearTerminalOwners: clear
    })
    expect(clear).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// (f) Past sessions (D-3) — a quit is a pty exit the operator caused, so every live session is
// ARCHIVED. destroyAll() disposes each exit listener before the kill (no onExit, so the pty-exit
// archive never runs), so the archive must come FIRST — while the ptys are live, the reducer still
// holds the cards and terminalOwners still routes each terminal to its window's seam.
// ---------------------------------------------------------------------------
describe('teardownAllSessions — past sessions: archive BEFORE the ptys go (D-3)', () => {
  it('archives first, while every terminal is still live, then kills, then clears the owners', () => {
    const callLog: string[] = []
    const fakePty = makeFakePtyWithLog(callLog, 't1')
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)
    let liveWhenArchived: boolean | null = null

    teardownAllSessions({
      archiveLiveSessions: () => {
        liveWhenArchived = mgr.has('t1')
        callLog.push('archive')
      },
      terminalManager: mgr,
      clearTerminalOwners: () => callLog.push('clear-owners')
    })

    expect(liveWhenArchived).toBe(true)
    expect(callLog).toEqual(['archive', 'port.close:t1', 'pty.kill:t1', 'clear-owners'])
  })

  it('a throwing archive never stops the quit: the ptys still die, the owners still clear, a code is logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const callLog: string[] = []
    const fakePty = makeFakePtyWithLog(callLog, 't1')
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)
    const clear = vi.fn()

    expect(() =>
      teardownAllSessions({
        archiveLiveSessions: () => {
          throw new Error('/home/op/secret disk full')
        },
        terminalManager: mgr,
        clearTerminalOwners: clear
      })
    ).not.toThrow()

    expect(mgr.has('t1')).toBe(false)
    expect(callLog).toContain('pty.kill:t1')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[claude-watcher][quit] code=quit_archive_failed')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('/home/op')
    warn.mockRestore()
  })
})
