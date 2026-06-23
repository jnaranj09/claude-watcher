// Story 3.1 — the terminal manager tests (main-unit / node project).
//
// Inject a FAKE pty (the `ptyFactory` DI seam) + a FAKE port (`PortLike`) so NO real
// node-pty and NO real MessagePort load on the test path (AR-11: ban deep
// `vi.mock('node-pty')` — inject). Covers Task 1.3 + Task 3.3:
//   - spawn-once per terminalId (re-open of a live id is a no-op);
//   - destroy closes the port THEN kills the pty (assert ORDERING — architecture.md:554);
//   - a pty exit produces the dead-terminal signal (onExit fired once) + tears down;
//   - resize forwards cols/rows to the pty (main resizes FIRST);
//   - flow control: backlog crossing high water pauses the pty once; drain resumes once;
//     no pause under threshold; input → pty.write; ack → drain;
//   - a spawn failure degrades to onExit (never throws);
//   - never-log-the-value on the failure paths (code= only).
// [Source: story 3.1 Tasks 1/3; AR-11; .claude/rules/zod-boundaries.md; tray.test.ts style]
import { describe, it, expect, vi } from 'vitest'
import { createTerminalManager, type PortLike } from './terminalManager'
import type { IPtyLike, PtyFactory } from './ptyFactory'
import type {
  TerminalPortMainMessage,
  TerminalPortRendererMessage
} from '../../shared/ipc/contract'

/** A fake pty recording calls + exposing trigger hooks for data/exit. Implements IPtyLike. */
function makeFakePty(): {
  pty: IPtyLike
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  pauseCount: () => number
  resumeCount: () => number
  killed: () => boolean
} {
  let dataCb: ((data: string) => void) | null = null
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null
  const writes: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []
  let pauses = 0
  let resumes = 0
  let killed = false
  const pty: IPtyLike = {
    pid: 4242,
    onData: (cb) => {
      dataCb = cb
      return { dispose: () => (dataCb = null) }
    },
    onExit: (cb) => {
      exitCb = cb
      return { dispose: () => (exitCb = null) }
    },
    write: (data) => writes.push(data),
    resize: (cols, rows) => resizes.push({ cols, rows }),
    pause: () => {
      pauses++
    },
    resume: () => {
      resumes++
    },
    kill: () => {
      killed = true
    }
  }
  return {
    pty,
    emitData: (data) => dataCb?.(data),
    emitExit: (exitCode) => exitCb?.({ exitCode }),
    writes,
    resizes,
    pauseCount: () => pauses,
    resumeCount: () => resumes,
    killed: () => killed
  }
}

/** A fake main-end port recording posts + close, exposing a renderer-message trigger.
 *  `log` records the relative order of close/start so we can assert teardown ordering. */
function makeFakePort(order: string[]): {
  port: PortLike
  emitFromRenderer: (m: TerminalPortRendererMessage) => void
  posts: TerminalPortMainMessage[]
  closed: () => boolean
  started: () => boolean
} {
  let msgCb: ((m: TerminalPortRendererMessage) => void) | null = null
  const posts: TerminalPortMainMessage[] = []
  let closed = false
  let started = false
  const port: PortLike = {
    postMessage: (m) => posts.push(m),
    onMessage: (cb) => {
      msgCb = cb
    },
    start: () => {
      started = true
      order.push('port.start')
    },
    close: () => {
      closed = true
      order.push('port.close')
    }
  }
  return {
    port,
    emitFromRenderer: (m) => msgCb?.(m),
    posts,
    closed: () => closed,
    started: () => started
  }
}

const SPAWN_DEFAULTS = { file: '/bin/bash' }

describe('createTerminalManager — spawn-once + lifecycle (AC-1)', () => {
  it('spawns ONE pty per terminalId and RE-ATTACHes on a re-open of a live id (Story 5.6)', () => {
    let spawnCount = 0
    const fakePty = makeFakePty()
    const ptyFactory: PtyFactory = () => {
      spawnCount++
      return fakePty.pty
    }
    const order: string[] = []
    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })

    const portA = makeFakePort(order)
    mgr.open('t1', portA.port, 80, 24, undefined, 'tokA')
    expect(spawnCount).toBe(1)
    expect(mgr.has('t1')).toBe(true)

    // Re-open of the SAME live id — NO second spawn; instead re-attaches the new port.
    const portB = makeFakePort(order)
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB')
    expect(spawnCount).toBe(1) // still just 1 spawn
    expect(mgr.has('t1')).toBe(true) // terminal still live
    // The old port should have been closed (superseded by re-attach).
    expect(portA.closed()).toBe(true)
    // The new port should have been started.
    expect(portB.started()).toBe(true)

    // Output from the pty now goes to portB, not portA.
    fakePty.emitData('hello')
    expect(portB.posts.filter((p) => p.type === 'output')).toHaveLength(1)
    // portA receives nothing after re-attach (it was closed).
    expect(portA.posts.filter((p) => p.type === 'output')).toHaveLength(0)
  })

  it('forwards resize cols/rows to the pty (main resizes FIRST)', () => {
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24)
    mgr.resize('t1', 120, 40)
    expect(fakePty.resizes).toEqual([{ cols: 120, rows: 40 }])
  })

  it('resize on an unknown terminal is a no-op (never throws)', () => {
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    expect(() => mgr.resize('ghost', 100, 30)).not.toThrow()
    expect(fakePty.resizes).toEqual([])
  })
})

describe('createTerminalManager — destroy ordering: port.close() THEN pty.kill() (AC, architecture.md:554)', () => {
  it('stop() closes the port BEFORE killing the pty', () => {
    const order: string[] = []
    const fakePty = makeFakePty()
    // Record the kill relative to the port.close in the SAME order array.
    const killTrackingPty: IPtyLike = { ...fakePty.pty, kill: () => order.push('pty.kill') }
    const fakePort = makeFakePort(order)
    const mgr = createTerminalManager({
      ptyFactory: () => killTrackingPty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })

    mgr.open('t1', fakePort.port, 80, 24)
    mgr.stop('t1')

    expect(fakePort.closed()).toBe(true)
    const closeIdx = order.indexOf('port.close')
    const killIdx = order.indexOf('pty.kill')
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(killIdx).toBeGreaterThanOrEqual(0)
    expect(closeIdx).toBeLessThan(killIdx) // close BEFORE kill
    expect(mgr.has('t1')).toBe(false)
  })

  it('stop() is idempotent and does NOT fire onExit (renderer-initiated)', () => {
    const onExit = vi.fn()
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24)
    mgr.stop('t1')
    mgr.stop('t1') // idempotent
    expect(onExit).not.toHaveBeenCalled()
  })

  it('destroyAll() tears down every live terminal', () => {
    const ptys = [makeFakePty(), makeFakePty()]
    let i = 0
    const mgr = createTerminalManager({
      ptyFactory: () => ptys[i++]!.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('a', makeFakePort([]).port, 80, 24)
    mgr.open('b', makeFakePort([]).port, 80, 24)
    mgr.destroyAll()
    expect(mgr.has('a')).toBe(false)
    expect(mgr.has('b')).toBe(false)
    expect(ptys[0]!.killed()).toBe(true)
    expect(ptys[1]!.killed()).toBe(true)
  })
})

describe('createTerminalManager — dead terminal: a pty exit signals onExit (AC-4)', () => {
  it('a pty exit fires onExit(terminalId, exitCode) ONCE and tears down (one dying pty)', () => {
    const onExit = vi.fn()
    const fakePty = makeFakePty()
    const fakePort = makeFakePort([])
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit
    })
    mgr.open('t1', fakePort.port, 80, 24)

    fakePty.emitExit(137)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledWith('t1', 137)
    // The terminal is gone (torn down) and the port was closed.
    expect(mgr.has('t1')).toBe(false)
    expect(fakePort.closed()).toBe(true)
    // The exit was also pushed in-band over the port.
    expect(fakePort.posts).toContainEqual({ type: 'exit', exitCode: 137 })
  })

  it('a spawn failure degrades to onExit(terminalId, 1) and NEVER throws (never-crash)', () => {
    const onExit = vi.fn()
    const log = vi.fn()
    const fakePort = makeFakePort([])
    const mgr = createTerminalManager({
      ptyFactory: () => {
        throw new Error('spawn boom')
      },
      spawnDefaults: SPAWN_DEFAULTS,
      onExit,
      log
    })
    expect(() => mgr.open('t1', fakePort.port, 80, 24)).not.toThrow()
    expect(onExit).toHaveBeenCalledWith('t1', 1)
    // The port was closed (no dangling transferred port) and the terminal is not live.
    expect(fakePort.closed()).toBe(true)
    expect(mgr.has('t1')).toBe(false)
    // never-log-the-value: a code= only, no spawn-error message detail.
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('code=pty_spawn_failed')
    expect(logged).not.toContain('boom')
  })
})

describe('createTerminalManager — flow control over the port (AC-1; Task 3.3)', () => {
  it('output backlog crossing high water pauses the pty once; drain resumes it once', () => {
    const fakePty = makeFakePty()
    const fakePort = makeFakePort([])
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      flowControl: { highWater: 3, lowWater: 1 },
      onExit: vi.fn()
    })
    mgr.open('t1', fakePort.port, 80, 24)

    // 3 unacked output chunks → pause once.
    fakePty.emitData('a')
    fakePty.emitData('b')
    expect(fakePty.pauseCount()).toBe(0)
    fakePty.emitData('c')
    expect(fakePty.pauseCount()).toBe(1)
    // The output was posted over the port.
    expect(fakePort.posts.filter((p) => p.type === 'output')).toHaveLength(3)

    // Renderer ACKs drain the backlog → resume once at low water.
    fakePort.emitFromRenderer({ type: 'ack' })
    expect(fakePty.resumeCount()).toBe(0)
    fakePort.emitFromRenderer({ type: 'ack' }) // backlog 1 → resume
    expect(fakePty.resumeCount()).toBe(1)
  })

  it('no pause when the backlog stays under threshold', () => {
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      flowControl: { highWater: 100, lowWater: 20 },
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24)
    for (let i = 0; i < 50; i++) fakePty.emitData('x')
    expect(fakePty.pauseCount()).toBe(0)
  })

  it('renderer input is written to the pty; ack drains (no write)', () => {
    const fakePty = makeFakePty()
    const fakePort = makeFakePort([])
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', fakePort.port, 80, 24)

    fakePort.emitFromRenderer({ type: 'input', data: 'ls\n' })
    expect(fakePty.writes).toEqual(['ls\n'])
    // An ack is NOT written to the pty.
    fakePort.emitFromRenderer({ type: 'ack' })
    expect(fakePty.writes).toEqual(['ls\n'])
  })

  it('DROPS a malformed port message (no silent fall-through to ack) — code-review M-1', () => {
    const fakePty = makeFakePty()
    const fakePort = makeFakePort([])
    const log = vi.fn()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      flowControl: { highWater: 3, lowWater: 1 },
      onExit: vi.fn(),
      log
    })
    mgr.open('t1', fakePort.port, 80, 24)
    // Build a backlog so a stray "ack" would visibly drain it.
    fakePty.emitData('a')
    fakePty.emitData('b')

    // A message with an UNKNOWN type must NOT fall through to the ack branch (which would drain
    // flow control). It is dropped + logged by path/code only.
    fakePort.emitFromRenderer({ type: 'bogus' } as unknown as { type: 'ack' })
    // An `input` missing its `data` is also malformed → dropped (NOT written to the pty).
    fakePort.emitFromRenderer({ type: 'input' } as unknown as { type: 'input'; data: string })

    expect(fakePty.writes).toEqual([]) // nothing written
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('dropped port message')
    expect(logged).toContain('code=')
    // never-log-the-value: the bogus payload's field names/values do not leak.
    expect(logged).not.toContain('bogus')
  })

  it('starts the port (Electron MessagePortMain needs an explicit start)', () => {
    const fakePty = makeFakePty()
    const fakePort = makeFakePort([])
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', fakePort.port, 80, 24)
    expect(fakePort.started()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Story 5.6 — re-attach + token-aware stop (the StrictMode double-mount fix).
// ─────────────────────────────────────────────────────────────────────────────
describe('createTerminalManager — Story 5.6 re-attach + token-aware stop', () => {
  it('re-attach: open(tokA) → open(tokB) wires portB to the SAME live pty, closes portA', () => {
    const fakePty = makeFakePty()
    const onExit = vi.fn()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit
    })

    const portA = makeFakePort([])
    const portB = makeFakePort([])
    mgr.open('t1', portA.port, 80, 24, undefined, 'tokA')
    // Re-open same id with a new port + token (StrictMode double-mount).
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB')

    // Only ONE spawn ever happened.
    expect(mgr.has('t1')).toBe(true)

    // Old port closed; new port started.
    expect(portA.closed()).toBe(true)
    expect(portB.started()).toBe(true)

    // The PTY is still live (no kill, no onExit fired).
    expect(fakePty.killed()).toBe(false)
    expect(onExit).not.toHaveBeenCalled()

    // pty output now routes to portB.
    fakePty.emitData('x')
    expect(portB.posts.filter((p) => p.type === 'output')).toHaveLength(1)
    // portA gets nothing after re-attach.
    expect(portA.posts.filter((p) => p.type === 'output')).toHaveLength(0)

    // Input from portB is written to the pty.
    portB.emitFromRenderer({ type: 'input', data: 'ls\n' })
    expect(fakePty.writes).toEqual(['ls\n'])
  })

  it('stale stop(tokA) after open(tokB) is a NO-OP — PTY stays alive, portB still wired', () => {
    const fakePty = makeFakePty()
    const onExit = vi.fn()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit
    })

    const portA = makeFakePort([])
    const portB = makeFakePort([])
    mgr.open('t1', portA.port, 80, 24, undefined, 'tokA')
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB') // re-attach, stored token → tokB

    // StrictMode transient cleanup-stop for mount1 (stale token tokA).
    mgr.stop('t1', 'tokA') // STALE → NO-OP

    // PTY must still be alive.
    expect(fakePty.killed()).toBe(false)
    expect(mgr.has('t1')).toBe(true)
    expect(onExit).not.toHaveBeenCalled()

    // portB still wired: output still arrives.
    fakePty.emitData('still alive')
    expect(portB.posts.filter((p) => p.type === 'output')).toHaveLength(1)

    // Now the real stop (matching token) kills the terminal.
    mgr.stop('t1', 'tokB') // matches → kill
    expect(fakePty.killed()).toBe(true)
    expect(mgr.has('t1')).toBe(false)
  })

  it('full StrictMode ordering: open(tokA) → open(tokB) re-attach → stop(tokA) stale NO-OP → stop(tokB) kills', () => {
    const fakePty = makeFakePty()
    const onExit = vi.fn()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit
    })
    const portA = makeFakePort([])
    const portB = makeFakePort([])
    mgr.open('t1', portA.port, 80, 24, undefined, 'tokA')
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB')
    mgr.stop('t1', 'tokA') // stale — no-op

    expect(mgr.has('t1')).toBe(true)
    expect(fakePty.killed()).toBe(false)

    // Explicit user stop (no token = force kill).
    mgr.stop('t1')
    expect(mgr.has('t1')).toBe(false)
    expect(fakePty.killed()).toBe(true)
  })

  it('FIFO ordering still works: open(tokA) → stop(tokA) matching → kills → open(tokB) fresh spawn', () => {
    let spawnCount = 0
    const ptys = [makeFakePty(), makeFakePty()]
    let i = 0
    const ptyFactory: PtyFactory = () => {
      spawnCount++
      return ptys[i++]!.pty
    }
    const onExit = vi.fn()
    const mgr = createTerminalManager({ ptyFactory, spawnDefaults: SPAWN_DEFAULTS, onExit })

    const portA = makeFakePort([])
    mgr.open('t1', portA.port, 80, 24, undefined, 'tokA')
    expect(spawnCount).toBe(1)

    // Matching stop kills terminal #1.
    mgr.stop('t1', 'tokA')
    expect(mgr.has('t1')).toBe(false)
    expect(ptys[0]!.killed()).toBe(true)

    // Second open mints a fresh pty (terminal #1 is gone).
    const portB = makeFakePort([])
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB')
    expect(spawnCount).toBe(2) // fresh spawn
    expect(mgr.has('t1')).toBe(true)
  })

  it('tokenless stop() is always an unconditional kill (user-initiated / quit path)', () => {
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24, undefined, 'tokA')
    // No token → unconditional kill regardless of stored token.
    mgr.stop('t1')
    expect(fakePty.killed()).toBe(true)
    expect(mgr.has('t1')).toBe(false)
  })

  // ── FAULT-INJECTION GUARDS (must go RED when the guard is removed) ──────────
  it('FAULT-INJECTION: removing the stale-token check makes stop(tokA) kill the PTY — guard is load-bearing', () => {
    // This test passes a stale token and ASSERTS the PTY is NOT killed.
    // If the stale-token guard were removed the PTY would be killed → this test would go RED.
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24, undefined, 'tokA')
    mgr.open('t1', makeFakePort([]).port, 80, 24, undefined, 'tokB') // re-attach, stored → tokB
    mgr.stop('t1', 'tokA') // stale

    // Guard assertion: PTY must still be alive (if guard is absent, this is false → RED).
    expect(fakePty.killed()).toBe(false)
    expect(mgr.has('t1')).toBe(true)
  })

  it('FAULT-INJECTION: removing re-attach makes the new port dead (old NO-OP path) — guard is load-bearing', () => {
    // Without re-attach, open() on a live id is a no-op: portB is never started.
    // With re-attach, portB IS started. This test asserts portB.started() is true.
    // Removing re-attach → portB.started() is false → RED.
    const fakePty = makeFakePty()
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    mgr.open('t1', makeFakePort([]).port, 80, 24, undefined, 'tokA')
    const portB = makeFakePort([])
    mgr.open('t1', portB.port, 80, 24, undefined, 'tokB')

    // Guard assertion: portB must be started (if no re-attach, it never is → RED).
    expect(portB.started()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Story 3.2 (FR-11) — pidOf (the correlation walk input) + the spawn override (raw claude).
// ─────────────────────────────────────────────────────────────────────────────
describe('createTerminalManager — Story 3.2 pidOf + spawnOverride', () => {
  it('pidOf returns the spawned pty shell-leader pid for a live terminal, null when unknown/gone', () => {
    const fakePty = makeFakePty() // pid 4242
    const mgr = createTerminalManager({
      ptyFactory: () => fakePty.pty,
      spawnDefaults: SPAWN_DEFAULTS,
      onExit: vi.fn()
    })
    // Unknown terminal → null.
    expect(mgr.pidOf('t1')).toBeNull()
    mgr.open('t1', makeFakePort([]).port, 80, 24)
    expect(mgr.pidOf('t1')).toBe(4242)
    // After stop, the terminal is destroyed → null.
    mgr.stop('t1')
    expect(mgr.pidOf('t1')).toBeNull()
  })

  it('spawnOverride overrides file/cwd for THIS open (raw claude launch) without touching defaults', () => {
    const spawned: Array<{ file: string; cwd?: string; args?: string[] }> = []
    const fakePty = makeFakePty()
    const ptyFactory: PtyFactory = (opts) => {
      spawned.push({
        file: opts.file,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.args ? { args: opts.args } : {})
      })
      return fakePty.pty
    }
    const mgr = createTerminalManager({
      ptyFactory,
      spawnDefaults: { file: '/bin/bash', cwd: '/home/op' },
      onExit: vi.fn()
    })
    // No override → the Story-3.1 shell spawn (defaults), unchanged.
    mgr.open('shell', makeFakePort([]).port, 80, 24)
    // Override → raw claude in the picked cwd (the FR-11 launch).
    mgr.open('launch', makeFakePort([]).port, 80, 24, {
      file: '/bin/bash',
      args: ['-l', '-c', 'claude'],
      cwd: '/home/op/proj'
    })
    expect(spawned[0]).toEqual({ file: '/bin/bash', cwd: '/home/op' })
    expect(spawned[1]).toEqual({
      file: '/bin/bash',
      args: ['-l', '-c', 'claude'],
      cwd: '/home/op/proj'
    })
  })
})
