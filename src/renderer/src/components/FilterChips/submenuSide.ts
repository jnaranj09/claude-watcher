// Which side the filter's type submenu opens on: right, unless the values would leave the window
// (spec 2026-10-16 — the AppMenu way, flipped). Pure, so the edge is tested without a layout engine.
/** The widest value list (the folder list) plus its gap. */
export const SUBMENU_ROOM = 320

export function submenuSide(anchorRight: number, viewportWidth: number): 'left' | 'right' {
  return anchorRight + SUBMENU_ROOM > viewportWidth ? 'left' : 'right'
}
