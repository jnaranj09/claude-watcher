// Story 4.1 — feed ⊥ terminals independence test (AC #4, FROZEN #3).
//
// Proves: a `c9watch watch` reconnect (child exit → drain → restart → list → diff)
// NEVER calls into terminal teardown. The feed registry (`feeds`) and the terminal
// registry (`terminalManager`) are independent. A reconnect leaves every owned
// terminal `has()`-live and every PTY untouched.
//
// Approach: open N terminals on a real `createTerminalManager` (fake ptys/ports — no
// real node-pty; AR-11). Start a real feed with a fake `spawnFn` + fake `listFn`.
// Drive a full reconnect (fake child exit → await whenReconnected). Assert no
// `stop`/`destroyAll`/`port.close`/`pty.kill` fires and all terminals stay `has()`-live.
//
// This pins the invariant as a non-vacuous regression guard: the registries are already
// separate in index.ts:104-110/:127-131, but the test makes the property testable.
//
// [Source: story 4.1 Task 4; AC #4; FROZEN #3; feed.ts:15 comment; architecture.md:568;
//  index.ts:104-110/:127-131; AR-11 (ban deep vi.mock('node-pty') — inject)]

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createFeed, type SpawnFn, type SpawnedChild } from './feed'
import { createTerminalManager, type PortLike } from '../pty/terminalManager'
import type { IPtyLike, PtyFactory } from '../pty/ptyFactory'
import type { TerminalPortRendererMessage } from '../../shared/ipc/contract'
import { createReducer } from './reducer'
import { fakeListSnapshot } from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

// ---------------------------------------------------------------------------
// Minimal fake child for the feed's watch stream.
// ---------------------------------------------------------------------------
class FakeWatchChild extends EventEmitter implements SpawnedChild {
  stdout = new EventEmitter()
  kill = vi.fn((): boolean => true)
  exit(code = 0): void {
    this.emit('exit', code, null)
  }
}

// ---------------------------------------------------------------------------
// Fake PTY — records kill calls (no real node-pty, AR-11).
// ---------------------------------------------------------------------------
function makeFakePty(killLog: string[], id: string): IPtyLike {
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null
  return {
    pid: 1234,
    onData: () => ({ dispose: () => {} }),
    onExit: (cb) => {
      exitCb = cb
      void exitCb // suppress unused-var lint
      return { dispose: () => {} }
    },
    write: () => {},
    resize: () => {},
    pause: () => {},
    resume: () => {},
    kill: () => {
      killLog.push(`pty.kill:${id}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Fake port — records close calls.
// ---------------------------------------------------------------------------
function makeFakePort(closeLog: string[], id: string): PortLike {
  let msgCb: ((m: TerminalPortRendererMessage) => void) | null = null
  return {
    postMessage: () => {},
    onMessage: (cb) => {
      msgCb = cb
      void msgCb // stored for interface compliance
    },
    start: () => {},
    close: () => {
      closeLog.push(`port.close:${id}`)
    }
  }
}

const SPAWN_DEFAULTS = { file: '/bin/bash' }

describe('feed ⊥ terminals — a watch reconnect NEVER touches terminal teardown (AC #4)', () => {
  it('drives a full reconnect; all N terminals stay has()-live and no port.close/pty.kill fires', async () => {
    const killLog: string[] = []
    const closeLog: string[] = []

    // Build terminal manager with 3 fake terminals (no real node-pty).
    const ptyIds = ['t1', 't2', 't3']
    let ptyIdx = 0
    const ptyFactory: PtyFactory = () => {
      const id = ptyIds[ptyIdx++]
      if (!id) throw new Error('unexpected spawn')
      return makeFakePty(killLog, id)
    }

    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })

    for (const id of ptyIds) {
      mgr.open(id, makeFakePort(closeLog, id), 80, 24)
    }

    // All terminals alive before reconnect.
    expect(mgr.has('t1')).toBe(true)
    expect(mgr.has('t2')).toBe(true)
    expect(mgr.has('t3')).toBe(true)

    // Build a feed with injected fake spawn + list (NOT connected to the terminal manager).
    const children: FakeWatchChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeWatchChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      now: () => FIXED_NOW
    })

    await feed.start()

    // Snapshot kill/close log before reconnect.
    const killsBefore = killLog.length
    const closesBefore = closeLog.length

    // Drive a full reconnect: the first child exits → feed reconnects.
    children[0]?.exit(1)
    await feed.whenReconnected()

    // After reconnect: all terminals STILL alive.
    expect(mgr.has('t1')).toBe(true)
    expect(mgr.has('t2')).toBe(true)
    expect(mgr.has('t3')).toBe(true)

    // No port.close or pty.kill fired during the reconnect.
    expect(killLog.length).toBe(killsBefore)
    expect(closeLog.length).toBe(closesBefore)

    await feed.stop()

    // Cleanup: terminals are still live even after feed.stop() — the feed never
    // touches them. A subsequent teardownAllSessions would tear them down.
    expect(mgr.has('t1')).toBe(true)
    expect(mgr.has('t2')).toBe(true)
    expect(mgr.has('t3')).toBe(true)
  })

  it('a SECOND reconnect (two consecutive child exits) also leaves all terminals live', async () => {
    const killLog: string[] = []
    const closeLog: string[] = []

    const ptyIds = ['t1', 't2']
    let ptyIdx = 0
    const ptyFactory: PtyFactory = () => {
      const id = ptyIds[ptyIdx++]
      if (!id) throw new Error('unexpected spawn')
      return makeFakePty(killLog, id)
    }

    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    for (const id of ptyIds) {
      mgr.open(id, makeFakePort(closeLog, id), 80, 24)
    }

    const children: FakeWatchChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeWatchChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      now: () => FIXED_NOW
    })

    await feed.start()

    // First reconnect.
    children[0]?.exit(1)
    await feed.whenReconnected()
    expect(killLog.length).toBe(0)
    expect(closeLog.length).toBe(0)

    // Second reconnect.
    const secondChild = children[children.length - 1]
    secondChild?.exit(2)
    await feed.whenReconnected()

    expect(mgr.has('t1')).toBe(true)
    expect(mgr.has('t2')).toBe(true)
    expect(killLog.length).toBe(0)
    expect(closeLog.length).toBe(0)

    await feed.stop()
  })
})
