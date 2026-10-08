// GlassLayer (spec 2026-10-08 A). jsdom has no WebGL2, no matchMedia and no Image.decode:
// getContext is spied, matchMedia/decode are ASSIGNED (vi.spyOn throws on a missing member).
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderComponent } from '../test/renderComponent'
import { GLASS_FIXTURE } from '../../../__fixtures__/glassSpec'
import type { GlassColors, GlassFrame, GlassRenderer } from './glassRenderer'
import { GlassLayer } from './GlassLayer'
import { GLASS_ON_ATTR } from './glassDom'

const STATUS: GlassColors = {
  status: { working: [0, 0, 1], 'needs-you': [1, 1, 0], idle: [0.5, 0.5, 0.5] }
}
const statusColors = (): GlassColors => STATUS

/** `matching` = the substring of the one media query that matches ('' = none). */
function mediaQueries(matching: '' | 'reduced-transparency' | 'prefers-contrast: more'): void {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: matching !== '' && q.includes(matching),
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
}

/** `--theme-wallpaper` on the root, as App's stylesheet would set it. */
function stubWallpaper(): void {
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const cs = real(el, pseudo)
    if (el !== document.documentElement) return cs
    return new Proxy(cs, {
      get(target, key) {
        if (key === 'getPropertyValue') {
          return (p: string) =>
            p === '--theme-wallpaper'
              ? 'url("data:image/png;base64,AA==")'
              : target.getPropertyValue(p)
        }
        const v: unknown = Reflect.get(target, key)
        return typeof v === 'function' ? v.bind(target) : v
      }
    })
  })
}

type FakeRenderer = GlassRenderer & {
  setWallpaper: ReturnType<typeof vi.fn<(img: HTMLImageElement) => void>>
  draw: ReturnType<typeof vi.fn<(frame: GlassFrame) => boolean>>
  dispose: ReturnType<typeof vi.fn<() => void>>
}

function fakeRenderer(drawResult: { ok: boolean }): FakeRenderer {
  return {
    setWallpaper: vi.fn<(img: HTMLImageElement) => void>(),
    draw: vi.fn<(frame: GlassFrame) => boolean>(() => drawResult.ok),
    dispose: vi.fn<() => void>()
  }
}

beforeEach(() => {
  mediaQueries('')
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined)
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  document.documentElement.removeAttribute(GLASS_ON_ATTR)
  Reflect.deleteProperty(window, 'matchMedia')
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
  vi.restoreAllMocks()
})

describe('GlassLayer', () => {
  it('without WebGL2 keeps the CSS glass: canvas mounted, attribute never set, one log', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { container, root, unmount } = renderComponent(
      <GlassLayer spec={GLASS_FIXTURE} wallpaperId="lake" statusColors={statusColors} />
    )
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(console.warn)
          .mock.calls.filter((c) => String(c[0]).includes('code=glass_unavailable'))
      ).toHaveLength(1)
    )
    act(() =>
      root.render(
        <GlassLayer spec={GLASS_FIXTURE} wallpaperId="lake" statusColors={statusColors} />
      )
    )
    expect(container.querySelector('canvas[aria-hidden="true"]')).not.toBeNull()
    expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(false)
    expect(
      vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('code=glass_unavailable'))
    ).toHaveLength(1)
    unmount()
  })

  // Review 2026-10-08: User Timing entries are not capped, and the moving light draws up to 60
  // frames a second — the layer keeps nothing in the timeline (the drive reads it with an observer).
  it('leaves no glass-collect measure in the performance timeline', async () => {
    stubWallpaper()
    performance.clearMeasures()
    const fake = fakeRenderer({ ok: true })
    const { unmount } = renderComponent(
      <GlassLayer
        spec={GLASS_FIXTURE}
        wallpaperId="lake"
        statusColors={statusColors}
        createRenderer={() => fake}
      />
    )
    await vi.waitFor(() => expect(fake.draw).toHaveBeenCalled())
    expect(performance.getEntriesByName('glass-collect', 'measure')).toHaveLength(0)
    unmount()
  })

  // Owner, 2026-10-08: the light follows the pointer per surface; Liquid Glass keeps it fixed on the
  // header. The fixture's header says false, the column true.
  it('moves the light only on surfaces whose material follows the cursor', async () => {
    stubWallpaper()
    const box = (left: number, top: number, width: number, height: number): DOMRect => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    })
    const header = document.createElement('header')
    header.setAttribute('data-glass', 'header')
    header.getBoundingClientRect = () => box(0, 0, 800, 48)
    const column = document.createElement('section')
    column.setAttribute('data-glass', 'column')
    column.getBoundingClientRect = () => box(0, 100, 300, 400)
    document.body.append(header, column)
    const fake = fakeRenderer({ ok: true })
    const { unmount } = renderComponent(
      <GlassLayer
        spec={GLASS_FIXTURE}
        wallpaperId="lake"
        statusColors={statusColors}
        createRenderer={() => fake}
      />
    )
    await vi.waitFor(() => expect(fake.draw).toHaveBeenCalled())
    const lastAngles = (): readonly number[] => fake.draw.mock.lastCall?.[0].angles ?? []
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 700, clientY: 10 }))
    await vi.waitFor(() => expect(fake.draw.mock.calls.length).toBeGreaterThan(1))
    expect(lastAngles()[0]).toBe(135) // header: fixed light
    const calls = fake.draw.mock.calls.length
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 290, clientY: 110 }))
    await vi.waitFor(() => expect(fake.draw.mock.calls.length).toBeGreaterThan(calls))
    expect(lastAngles()[1]).not.toBe(135) // column: the light follows the pointer
    header.remove()
    column.remove()
    unmount()
  })

  it('removes data-glass-on on unmount (theme switched away)', async () => {
    stubWallpaper()
    const fake = fakeRenderer({ ok: true })
    const { unmount } = renderComponent(
      <GlassLayer
        spec={GLASS_FIXTURE}
        wallpaperId="lake"
        statusColors={statusColors}
        createRenderer={() => fake}
      />
    )
    await vi.waitFor(() => expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(true))
    unmount()
    expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(false)
    expect(fake.dispose).toHaveBeenCalled()
  })

  it('renders nothing under prefers-reduced-transparency', () => {
    mediaQueries('reduced-transparency')
    const { container, unmount } = renderComponent(
      <GlassLayer spec={GLASS_FIXTURE} wallpaperId="lake" statusColors={statusColors} />
    )
    expect(container.querySelector('canvas')).toBeNull()
    unmount()
  })

  it('renders nothing under prefers-contrast: more (spec D.9: a solid fill)', () => {
    mediaQueries('prefers-contrast: more')
    const { container, unmount } = renderComponent(
      <GlassLayer spec={GLASS_FIXTURE} wallpaperId="lake" statusColors={statusColors} />
    )
    expect(container.querySelector('canvas')).toBeNull()
    unmount()
  })

  it('loads a texture per theme push, and drops the attribute when a draw fails', async () => {
    stubWallpaper()
    const result = { ok: true }
    const fakes: ReturnType<typeof fakeRenderer>[] = []
    const create = vi.fn(() => {
      const f = fakeRenderer(result)
      fakes.push(f)
      return f
    })
    const { root, unmount } = renderComponent(
      <GlassLayer
        spec={GLASS_FIXTURE}
        wallpaperId="lake"
        statusColors={statusColors}
        createRenderer={create}
      />
    )
    await vi.waitFor(() => expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(true))
    // A new wallpaper → a new renderer with its own texture.
    act(() =>
      root.render(
        <GlassLayer
          spec={GLASS_FIXTURE}
          wallpaperId="bridge"
          statusColors={statusColors}
          createRenderer={create}
        />
      )
    )
    await vi.waitFor(() => expect(fakes[1]?.setWallpaper).toHaveBeenCalledTimes(1))
    // "Reload themes": a NEW spec object, the SAME wallpaper → still a texture for the new renderer.
    act(() =>
      root.render(
        <GlassLayer
          spec={structuredClone(GLASS_FIXTURE)}
          wallpaperId="bridge"
          statusColors={statusColors}
          createRenderer={create}
        />
      )
    )
    await vi.waitFor(() => expect(fakes[2]?.setWallpaper).toHaveBeenCalledTimes(1))
    expect(fakes[0]?.dispose).toHaveBeenCalled()
    // A failed draw (context lost mid-frame) → the CSS glass comes back.
    result.ok = false
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(false))
    unmount()
  })

  it('a rejected decode from a disposed renderer leaves the attribute alone', async () => {
    stubWallpaper()
    // One controllable promise per decode() call, in call order.
    const decodes: { resolve: () => void; reject: (e: Error) => void }[] = []
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            decodes.push({ resolve, reject })
          })
      )
    })
    const create = vi.fn(() => fakeRenderer({ ok: true }))
    const { root, unmount } = renderComponent(
      <GlassLayer
        spec={GLASS_FIXTURE}
        wallpaperId="lake"
        statusColors={statusColors}
        createRenderer={create}
      />
    )
    await vi.waitFor(() => expect(decodes).toHaveLength(1)) // first renderer, decode still pending
    act(() =>
      root.render(
        <GlassLayer
          spec={GLASS_FIXTURE}
          wallpaperId="bridge"
          statusColors={statusColors}
          createRenderer={create}
        />
      )
    )
    await vi.waitFor(() => expect(decodes).toHaveLength(2))
    decodes[1]?.resolve()
    await vi.waitFor(() => expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(true))
    decodes[0]?.reject(new Error('late'))
    await new Promise((r) => setTimeout(r, 50)) // let the stale rejection and a few rAF ticks run
    expect(document.documentElement.hasAttribute(GLASS_ON_ATTR)).toBe(true)
    expect(
      vi
        .mocked(console.warn)
        .mock.calls.filter((c) => String(c[0]).includes('code=glass_wallpaper_failed'))
    ).toHaveLength(0)
    unmount()
  })
})
