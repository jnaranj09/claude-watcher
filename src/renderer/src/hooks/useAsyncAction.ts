// Action feedback (spec 2026-09-29 §1.4) — THE double-submit guard. `run` starts `fn` unless a run
// is already in flight, in which case it hands back that run's promise and starts nothing: a second
// Regenerate press, a second Enter on Save, a second native folder picker cannot happen. `busy` is
// true for exactly that window (drive `Button busy` with it) and resets in `finally`, so a
// rejection frees the button too. The NEWEST `fn` runs (it closes over the latest render). No state
// is set after unmount. `fn` owns its errors: a caller that can fail catches, maps the code and
// shows it — `run` only passes a rejection through.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AsyncAction<A extends unknown[]> {
  run: (...args: A) => Promise<void>
  busy: boolean
}

export function useAsyncAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>
): AsyncAction<A> {
  const [busy, setBusy] = useState(false)
  const fnRef = useRef(fn)
  const inFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(false)

  // The latest-callback pattern: written after every render, read only inside `run`.
  useLayoutEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback((...args: A): Promise<void> => {
    if (inFlight.current !== null) return inFlight.current
    setBusy(true)
    const current = (async (): Promise<void> => {
      try {
        await fnRef.current(...args)
      } finally {
        inFlight.current = null
        if (mounted.current) setBusy(false)
      }
    })()
    inFlight.current = current
    return current
  }, [])

  return { run, busy }
}
