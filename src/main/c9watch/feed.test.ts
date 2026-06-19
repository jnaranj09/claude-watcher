// Story 1.1 — feed.ts tests (main-unit / node).
//
// Drives the feed entirely through INJECTED seams (spawnFn + listFn) — NO live
// claude, NO deep vi.mock('child_process'). Covers: NDJSON line-split with a
// partial trailing fragment held across chunks; one bad line dropped (stream
// survives); and auto-reconnect on child exit (drain → restart → list → diff)
// with no transition dropped across the gap. [Source: story 1.1 Tasks 1/4/6;
// architecture.md#Process Patterns / #Testing & Test Seams]
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createFeed, type SpawnFn, type SpawnedChild } from './feed'
import { createReducer, type SessionDelta } from './reducer'
import { fakeListSnapshot } from '../../__fixtures__/fakeC9watchFeed'

const FIXED_NOW = 1_750_000_000_000

/** A minimal fake child: an EventEmitter with a stdout EventEmitter + a kill spy. */
class FakeChild extends EventEmitter implements SpawnedChild {
  stdout = new EventEmitter()
  killed = false
  kill = vi.fn((): boolean => {
    this.killed = true
    return true
  })
  /** Push a raw stdout chunk (as the OS pipe would deliver it). */
  emitChunk(chunk: string): void {
    this.stdout.emit('data', Buffer.from(chunk, 'utf8'))
  }
  /** Push a raw Buffer slice — to simulate a multibyte codepoint split across the
   *  OS pipe boundary (the per-chunk-decode corruption case). */
  emitBytes(buf: Buffer): void {
    this.stdout.emit('data', buf)
  }
  /** Simulate the watch child exiting. */
  exit(code = 0): void {
    this.emit('exit', code, null)
  }
}

function startedLine(id: string): string {
  return JSON.stringify({
    event: 'started',
    sessionId: id,
    timestamp: '2026-06-18T23:57:10.134+00:00',
    session: {
      id,
      status: 'Working',
      projectPath: '/home/u/projects/x',
      pid: 1,
      sessionName: 'x'
    }
  })
}

describe('feed — NDJSON line splitting', () => {
  it('splits complete lines and HOLDS a partial trailing fragment until the next chunk completes it', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = vi.fn(() => child)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const applied: SessionDelta[] = []

    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: (d) => applied.push(d),
      now: () => FIXED_NOW
    })
    await feed.start()

    const a = startedLine('aaaa0000-0000-4000-8000-000000000001')
    const b = startedLine('bbbb0000-0000-4000-8000-000000000002')

    // Deliver: full line A + newline, then the FIRST HALF of B (no newline yet).
    child.emitChunk(a + '\n' + b.slice(0, 20))
    expect(reducer.snapshotMap().has('aaaa0000-0000-4000-8000-000000000001')).toBe(true)
    // B is NOT yet applied — its line is incomplete (fragment held in the buffer).
    expect(reducer.snapshotMap().has('bbbb0000-0000-4000-8000-000000000002')).toBe(false)

    // Deliver the REST of B + newline → the fragment is completed and applied.
    child.emitChunk(b.slice(20) + '\n')
    expect(reducer.snapshotMap().has('bbbb0000-0000-4000-8000-000000000002')).toBe(true)

    await feed.stop()
  })

  it('a multibyte UTF-8 codepoint split across two chunks is decoded intact (not corrupted)', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = vi.fn(() => child)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      now: () => FIXED_NOW
    })
    await feed.start()

    // A started line whose sessionName carries an emoji (😀 = F0 9F 98 80, 4 bytes).
    const id = 'utf80000-0000-4000-8000-000000000001'
    const line =
      JSON.stringify({
        event: 'started',
        sessionId: id,
        timestamp: '2026-06-18T23:57:10.134+00:00',
        session: { id, status: 'Working', projectPath: '/x', pid: 1, sessionName: 'hi 😀 there' }
      }) + '\n'
    const buf = Buffer.from(line, 'utf8')
    const emojiAt = buf.indexOf(0xf0)
    // Split the chunk boundary INSIDE the 4-byte emoji (after its first 2 bytes).
    child.emitBytes(buf.subarray(0, emojiAt + 2))
    child.emitBytes(buf.subarray(emojiAt + 2))

    const session = reducer.snapshotMap().get(id)
    expect(session).toBeDefined()
    // The split codepoint must survive intact — a naive per-chunk decode would
    // corrupt it to U+FFFD replacement chars.
    expect(session?.sessionName).toBe('hi 😀 there')
    await feed.stop()
  })

  it('a malformed line between two good lines is dropped; the stream survives', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = vi.fn(() => child)
    const log = vi.fn<(err: { path: string; code: string }) => void>()
    const reducer = createReducer({ now: () => FIXED_NOW, log })

    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      now: () => FIXED_NOW
    })
    await feed.start()

    const good1 = startedLine('11110000-0000-4000-8000-000000000001')
    const good2 = startedLine('22220000-0000-4000-8000-000000000002')
    child.emitChunk(good1 + '\n' + '{"event":"changed","trunc' + '\n' + good2 + '\n')

    expect(reducer.snapshotMap().has('11110000-0000-4000-8000-000000000001')).toBe(true)
    expect(reducer.snapshotMap().has('22220000-0000-4000-8000-000000000002')).toBe(true)
    expect(log).toHaveBeenCalledTimes(1) // exactly the one bad line
    await feed.stop()
  })

  it('attaches an error handler to the child + stdout (never-crash: an error does not throw)', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = vi.fn(() => child)
    const reducer = createReducer({ now: () => FIXED_NOW })
    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      now: () => FIXED_NOW
    })
    await feed.start()
    // An 'error' on the child or its stdout must be HANDLED (not an unhandled throw).
    expect(() => child.emit('error', new Error('boom'))).not.toThrow()
    expect(() => child.stdout.emit('error', new Error('pipe'))).not.toThrow()
    await feed.stop()
  })
})

describe('feed — auto-reconnect (drain → restart → list → diff), no transition dropped', () => {
  it('on watch exit, re-spawns the child, runs a fresh list, and reconciles missed transitions', async () => {
    const children: FakeChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    const deltas: SessionDelta[] = []

    // First list = the full snapshot; after the gap, list DROPS the infra session
    // (id 3333…) — simulating a stop we missed while the watch was down.
    let listCall = 0
    const listFn = vi.fn(() => {
      listCall += 1
      if (listCall === 1) return fakeListSnapshot
      return {
        diagnostics: fakeListSnapshot.diagnostics,
        sessions: fakeListSnapshot.sessions.filter(
          (s) => s.id !== '33333333-3333-4333-8333-333333333333'
        )
      }
    })

    const feed = createFeed({
      spawnFn,
      reducer,
      listFn,
      onDelta: (d) => deltas.push(d),
      now: () => FIXED_NOW
    })
    await feed.start()

    // initial seed had the infra session present.
    expect(reducer.snapshotMap().has('33333333-3333-4333-8333-333333333333')).toBe(true)
    expect(children).toHaveLength(1)

    // The watch child exits → feed must reconnect (restart + fresh list + diff).
    children[0]?.exit(1)
    await feed.whenReconnected()

    // a NEW child was spawned (reconnect aborts-and-replaces).
    expect(children.length).toBeGreaterThanOrEqual(2)
    // the missed stop was healed level-triggered via the fresh list reconcile.
    expect(reducer.snapshotMap().has('33333333-3333-4333-8333-333333333333')).toBe(false)
    expect(
      deltas.some(
        (d) =>
          d.event.type === 'session.removed' &&
          d.event.id === '33333333-3333-4333-8333-333333333333'
      )
    ).toBe(true)

    await feed.stop()
  })

  it('emits onStatus reconnecting:true when the watch child exits, and false once reconnected (the REAL banner signal)', async () => {
    const children: FakeChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    const statuses: boolean[] = []

    const feed = createFeed({
      spawnFn,
      reducer,
      listFn: () => fakeListSnapshot,
      onDelta: () => {},
      onStatus: (s) => statuses.push(s.reconnecting),
      now: () => FIXED_NOW
    })
    await feed.start()
    // A quiet, connected feed has emitted NO status (silence ≠ reconnecting).
    expect(statuses).toEqual([])

    // The watch child dies → the feed reconnects: reconnecting:true while in flight,
    // then false once the restart + list reconcile settle.
    children[0]?.exit(1)
    await feed.whenReconnected()

    expect(statuses).toEqual([true, false])
    await feed.stop()
  })

  it('stop() aborts the controller and kills the current child (no leaked process)', async () => {
    const children: FakeChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeChild()
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
    await feed.stop()
    expect(children[0]?.kill).toHaveBeenCalled()
    // after stop(), a child exit must NOT trigger a reconnect (controller aborted).
    const spawnCallsBefore = (spawnFn as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length
    children[0]?.exit(0)
    await Promise.resolve()
    expect((spawnFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      spawnCallsBefore
    )
  })

  it('a child exit DURING an in-flight reconnect does NOT nest a second reconnect (serialized: no orphaned child, final state still reconciles)', async () => {
    const children: FakeChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    const deltas: SessionDelta[] = []

    // A CONTROLLABLE async list: the reconnect's `await listFn()` parks on this
    // deferred so we can fire a SECOND child exit while the reconnect is mid-flight.
    let releaseSecondList: ((value: unknown) => void) | undefined
    let listCall = 0
    const listFn = vi.fn((): unknown | Promise<unknown> => {
      listCall += 1
      if (listCall === 1) return fakeListSnapshot // sync initial seed
      // 2nd list = the reconnect's snapshot; park it until we release it, and DROP the
      // infra session (id 3333…) to prove the reconcile still heals a missed stop.
      return new Promise((resolve) => {
        releaseSecondList = resolve
      })
    })

    const feed = createFeed({
      spawnFn,
      reducer,
      listFn,
      onDelta: (d) => deltas.push(d),
      now: () => FIXED_NOW
    })
    await feed.start()
    expect(children).toHaveLength(1) // child[0] from start()
    expect(reducer.snapshotMap().has('33333333-3333-4333-8333-333333333333')).toBe(true)

    // child[0] exits → reconnect #1 begins: abort+kill child[0], spawn child[1], then
    // PARK on the deferred 2nd list.
    children[0]?.exit(1)
    await Promise.resolve() // let the exit handler + spawnChild run up to the await
    expect(children).toHaveLength(2) // child[1] respawned by reconnect #1
    expect(children[0]?.kill).toHaveBeenCalledTimes(1) // prior child reaped exactly once
    expect(releaseSecondList).toBeDefined() // we are parked inside reconnect #1's list

    // child[1] exits WHILE reconnect #1 is still awaiting the list. WITHOUT the
    // serialization guard this would nest reconnect #2 (abort+replace controller,
    // re-spawn child[2], clobber the in-flight `child` ref → orphaned watch child).
    const spawnCallsDuringReconnect = (spawnFn as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length
    children[1]?.exit(1)
    await Promise.resolve()
    // GUARD HOLDS: no second concurrent reconnect → no extra spawn, no orphaned child.
    expect((spawnFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      spawnCallsDuringReconnect
    )
    expect(children).toHaveLength(2)
    expect(children[1]?.kill).not.toHaveBeenCalled() // child[1] not reaped by a nested run

    // Release the parked list (drops the infra session) → reconnect #1 completes the
    // reconcile. AC-3: the missed stop is healed level-triggered, no transition dropped.
    releaseSecondList?.({
      diagnostics: fakeListSnapshot.diagnostics,
      sessions: fakeListSnapshot.sessions.filter(
        (s) => s.id !== '33333333-3333-4333-8333-333333333333'
      )
    })
    await feed.whenReconnected()

    expect(reducer.snapshotMap().has('33333333-3333-4333-8333-333333333333')).toBe(false)
    expect(
      deltas.some(
        (d) =>
          d.event.type === 'session.removed' &&
          d.event.id === '33333333-3333-4333-8333-333333333333'
      )
    ).toBe(true)
    // exactly TWO children spawned across the whole storm (start + one reconnect).
    expect(children).toHaveLength(2)

    await feed.stop()
  })

  it('a malformed list during reconnect does not crash the feed (caller backs off, stream stays up)', async () => {
    const children: FakeChild[] = []
    const spawnFn: SpawnFn = vi.fn(() => {
      const c = new FakeChild()
      children.push(c)
      return c
    })
    const reducer = createReducer({ now: () => FIXED_NOW })
    let listCall = 0
    const listFn = vi.fn(() => {
      listCall += 1
      if (listCall === 1) return fakeListSnapshot
      return { not: 'an envelope' } // malformed → parseListKeyedById THROWS
    })
    const feed = createFeed({
      spawnFn,
      reducer,
      listFn,
      onDelta: () => {},
      now: () => FIXED_NOW
    })
    await feed.start()
    children[0]?.exit(1)
    // the malformed list throws internally; the feed must catch it and not escape.
    await expect(feed.whenReconnected()).resolves.toBeUndefined()
    await feed.stop()
  })
})
