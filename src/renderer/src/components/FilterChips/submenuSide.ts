// Which side the filter's type submenu opens on: right, unless the values would leave the window
// (spec 2026-10-16 — the AppMenu way, flipped). And, by the same rule, which edge of its trigger a
// popup under it lines up with. Pure, so the edge is tested without a layout engine.
/** The widest value list (the folder list) plus its gap. */
export const SUBMENU_ROOM = 320

export function submenuSide(anchorRight: number, viewportWidth: number): 'left' | 'right' {
  return anchorRight + SUBMENU_ROOM > viewportWidth ? 'left' : 'right'
}

export type PopupAlign = 'start' | 'end'

/** Which trigger edge a popup UNDER it lines up with (the type menu, a pill's list, the
 *  Calendar): its left edge while the widest list fits in the window, else its right edge. */
export function popupAlign(triggerLeft: number, viewportWidth: number): PopupAlign {
  return submenuSide(triggerLeft, viewportWidth) === 'left' ? 'end' : 'start'
}
