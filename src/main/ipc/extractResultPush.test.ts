// The result push's hold (ruling R38): a save's result produced before any window's renderer is
// ready waits in main, newest 50, and goes to the first ready window once, in order.
import { describe, it, expect, vi } from 'vitest'
import { CH } from '../../shared/ipc/contract'
import { NO_COUNTS, type MemoryExtractResult } from '../../shared/schemas/memory'
import { createExtractResultPush, HELD_EXTRACT_RESULTS_MAX } from './extractResultPush'

const result = (n: number): MemoryExtractResult => ({
  sessionName: `session ${n}`,
  trigger: 'catchup',
  outcome: 'failed',
  counts: { ...NO_COUNTS, facts: n },
  reason: null
})

function fakeWc(): {
  wc: { isDestroyed(): boolean; send(channel: string, payload: unknown): void }
  sent: () => number[]
  destroy: () => void
} {
  let destroyed = false
  const send = vi.fn<(channel: string, payload: unknown) => void>()
  return {
    wc: { isDestroyed: () => destroyed, send },
    sent: () =>
      send.mock.calls.map(([channel, payload]) => {
        expect(channel).toBe(CH.memoryExtractResult)
        return (payload as MemoryExtractResult).counts.facts
      }),
    destroy: () => {
      destroyed = true
    }
  }
}

describe('createExtractResultPush', () => {
  it('a push before any window is held and delivered exactly once when a renderer is ready', () => {
    const push = createExtractResultPush(() => undefined)
    expect(push.push(result(1))).toBe(true)
    const a = fakeWc()
    push.ready(a.wc)
    expect(a.sent()).toEqual([1])
    const b = fakeWc()
    push.ready(b.wc)
    expect(b.sent()).toEqual([])
    expect(a.sent()).toEqual([1])
  })

  it('60 pushes before ready deliver the newest 50, in order, and log the drops by code', () => {
    const log = vi.fn()
    const push = createExtractResultPush(log)
    for (let i = 1; i <= 60; i += 1) push.push(result(i))
    const a = fakeWc()
    push.ready(a.wc)
    expect(HELD_EXTRACT_RESULTS_MAX).toBe(50)
    expect(a.sent()).toEqual(Array.from({ length: 50 }, (_, i) => i + 11))
    expect(log).toHaveBeenCalledTimes(10)
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][memory] code=memory_extract_result_held_dropped'
    )
  })

  it('a push after a renderer is ready is sent at once', () => {
    const push = createExtractResultPush(() => undefined)
    const a = fakeWc()
    push.ready(a.wc)
    expect(push.push(result(2))).toBe(true)
    expect(a.sent()).toEqual([2])
  })

  it('with no window ever, nothing throws and every valid push counts as held', () => {
    const push = createExtractResultPush(() => undefined)
    for (let i = 0; i < 70; i += 1) expect(push.push(result(i))).toBe(true)
  })

  it('a window destroyed and re-created gets the results held meanwhile, then later ones', () => {
    const push = createExtractResultPush(() => undefined)
    const a = fakeWc()
    push.ready(a.wc)
    a.destroy()
    expect(push.push(result(3))).toBe(true)
    const b = fakeWc()
    push.ready(b.wc)
    push.push(result(4))
    expect(a.sent()).toEqual([])
    expect(b.sent()).toEqual([3, 4])
  })

  it('an invalid result is neither sent nor held, and says so with false', () => {
    const log = vi.fn()
    const push = createExtractResultPush(log)
    expect(push.push({ ...result(5), counts: { ...NO_COUNTS, tasks: -1 } })).toBe(false)
    const a = fakeWc()
    push.ready(a.wc)
    expect(a.sent()).toEqual([])
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][memory] code=memory_extract_result_invalid path=counts.tasks issue=too_small'
    )
  })
})
