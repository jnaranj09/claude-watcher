// The WebGL glass layer's view of the DOM (spec 2026-10-08 A.5). Pure except collectSurfaces.
import type { GlassSurface } from '../../../shared/schemas/theme'
import { GLASS_SURFACES } from '../../../shared/schemas/theme'

export interface GlassRect {
  left: number
  top: number
  width: number
  height: number
}
export type GlassStatus = 'working' | 'needs-you' | 'idle'
/** Corner radii in CSS order: top-left, top-right, bottom-right, bottom-left (CSS px). */
export type GlassRadii = readonly [number, number, number, number]
export interface SurfaceInput {
  kind: GlassSurface
  rect: GlassRect
  radii: GlassRadii
  /** Computed z-index (`auto` = 0): a lower one is drawn first within its level. */
  z: number
  parent: number | null
  status: GlassStatus | null
  clip: GlassRect | null
  hidden: boolean
}
export interface DrawItem {
  kind: GlassSurface
  rect: GlassRect
  radii: GlassRadii
  level: 1 | 2
  status: GlassStatus | null
  clip: GlassRect | null
}

function intersects(a: GlassRect, b: GlassRect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  )
}

/** Level 1 (on the wallpaper) before level 2 (on another glass); within a level, a lower z-index
 *  first, so a surface tucked under its neighbour (the switcher's elsewhere tab) is drawn under it.
 *  DOM order otherwise (the sort is stable). */
export function buildDrawList(inputs: readonly SurfaceInput[]): DrawItem[] {
  const level1: { z: number; item: DrawItem }[] = []
  const level2: { z: number; item: DrawItem }[] = []
  for (const s of inputs) {
    if (s.hidden || s.rect.width < 2 || s.rect.height < 2) continue
    if (s.clip !== null && !intersects(s.rect, s.clip)) continue
    const item: DrawItem = {
      kind: s.kind,
      rect: s.rect,
      radii: s.radii,
      level: s.parent === null ? 1 : 2,
      status: s.status,
      clip: s.clip
    }
    ;(item.level === 1 ? level1 : level2).push({ z: s.z, item })
  }
  const byZ = (a: { z: number }, b: { z: number }): number => a.z - b.z
  return [...level1.sort(byZ), ...level2.sort(byZ)].map((x) => x.item)
}

const q = (n: number): number => Math.round(n)
export function drawKey(
  items: readonly DrawItem[],
  width: number,
  height: number,
  dpr: number
): string {
  const parts = items.map((i) => {
    const c =
      i.clip === null
        ? ''
        : `${q(i.clip.left)},${q(i.clip.top)},${q(i.clip.width)},${q(i.clip.height)}`
    return `${i.kind}:${q(i.rect.left)},${q(i.rect.top)},${q(i.rect.width)},${q(i.rect.height)}:${c}`
  })
  return `${width}x${height}@${dpr}|${parts.join(';')}`
}

const STATUS = new Set<string>(['working', 'needs-you', 'idle'])
const SURFACES = new Set<string>(GLASS_SURFACES)

function isSurface(v: string | null): v is GlassSurface {
  return v !== null && SURFACES.has(v)
}
function isStatus(v: string | null): v is GlassStatus {
  return v !== null && STATUS.has(v)
}

/** Overlays paint their own CSS glass (spec: overlays unchanged in spec 1). A glass button inside
 *  one (a dialog's Save, a toast's Resume, a popover row) is NOT drawn by the WebGL layer. The
 *  dead-terminal pane is one too: its frosted fill covers the canvas, so a button drawn there by
 *  the layer had no glow (owner, 2026-10-12). */
export const OVERLAY =
  "[role='dialog'], [data-popover], [data-toast], [data-testid='dead-terminal']"

/** Reads every `[data-glass]` element. Clip = the intersection of ancestors whose overflow is
 *  not `visible` (the board grid scrolls; a card scrolled under the filter bar must not draw).
 *  Element opacity is ignored ([OPERATOR] 2026-10-08, option A): calm cards render at
 *  `opacity: 0.82`, but every card's glass is the full card material, as on the canvas. */
export function collectSurfaces(doc: Document): SurfaceInput[] {
  const els = Array.from(doc.querySelectorAll<HTMLElement>('[data-glass]'))
  const index = new Map<Element, number>()
  els.forEach((el, i) => index.set(el, i))
  const view = doc.defaultView
  const out: SurfaceInput[] = []
  for (const el of els) {
    const kind = el.getAttribute('data-glass')
    if (!isSurface(kind) || view === null || el.closest(OVERLAY) !== null) continue
    const style = view.getComputedStyle(el)
    const b = el.getBoundingClientRect()
    let clip: GlassRect | null = null
    for (let a = el.parentElement; a !== null; a = a.parentElement) {
      const o = view.getComputedStyle(a)
      if (o.overflowX === 'visible' && o.overflowY === 'visible') continue
      const ar = a.getBoundingClientRect()
      const next = { left: ar.left, top: ar.top, width: ar.width, height: ar.height }
      clip = clip === null ? next : intersect(clip, next)
    }
    const parentEl = el.parentElement?.closest('[data-glass]') ?? null
    const column = kind === 'column' ? el.getAttribute('data-column') : null
    out.push({
      kind,
      rect: { left: b.left, top: b.top, width: b.width, height: b.height },
      radii: radiiOf(style, b.width, b.height),
      z: parseInt(style.zIndex, 10) || 0,
      parent: parentEl === null ? null : (index.get(parentEl) ?? null),
      status: isStatus(column) ? column : null,
      clip,
      hidden: style.visibility === 'hidden'
    })
  }
  return out
}

/** Each corner from its longhand (a theme may round only some: the elsewhere tab is square on the
 *  left), capped at half the box like CSS. */
function radiiOf(style: CSSStyleDeclaration, width: number, height: number): GlassRadii {
  const cap = Math.min(width / 2, height / 2)
  const c = (v: string): number => Math.min(parseFloat(v) || 0, cap)
  return [
    c(style.borderTopLeftRadius),
    c(style.borderTopRightRadius),
    c(style.borderBottomRightRadius),
    c(style.borderBottomLeftRadius)
  ]
}

function intersect(a: GlassRect, b: GlassRect): GlassRect {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
