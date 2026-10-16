// Which side the filter's type submenu opens on: right, unless the values would leave the window
// (spec 2026-10-16 — the AppMenu way, flipped). And, by the same rule, which edge of its trigger a
// popup under it lines up with. Pure, so the edge is tested without a layout engine.
/** The room a value list needs beside the type menu: the list plus its gap. */
export const SUBMENU_ROOM = 320

/** The gap a submenu opens at beside its row (Popover.module.css `.submenuWrap`:
 *  `--space-2 + --space-1`). */
export const SUBMENU_GAP = 12

/** The widest any FilterChips popup may be, so a value list always fits in SUBMENU_ROOM.
 *  FilterChips.module.css writes it again as `--popover-max-width` (pinned by
 *  submenuSide.test.ts). */
export const FILTER_LIST_MAX = SUBMENU_ROOM - SUBMENU_GAP

export function submenuSide(anchorRight: number, viewportWidth: number): 'left' | 'right' {
  return anchorRight + SUBMENU_ROOM > viewportWidth ? 'left' : 'right'
}

export type PopupAlign = 'start' | 'end'

/** Which trigger edge a popup UNDER it lines up with (the type menu, a pill's list, the
 *  Calendar): its left edge while the widest list fits in the window, else its right edge. */
export function popupAlign(triggerLeft: number, viewportWidth: number): PopupAlign {
  return submenuSide(triggerLeft, viewportWidth) === 'left' ? 'end' : 'start'
}
