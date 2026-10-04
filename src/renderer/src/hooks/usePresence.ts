// Overlay motion (spec 2026-10-04 §3) — keep a closing overlay on screen while its exit plays.
// Every overlay used to unmount the moment its state cleared (`open && <…>`), so no exit could
// show. While `value` is non-null it is returned as is. When it turns null after a POINTER input
// (and without reduced motion) the last value is kept with `leaving: true` for MOTION_EXIT_MS, then
// dropped. A keyboard close, or no input seen yet (jsdom `.click()` fires no pointerdown — so every
// existing test keeps today's instant unmount), drops it at once. A re-open cancels the exit.
//
// The previous value is tracked in state and adjusted DURING render (React's "storing information
// from previous renders" pattern), so no ref is read in render.
import { useEffect, useState } from 'react'
import { lastInput } from '../lib/inputModality'
import { MOTION_EXIT_MS } from '../styles/motion'

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function exitAnimates(): boolean {
  return lastInput() === 'pointer' && !reducedMotion()
}

export function usePresentValue<T>(value: T | null): { value: T | null; leaving: boolean } {
  const [prev, setPrev] = useState<T | null>(value)
  const [kept, setKept] = useState<T | null>(null)
  if (value !== prev) {
    setPrev(value)
    setKept(value === null && prev !== null && exitAnimates() ? prev : null)
  }

  useEffect(() => {
    if (kept === null) return
    const handle = setTimeout(() => setKept(null), MOTION_EXIT_MS)
    return () => clearTimeout(handle)
  }, [kept])

  if (value !== null) return { value, leaving: false }
  return { value: kept, leaving: kept !== null }
}
