// A deterministic timer queue for main-side tests that inject `now` / `setTimer` / `clearTimer`
// (the attention-reminder scheduler). No real waiting and no global fake timers: time moves only
// when a test calls `advance`, and timers fire in due order — including any a firing timer arms.
export interface FakeTimers {
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  /** Move the clock forward by `ms`, firing every timer that falls due, in due order. */
  advance: (ms: number) => void
  /** How many timers are armed right now. */
  armed: () => number
}

export function createFakeTimers(start: number): FakeTimers {
  let t = start
  let nextHandle = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const handle = nextHandle++
      timers.set(handle, { at: t + ms, fn })
      return handle
    },
    clearTimer: (handle) => {
      if (typeof handle === 'number') timers.delete(handle)
    },
    advance: (ms) => {
      const end = t + ms
      for (;;) {
        let dueHandle: number | undefined
        let dueAt = Infinity
        for (const [handle, timer] of timers) {
          if (timer.at <= end && timer.at < dueAt) {
            dueHandle = handle
            dueAt = timer.at
          }
        }
        if (dueHandle === undefined) break
        const timer = timers.get(dueHandle)
        timers.delete(dueHandle)
        t = dueAt
        timer?.fn()
      }
      t = end
    },
    armed: () => timers.size
  }
}
