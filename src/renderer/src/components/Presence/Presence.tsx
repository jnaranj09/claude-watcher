// Overlay motion (spec 2026-10-04 §3) — the wrapper form of usePresentValue: replaces
// `{x !== null && <Overlay x={x} />}` with `<Presence value={x}>{(x) => <Overlay x={x} />}</Presence>`.
// For a boolean, pass `value={open || null}`. The subtree reads the leaving state with useLeaving().
import type { JSX, ReactNode } from 'react'
import { usePresentValue } from '../../hooks/usePresence'
import { LeavingContext } from './leaving'

export interface PresenceProps<T> {
  value: T | null
  /** `leaving` is for the caller's own positioned wrapper: give it `leavingProps(leaving)`. */
  children: (value: T, leaving: boolean) => ReactNode
}

export function Presence<T>({ value, children }: PresenceProps<T>): JSX.Element | null {
  const shown = usePresentValue(value)
  if (shown.value === null) return null
  return (
    <LeavingContext value={shown.leaving}>{children(shown.value, shown.leaving)}</LeavingContext>
  )
}
