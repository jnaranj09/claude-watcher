// Story 4.1 — SM-3 = 0 orphans unit test + feed-stopped assertion.
//
// Proves the centralized teardown invariants via INJECTED fakes (NO real node-pty,
// NO real MessagePort, NO real feed — ban deep vi.mock — AR-11):
//
//   (a) For EVERY terminal, port.close() is called BEFORE pty.kill() — ordering.
//   (b) Teardown is IDEMPOTENT — a second call is a safe no-op (no double-kill throw).
//   (c) After teardown, terminalManager.has(id) is false for every prior id (0 orphans).
//   (d) A terminal that already exited (pty onExit fired) is NOT double-killed.
//   (e) Every live feed is stopped (feed.stop() is called on teardown).
//   (f) After teardown, clearTerminalOwners is called.
//
// The teardown ORDER is:
//   terminalManager.destroyAll() → clearTerminalOwners() → feed.stop() [voided]
//
// Mirrors terminalManager.test.ts's destroy-ordering assertion.
// [Source: story 4.1 Tasks 3; AC #1/#3/#5; SM-3; AR-11; FROZEN #2]

import { describe, it, expect, vi } from 'vitest'
import { createTerminalManager, type PortLike } from '../pty/terminalManager'
import type { IPtyLike, PtyFactory } from '../pty/ptyFactory'
import type { Feed } from '../c9watch/feed'
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

// ---------------------------------------------------------------------------
// Fake feed — spy on stop().
// ---------------------------------------------------------------------------
function makeFakeFeed(): { feed: Feed; stopCalled: () => boolean } {
  let stopped = false
  const feed: Feed = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(async () => {
      stopped = true
    }),
    whenReconnected: vi.fn().mockResolvedValue(undefined)
  }
  return { feed, stopCalled: () => stopped }
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
      terminalManager: mgr,
      feeds: [],
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
    const deps: TeardownDeps = { terminalManager: mgr, feeds: [], clearTerminalOwners: clearOwners }

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
    const deps: TeardownDeps = { terminalManager: mgr, feeds: [], clearTerminalOwners: clearOwners }
    expect(() => teardownAllSessions(deps)).not.toThrow()

    // pty.kill count must not have grown — no double-kill.
    const killsAfter = callLog.filter((e) => e === 'pty.kill:t1').length
    expect(killsAfter).toBe(killsBefore)
  })

  it('teardownAllSessions with null terminalManager is a safe no-op (handles pre-ready quit)', () => {
    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      terminalManager: null,
      feeds: [],
      clearTerminalOwners: clearOwners
    }
    expect(() => teardownAllSessions(deps)).not.toThrow()
    expect(clearOwners).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// (e) Feed is stopped on teardownAllSessions.
// ---------------------------------------------------------------------------
describe('teardownAllSessions — feed.stop() called on every live feed (AC #3)', () => {
  it('calls stop() on a single feed and the terminal manager tears down its terminals', async () => {
    const callLog: string[] = []
    const fakePty = makeFakePtyWithLog(callLog, 't1')
    const ptyFactory: PtyFactory = () => fakePty.pty
    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort(callLog, 't1'), 80, 24)

    const { feed, stopCalled } = makeFakeFeed()
    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      terminalManager: mgr,
      feeds: [feed],
      clearTerminalOwners: clearOwners
    }

    teardownAllSessions(deps)

    // Flush micro-task queue so the voided Promise's catch can settle.
    await Promise.resolve()

    expect(stopCalled()).toBe(true)
    expect(mgr.has('t1')).toBe(false)
  })

  it('calls stop() on MULTIPLE feeds — every feed is reaped', async () => {
    const feedA = makeFakeFeed()
    const feedB = makeFakeFeed()
    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      terminalManager: null,
      feeds: [feedA.feed, feedB.feed],
      clearTerminalOwners: clearOwners
    }

    teardownAllSessions(deps)
    await Promise.resolve()

    expect(feedA.stopCalled()).toBe(true)
    expect(feedB.stopCalled()).toBe(true)
  })

  it('a stop() error from one feed does not prevent the other feeds from being stopped', async () => {
    // Feed A throws; Feed B must still be stopped.
    const feedA: Feed = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockRejectedValue(new Error('boom')),
      whenReconnected: vi.fn().mockResolvedValue(undefined)
    }
    let feedBStopped = false
    const feedB: Feed = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(async () => {
        feedBStopped = true
      }),
      whenReconnected: vi.fn().mockResolvedValue(undefined)
    }

    const clearOwners = vi.fn()
    const deps: TeardownDeps = {
      terminalManager: null,
      feeds: [feedA, feedB],
      clearTerminalOwners: clearOwners
    }

    // Must not throw synchronously — errors are voided + caught asynchronously.
    expect(() => teardownAllSessions(deps)).not.toThrow()
    // Let the rejected Promise's catch handler run.
    await Promise.resolve()

    expect(feedBStopped).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (f) clearTerminalOwners is called.
// ---------------------------------------------------------------------------
describe('teardownAllSessions — clearTerminalOwners called after destroyAll (AC #3)', () => {
  it('clearTerminalOwners is invoked once per teardown call', () => {
    const clear = vi.fn()
    teardownAllSessions({ terminalManager: null, feeds: [], clearTerminalOwners: clear })
    expect(clear).toHaveBeenCalledTimes(1)
  })
})
