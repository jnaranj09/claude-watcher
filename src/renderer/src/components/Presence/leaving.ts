// Overlay motion (spec 2026-10-04 §3) — "this overlay is playing its exit", handed down by
// <Presence> so the drawing parts (Popover.Surface, the dialog frames) need no new prop.
// A `.ts` file: a context beside a component would trip react-refresh/only-export-components.
import { createContext, useContext } from 'react'

export const LeavingContext = createContext(false)

export function useLeaving(): boolean {
  return useContext(LeavingContext)
}

/** On the leaving box: `data-leaving` drives the exit CSS; `inert` lets a click or focus pass to
 *  what is under it during the exit. */
export function leavingProps(leaving: boolean): { 'data-leaving'?: ''; inert?: boolean } {
  return leaving ? { 'data-leaving': '', inert: true } : {}
}
