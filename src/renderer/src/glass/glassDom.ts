// The glass layer's reads and writes on the document, outside the component (react-refresh:
// GlassLayer.tsx exports only the component). Called from GlassLayer's rAF tick, never in render.
import type { GlassColors } from './glassRenderer'
import type { GlassStatus } from './surfaces'
import { parseRgb } from './cssColor'

/** On `<html>` after the first good WebGL frame; the theme CSS clears the hooked surfaces only
 *  under it (spec 2026-10-08 A.7). */
export const GLASS_ON_ATTR = 'data-glass-on'

/** A status token's computed colour: a probe resolves `var(--x)` to `rgb()`. */
export function readStatusColors(): GlassColors | null {
  const probe = document.createElement('span')
  document.body.append(probe)
  const read = (token: GlassStatus): [number, number, number] | null => {
    probe.style.color = `var(--${token})`
    return parseRgb(getComputedStyle(probe).color)
  }
  const working = read('working')
  const needsYou = read('needs-you')
  const idle = read('idle')
  probe.remove()
  return working && needsYou && idle ? { status: { working, 'needs-you': needsYou, idle } } : null
}

export function wallpaperUrl(): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--theme-wallpaper')
  return /url\("?(data:[^")]+)"?\)/.exec(v)?.[1] ?? null
}

export function setOn(on: boolean): void {
  if (on) document.documentElement.setAttribute(GLASS_ON_ATTR, '')
  else document.documentElement.removeAttribute(GLASS_ON_ATTR)
}
