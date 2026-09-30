// A hand-driven clock for the toast store's tests (state.md: inject time for determinism).
// `advance(ms)` fires every timer that falls due, in order, moving `now()` with it.
import type { ToastClock } from '../stores/toastStore'

export function manualClock(): ToastClock & { advance: (ms: number) => void } {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      seq += 1
      timers.set(seq, { at: now + ms, fn })
      return seq
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
    advance: (ms) => {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = end
    }
  }
}
