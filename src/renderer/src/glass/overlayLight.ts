// The moving light on the CSS glass of overlays (owner, 2026-10-08). The WebGL layer cannot draw
// overlays, so the app hands the light's angle to the theme: `--glass-light: <deg>` on the ONE
// element under the pointer (the innermost, like the board), and the theme's CSS turns it into its
// rim. A theme that never reads `--glass-light` is unaffected.
import { OVERLAY } from './surfaces'

export const GLASS_LIGHT_PROP = '--glass-light'

/** The surfaces whose CSS glass carries a rim: popover rows, enabled primary/secondary buttons and
 *  toasts. A popover box and a modal panel have no rim to light (owner, 2026-10-05). */
const LIT = [
  '[data-popover-item]:not(:disabled)',
  "button[data-variant='primary']:not(:disabled)",
  "button[data-variant='secondary']:not(:disabled):not([data-lit])",
  '[data-toast]'
].join(', ')

/** The innermost lit surface at `el`, only inside an overlay: board surfaces are the WebGL
 *  layer's. A disabled row or button stops the search (its toast or row is not lit through it). */
export function overlayLightTarget(el: Element | null): HTMLElement | null {
  const hit = el?.closest<HTMLElement>(`${LIT}, :disabled`) ?? null
  if (hit === null || hit.matches(':disabled')) return null
  return hit.closest(OVERLAY) !== null ? hit : null
}

export function setOverlayLight(el: HTMLElement, angle: number | null): void {
  if (angle === null) el.style.removeProperty(GLASS_LIGHT_PROP)
  else el.style.setProperty(GLASS_LIGHT_PROP, `${Math.round(angle)}deg`)
}
