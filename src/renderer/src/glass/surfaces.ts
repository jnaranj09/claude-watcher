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
export interface SurfaceInput {
  kind: GlassSurface
  rect: GlassRect
  radius: number
  parent: number | null
  status: GlassStatus | null
  clip: GlassRect | null
  hidden: boolean
}
export interface DrawItem {
  kind: GlassSurface
  rect: GlassRect
  radius: number
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

export function buildDrawList(inputs: readonly SurfaceInput[]): DrawItem[] {
  const level1: DrawItem[] = []
  const level2: DrawItem[] = []
  for (const s of inputs) {
    if (s.hidden || s.rect.width < 2 || s.rect.height < 2) continue
    if (s.clip !== null && !intersects(s.rect, s.clip)) continue
    const item: DrawItem = {
      kind: s.kind,
      rect: s.rect,
      radius: s.radius,
      level: s.parent === null ? 1 : 2,
      status: s.status,
      clip: s.clip
    }
    ;(item.level === 1 ? level1 : level2).push(item)
  }
  return [...level1, ...level2]
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
 *  one (a dialog's Save, a toast's Resume, a popover row) is NOT drawn by the WebGL layer. */
const OVERLAY = "[role='dialog'], [data-popover], [data-toast]"

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
      radius: Math.min(parseFloat(style.borderTopLeftRadius) || 0, b.width / 2, b.height / 2),
      parent: parentEl === null ? null : (index.get(parentEl) ?? null),
      status: isStatus(column) ? column : null,
      clip,
      hidden: style.visibility === 'hidden'
    })
  }
  return out
}

function intersect(a: GlassRect, b: GlassRect): GlassRect {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
