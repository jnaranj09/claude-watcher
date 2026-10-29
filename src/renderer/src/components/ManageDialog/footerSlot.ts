// Where `ManageDialog.Footer` draws: the slot a Form or Pane renders UNDER its scroll body (spec
// 2026-10-29 goals page polish), so `[Delete] [Save]` never sit inside what scrolls. A context, not
// a child scan: a Footer may sit anywhere inside (Context history's Restore is inside a fragment).
// Its own `.ts` file so `ManageDialogParts.tsx` exports components only
// (react-refresh/only-export-components).
import { createContext } from 'react'

export interface FooterSlot {
  /** The element under the scroll body; null until it mounts. */
  element: HTMLElement | null
  /** The Form's or Pane's test id: the footer is `<testId>-footer`. */
  testId: string | undefined
}

export const FooterSlotContext = createContext<FooterSlot | null>(null)
