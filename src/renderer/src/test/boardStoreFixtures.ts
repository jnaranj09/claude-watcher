// Time for the boardStore tests: a fixed `now()` value and a clock that can be advanced.
// Used by boardStore.test, boardStore.view.test and boardStore.filters.test.

export const FIXED_NOW = 1_750_000_000_000

/** A controllable clock for deterministic time-based assertions. */
export function makeClock(start = FIXED_NOW): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}
