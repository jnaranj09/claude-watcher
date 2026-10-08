import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDrawList,
  collectSurfaces,
  drawKey,
  type GlassRect,
  type SurfaceInput
} from './surfaces'

const base: Omit<SurfaceInput, 'kind' | 'rect' | 'parent'> = {
  radius: 12,
  status: null,
  clip: null,
  hidden: false
}
const r = (left: number, top: number, width = 100, height = 50): GlassRect => ({
  left,
  top,
  width,
  height
})

describe('buildDrawList', () => {
  it('puts surfaces on the wallpaper at level 1 and nested ones at level 2, level 1 first', () => {
    const list = buildDrawList([
      { ...base, kind: 'card', rect: r(10, 60), parent: 1 },
      { ...base, kind: 'column', rect: r(0, 40, 300, 600), parent: null },
      { ...base, kind: 'header', rect: r(0, 0, 900, 48), parent: null }
    ])
    expect(list.map((i) => [i.kind, i.level])).toEqual([
      ['column', 1],
      ['header', 1],
      ['card', 2]
    ])
  })

  it('skips hidden and sub-2px surfaces (the inactive view is visibility:hidden)', () => {
    const list = buildDrawList([
      { ...base, kind: 'column', rect: r(0, 0), parent: null, hidden: true },
      { ...base, kind: 'card', rect: r(0, 0, 1, 40), parent: null }
    ])
    expect(list).toEqual([])
  })

  it('keeps the clip (a card scrolled half under the filter bar)', () => {
    const clip = r(0, 100, 900, 400)
    const [item] = buildDrawList([{ ...base, kind: 'card', rect: r(0, 80), parent: null, clip }])
    expect(item?.clip).toEqual(clip)
  })

  it('drops a surface entirely outside its clip', () => {
    expect(
      buildDrawList([
        { ...base, kind: 'card', rect: r(0, 0, 100, 50), parent: null, clip: r(0, 100, 900, 400) }
      ])
    ).toEqual([])
  })
})

describe('drawKey', () => {
  const items = buildDrawList([{ ...base, kind: 'header', rect: r(0, 0, 900, 48), parent: null }])
  it('ignores sub-pixel jitter', () => {
    const jitter = buildDrawList([
      { ...base, kind: 'header', rect: r(0.2, 0.3, 900.1, 48), parent: null }
    ])
    expect(drawKey(jitter, 1440, 900, 1)).toBe(drawKey(items, 1440, 900, 1))
  })
  it('changes on move, resize and dpr', () => {
    const k = drawKey(items, 1440, 900, 1)
    expect(
      drawKey(
        buildDrawList([{ ...base, kind: 'header', rect: r(0, 5, 900, 48), parent: null }]),
        1440,
        900,
        1
      )
    ).not.toBe(k)
    expect(drawKey(items, 1200, 900, 1)).not.toBe(k)
    expect(drawKey(items, 1440, 900, 2)).not.toBe(k)
  })
})

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  }) satisfies DOMRect

describe('collectSurfaces', () => {
  // Longhands only in this HTML: jsdom 29 expands neither `overflow` nor `border-radius`, so the
  // shorthands would read `visible` / `0`. Chromium expands both; the code reads the longhands.
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('reads nesting, status and the scroller clip; skips overlays and ignores opacity', () => {
    document.body.innerHTML = `
      <div id="grid" style="overflow-x: auto; overflow-y: auto">
        <section id="col" data-glass="column" data-column="needs-you" style="border-top-left-radius: 24px">
          <div id="card" data-glass="card" style="opacity: 0.82; border-top-left-radius: 12px"></div>
        </section>
      </div>
      <div role="dialog"><button id="save" data-glass="control"></button></div>`
    const boxes: Record<string, DOMRect> = {
      grid: rect(0, 100, 900, 400),
      col: rect(8, 100, 300, 600),
      card: rect(20, 80, 280, 80),
      save: rect(500, 500, 80, 32)
    }
    for (const [id, b] of Object.entries(boxes)) {
      const el = document.getElementById(id)
      if (el) el.getBoundingClientRect = () => b
    }
    const out = collectSurfaces(document)
    expect(out.map((s) => s.kind)).toEqual(['column', 'card']) // the dialog's Save is skipped
    expect(out[0]?.status).toBe('needs-you')
    expect(out[0]?.parent).toBeNull()
    expect(out[1]?.parent).toBe(0)
    expect(out[1]?.clip).toEqual({ left: 0, top: 100, width: 900, height: 400 }) // only the grid clips (the section's overflow is visible)
    expect(out[1]?.radius).toBe(12)
    expect('opacity' in (out[1] ?? {})).toBe(false)
  })

  it('marks a surface inside the inactive (visibility: hidden) view as hidden', () => {
    document.body.innerHTML = `
      <div style="visibility: hidden"><section id="col" data-glass="column" data-column="idle"></section></div>
      <header id="head" data-glass="header"></header>`
    const out = collectSurfaces(document)
    expect(out.map((s) => [s.kind, s.hidden])).toEqual([
      ['column', true],
      ['header', false]
    ])
  })
})
