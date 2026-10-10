import type { DrawItem, GlassRect } from './surfaces'

/** Top-left: the fixed light of today's rims and the canvas (spec 2026-10-08 A.8). */
export const DEFAULT_LIGHT_ANGLE = 135

/** Degrees CCW from +x in GL space (y up) from the rect's centre to the pointer. */
export function lightAngleFor(
  rect: GlassRect,
  pointer: { x: number; y: number } | null,
  reducedMotion: boolean
): number {
  if (pointer === null || reducedMotion) return DEFAULT_LIGHT_ANGLE
  const dx = pointer.x - (rect.left + rect.width / 2)
  const dy = rect.top + rect.height / 2 - pointer.y
  if (dx === 0 && dy === 0) return DEFAULT_LIGHT_ANGLE
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
}

export function surfaceAt(
  items: readonly DrawItem[],
  pointer: { x: number; y: number }
): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const r = items[i]?.rect
    if (
      r &&
      pointer.x >= r.left &&
      pointer.x <= r.left + r.width &&
      pointer.y >= r.top &&
      pointer.y <= r.top + r.height
    )
      return i
  }
  return null
}
