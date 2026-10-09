// The WebGL board glass (spec 2026-10-08 A). One canvas behind the UI; the CSS glass stays until
// the first good frame (`data-glass-on`) and comes back on any failure. Imperative: everything per
// frame lives in the effect's closure — no React state per frame (the xterm rule).
//
// NO DOM read in an effect body: App writes the theme stylesheet in ITS useEffect, and React runs
// this child's effects first. The first rAF tick runs after every effect of the commit, so the
// renderer, the token read and the wallpaper load start there.
import { useEffect, useRef, useState, type JSX } from 'react'
import type { GlassSpec } from '../../../shared/schemas/theme'
import { createGlassRenderer, type GlassColors, type GlassRenderer } from './glassRenderer'
import { buildDrawList, collectSurfaces, drawKey, type DrawItem } from './surfaces'
import { DEFAULT_LIGHT_ANGLE, lightAngleFor, surfaceAt } from './lightAngle'
import { readStatusColors, setOn, wallpaperUrl } from './glassDom'
import { overlayLightTarget, setOverlayLight } from './overlayLight'
import styles from './GlassLayer.module.css'

const RT_QUERY = '(prefers-reduced-transparency: reduce)'
// More contrast shows a solid fill (spec D.9); with the layer on, the glass-on rule would win.
const CONTRAST_QUERY = '(prefers-contrast: more)'
const RM_QUERY = '(prefers-reduced-motion: reduce)'

/** One `code=` line per code per mount (a mount = one Liquid Glass session). */
function makeLog(): (code: string) => void {
  const seen = new Set<string>()
  return (code) => {
    if (seen.has(code)) return
    seen.add(code)
    console.warn(`[claude-watcher][glass] code=${code}`)
  }
}

function matches(q: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(q).matches
}

export interface GlassLayerProps {
  spec: GlassSpec
  wallpaperId: string | null
  createRenderer?: typeof createGlassRenderer
  statusColors?: () => GlassColors | null
}

export function GlassLayer({
  spec,
  wallpaperId,
  createRenderer = createGlassRenderer,
  statusColors = readStatusColors
}: GlassLayerProps): JSX.Element | null {
  const [reducedTransparency, setReducedTransparency] = useState(
    () => matches(RT_QUERY) || matches(CONTRAST_QUERY)
  )
  // useState, not useRef: reading ref.current during render is a react-hooks/refs error.
  const [log] = useState(makeLog)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const queries = [window.matchMedia(RT_QUERY), window.matchMedia(CONTRAST_QUERY)]
    const update = (): void => setReducedTransparency(matches(RT_QUERY) || matches(CONTRAST_QUERY))
    for (const mq of queries) mq.addEventListener('change', update)
    return () => {
      for (const mq of queries) mq.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || reducedTransparency) return
    let renderer: GlassRenderer | null = null
    let wallpaperReady = false
    let stopped = false // a failure that only a new theme push / context restore can clear
    let disposed = false
    let frame = 0
    let force = true
    let pointer: { x: number; y: number } | null = null
    let lit: HTMLElement | null = null // the overlay surface carrying --glass-light
    let lastKey = ''
    let lastItems: DrawItem[] = []
    let pendingScissor: DrawItem['rect'] | null = null

    const fail = (code: string): void => {
      log(code)
      stopped = true
      setOn(false)
    }

    // Runs inside a rAF tick only (after App's stylesheet effect).
    const start = (): void => {
      const colors = statusColors()
      if (colors === null) return fail('glass_tokens_missing')
      renderer = createRenderer(canvas, spec, colors, log)
      if (renderer === null) {
        // createGlassRenderer already logged the cause (glass_unavailable / glass_shader_failed).
        stopped = true
        setOn(false)
        return
      }
      const url = wallpaperUrl()
      if (url === null) return fail('glass_no_wallpaper')
      const img = new Image()
      img.src = url
      const mine = renderer
      img.decode().then(
        () => {
          if (disposed || renderer !== mine) return
          mine.setWallpaper(img)
          wallpaperReady = true
          force = true
        },
        () => {
          // Same guard as success: a late rejection from a renderer a theme push already replaced
          // must not turn off the live glass (setOn runs again only on a changed key).
          if (disposed || renderer !== mine) return
          fail('glass_wallpaper_failed')
        }
      )
    }

    const tick = (): void => {
      if (disposed || stopped) return
      frame = requestAnimationFrame(tick)
      if (renderer === null) start()
      const r = renderer
      if (r === null || stopped || !wallpaperReady) return
      performance.mark('glass-collect-start')
      const items = buildDrawList(collectSurfaces(document))
      const dpr = window.devicePixelRatio || 1
      const key = drawKey(items, innerWidth, innerHeight, dpr)
      const changed = key !== lastKey || force
      if (!changed && pendingScissor === null) {
        performance.clearMarks('glass-collect-start') // idle frame: no entry, so the timeline does not grow at 60/s
        return
      }
      // The DOM read's cost, only on frames that draw (Task 8 scenario 9 reads it next to glass-draw).
      performance.measure('glass-collect', 'glass-collect-start')
      performance.clearMarks('glass-collect-start')
      // Nothing stays in the timeline (entries are not capped); the drive reads it with a
      // PerformanceObserver, which still receives the entry.
      performance.clearMeasures('glass-collect')
      const reducedMotion = matches(RM_QUERY)
      const hovered = pointer === null ? null : surfaceAt(items, pointer)
      const angles = items.map((it, i) =>
        i === hovered && spec.surfaces[it.kind].lightFollowsCursor
          ? lightAngleFor(it.rect, pointer, reducedMotion)
          : DEFAULT_LIGHT_ANGLE
      )
      const ok = r.draw({
        width: innerWidth,
        height: innerHeight,
        dpr,
        items,
        angles,
        scissor: changed ? null : pendingScissor
      })
      setOn(ok)
      lastKey = key
      lastItems = items
      force = false
      pendingScissor = null
    }

    const lightOverlay = (target: EventTarget | null, p: { x: number; y: number } | null): void => {
      const next = p === null ? null : overlayLightTarget(target instanceof Element ? target : null)
      if (lit !== null && lit !== next) setOverlayLight(lit, null)
      lit = next
      if (next !== null && p !== null) {
        const b = next.getBoundingClientRect()
        setOverlayLight(
          next,
          lightAngleFor({ left: b.left, top: b.top, width: b.width, height: b.height }, p, false)
        )
      }
    }

    const onPointer = (e: PointerEvent): void => {
      if (matches(RM_QUERY)) return
      lightOverlay(e.target, { x: e.clientX, y: e.clientY })
      const prev = pointer === null ? null : surfaceAt(lastItems, pointer)
      pointer = { x: e.clientX, y: e.clientY }
      const next = surfaceAt(lastItems, pointer)
      if (prev !== null && next !== null && prev !== next) force = true // the light leaves one surface for another
      const hit = next ?? prev
      const rect = hit === null ? undefined : lastItems[hit]?.rect
      if (rect !== undefined) pendingScissor = rect
    }
    const onLeave = (): void => {
      pointer = null
      lightOverlay(null, null)
      force = true
    }
    const onResize = (): void => {
      force = true
    }
    const onLost = (e: Event): void => {
      e.preventDefault()
      setOn(false)
      log('glass_context_lost')
    }
    const onRestored = (): void => {
      renderer?.dispose()
      renderer = null // the next tick starts again: new GL objects, the wallpaper reloaded
      wallpaperReady = false
      stopped = false
      force = true
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onPointer)
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', onResize)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    frame = requestAnimationFrame(tick)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      lightOverlay(null, null)
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      renderer?.dispose()
      setOn(false)
    }
  }, [spec, wallpaperId, reducedTransparency, createRenderer, statusColors, log])

  if (reducedTransparency) return null
  return <canvas ref={canvasRef} className={styles.layer} aria-hidden="true" />
}
