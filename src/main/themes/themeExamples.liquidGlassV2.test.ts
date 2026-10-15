// The docs examples ARE theme folders: the scanner reads them as an operator's themes folder.
// This file covers the liquid-glass v2 rules (spec 2026-10-08). The example set as a whole and Paper
// are in themeExamples.test.ts.
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { contrast, hexToRgb, over } from '../../renderer/src/test/contrast'
import { examples, scanner, liquidGlassRules } from '../../__fixtures__/themeExamples'

describe('liquid-glass v2 (spec 2026-10-08)', () => {
  // Owner, 2026-10-08/09: the rail and the focused top bar paint a white film over the WebGL glass;
  // under glass-on it is 3%, and 1.5% on the top bar row, where the box's glass is brighter (none
  // made the rail, the tab and the area around the terminal one glass: no cut). Set through the
  // app's surface hooks, once (spec 2026-10-09 rail surface hooks), and only under glass-on: the
  // CSS fallback keeps the 6% --bg-surface.
  it('liquid-glass sets the rail surface hooks under glass-on only', () => {
    const css = liquidGlassRules()
    const hooks = css.filter((x) => /--rail-surface/.test(x.body))
    expect(hooks.flatMap((x) => x.selectors)).toEqual([':root[data-glass-on]'])
    const body = hooks.map((x) => x.body).join('\n')
    expect(body).toMatch(/--rail-surface:\s*rgba\(255,\s*255,\s*255,\s*0\.03\)/)
    expect(body).toMatch(/--rail-surface-top:\s*rgba\(255,\s*255,\s*255,\s*0\.015\)/)
    // No layer is styled one by one any more (and no test id is targeted for it).
    const layered = css.filter((x) =>
      x.selectors.some(
        (sel) =>
          /attention-rail'\]::(before|after)$/.test(sel) ||
          sel.includes('rail-pinned-slot') ||
          /\[data-focused-bar\]$/.test(sel)
      )
    )
    expect(layered).toEqual([])
  })
  // Owner, 2026-10-09: "some things have the white glow and others dont" — the WebGL controls are
  // lit from the TOP (the shader's glow), the overlay controls (popover rows, a dialog's or a
  // toast's buttons, still CSS) carried a corner sheen lit at the bottom-right. Under glass-on the
  // overlay sheen is the WebGL light instead: a top-down glow, no corner spots. The board's own
  // controls are cleared under glass-on, so the variable reaches only the overlay ones.
  it('liquid-glass lights the overlay controls like the WebGL ones while the glass is on', () => {
    const css = liquidGlassRules()
    const defs = css.filter((x) => /--glass-control-sheen\s*:/.test(x.body))
    const on = defs.filter((x) => x.selectors.includes(':root[data-glass-on]'))
    expect(on).toHaveLength(1)
    const sheen = /--glass-control-sheen\s*:([^;]*);/.exec(on[0]?.body ?? '')?.[1] ?? ''
    expect(sheen).toMatch(/^\s*linear-gradient\(\s*to bottom,\s*rgba\(255,\s*255,\s*255,/)
    expect(sheen).not.toMatch(/radial-gradient/)
    // The CSS fallback (glass off) keeps the corner sheen.
    expect(defs.some((x) => x.selectors.includes(':root'))).toBe(true)
  })
  // Owner, 2026-10-09: "the popover and its rows dont have the white glow the header or the
  // hamburger have". Under glass-on the popover box exposes what is behind it (brightness 2, the
  // header's exposure) and carries a top glow; its rows take a 15% white body like the WebGL
  // controls. Through variables, so a hovered or selected row keeps the same body. Drive, Warm
  // smoke: box 54 = header 54, row 85 against the controls' 89.
  it('liquid-glass gives the popover and its rows the WebGL glass body while the glass is on', () => {
    const css = liquidGlassRules()
    const on = css
      .filter((x) => x.selectors.includes(':root[data-glass-on]'))
      .map((x) => x.body)
      .join('\n')
    expect(on).toMatch(/--glass-row-fill:\s*rgba\(255,\s*255,\s*255,\s*0\.065\)/)
    expect(on).toMatch(/--glass-pop-filter:\s*var\(--glass-filter\)\s*brightness\(2\)/)
    expect(on).toMatch(/--glass-pop-glow:\s*linear-gradient\(\s*to bottom/)
    // Every row fill reads the variable (rest, hover, state), never a fixed white.
    const rowFills = css
      .filter((x) => x.selectors.some((sel) => sel.startsWith('[data-popover-item]')))
      .map((x) => /background-color:\s*([^;]+);/.exec(x.body)?.[1])
      .filter((v): v is string => v !== undefined && v.includes('--ws-fill'))
    expect(rowFills.length).toBeGreaterThanOrEqual(3)
    for (const v of rowFills) expect(v).toBe('var(--ws-fill, var(--glass-row-fill))')
    // The box and the submenu holder's blur layer read the popover filter.
    const filt = (sel: string): string =>
      css
        .filter((x) => x.selectors.includes(sel))
        .map((x) => x.body)
        .join('\n')
    expect(filt('[data-popover]')).toMatch(
      /backdrop-filter:\s*var\(--glass-pop-filter,\s*var\(--glass-filter\)\)/
    )
    expect(filt('[data-popover]:has([data-popover])::before')).toMatch(
      /backdrop-filter:\s*var\(--glass-pop-filter,\s*var\(--glass-filter\)\)/
    )
    expect(filt('[data-popover]')).toMatch(/background-image:\s*var\(--glass-pop-glow,\s*none\)/)
  })
  // Owner, 2026-10-08: the header switcher kept its workspace tint on main; the glass-on clear
  // (background: transparent on every hooked control) wiped it. It keeps --ws-fill over the glass.
  it('liquid-glass: the workspace switcher keeps its workspace tint while the WebGL glass is on', () => {
    const tinted = liquidGlassRules().filter((x) =>
      x.selectors.some(
        (sel) =>
          sel.startsWith(':root[data-glass-on] [data-glass][data-glass][data-glass]') &&
          sel.includes("[data-testid='workspace-switcher']") &&
          sel.includes(":not([role='dialog'][aria-modal='true'] *)")
      )
    )
    expect(tinted.map((x) => x.body).join('\n')).toMatch(/background-color:\s*var\(--ws-fill/)
  })
  // Drive 2026-10-09: the glass-on clear sets `content: none` on every hooked surface's ::before,
  // and the elsewhere tab's ::before is the APP's baseline strut — without it the tab's pill fell
  // to the top of the tab (y=22 against the switcher's own pill at y=27). Only the ::after clear
  // reaches the tab.
  it('liquid-glass: the glass-on clear leaves the elsewhere tab its baseline strut (::before)', () => {
    const clears = liquidGlassRules().filter(
      (x) =>
        /content:\s*none/.test(x.body) &&
        x.selectors.some((sel) =>
          sel.startsWith(':root[data-glass-on] [data-glass][data-glass][data-glass]')
        )
    )
    expect(clears.length).toBeGreaterThan(0)
    const befores = clears.flatMap((x) => x.selectors).filter((sel) => sel.endsWith('::before'))
    expect(befores.length).toBeGreaterThan(0)
    for (const sel of befores) {
      expect(sel, sel).toContain(":not([data-testid='workspace-elsewhere-tab'])")
    }
  })
  // Drive 2026-10-09: hovering the tab lit the TAB alone — its 10% film painted across the 12px it
  // tucks under the switcher, and with the switcher's blur gone under glass-on that edge showed
  // through the tint as a lighter band inside the pill. A click on the tab is a click on the
  // switcher, so a hover on it is a hover on the switcher: the switcher's hover rules (fallback
  // edge and film, glass-on tint and film) also match through `:has(> tab:hover)`, and no rule
  // lights the tab itself.
  it('liquid-glass: hovering the elsewhere tab hovers the switcher, never the tab itself', () => {
    const css = liquidGlassRules()
    const GROUP = ":has(> [data-testid='workspace-elsewhere-tab']:hover) >"
    const sels = css.flatMap((x) => x.selectors)
    expect(
      sels.filter((sel) => sel.endsWith("[data-testid='workspace-elsewhere-tab']:hover"))
    ).toEqual([])
    const switcherHover = css.filter((x) =>
      x.selectors.some(
        (sel) =>
          sel.includes("[data-testid='workspace-switcher']") &&
          sel.endsWith(':hover') &&
          !sel.includes(':has(')
      )
    )
    expect(switcherHover.length).toBeGreaterThanOrEqual(3)
    for (const rule of switcherHover) {
      expect(
        rule.selectors.some(
          (sel) => sel.includes(GROUP) && sel.includes("[data-testid='workspace-switcher']")
        ),
        rule.selectors.join(',\n')
      ).toBe(true)
    }
    const controlHover = css.filter((x) =>
      x.selectors.some(
        (sel) =>
          sel.startsWith(":root[data-glass-on] [data-glass='control']") && sel.endsWith(':hover')
      )
    )
    expect(controlHover.length).toBeGreaterThan(0)
    for (const sel of controlHover.flatMap((x) => x.selectors)) {
      expect(sel, sel).toContain(":not([data-testid='workspace-elsewhere-tab'])")
    }
  })
  // Owner, 2026-10-08: the overlay glass follows the pointer like the board. The app writes
  // --glass-light on the one surface under it; only that element's rim changes (at rest, today's).
  it('liquid-glass lights the overlay rims from --glass-light, only where it is set', () => {
    const css = liquidGlassRules()
    const lit = css.filter((x) =>
      x.selectors.some((sel) => sel.includes("[style*='--glass-light']"))
    )
    const sels = lit.flatMap((x) => x.selectors)
    for (const want of [
      "button[data-variant='primary'][style*='--glass-light']:not(:disabled)::before",
      "button[data-variant='secondary'][style*='--glass-light']:not(:disabled):not([data-lit])::before",
      "button[data-variant='primary'][style*='--glass-light']:not(:disabled)::after",
      "button[data-variant='secondary'][style*='--glass-light']:not(:disabled):not([data-lit])::after",
      "[data-toast][style*='--glass-light']::after"
    ]) {
      expect(sels, want).toContain(want)
    }
    const body = lit.map((x) => x.body).join('\n')
    expect(body).toMatch(/cos\(var\(--glass-light\)\)/)
    expect(body).toMatch(/sin\(var\(--glass-light\)\)/)
    // Never on the board: under glass-on the WebGL layer draws those, and their rings are off.
    expect(sels.every((sel) => !sel.includes('data-glass'))).toBe(true)
  })
  // Owner, 2026-10-12: a popover row's rim is the WebGL control's, redone in CSS. Its light is
  // --glass-light where the app sets it, else the resting top-left (135deg); rim and glow follow it.
  it('liquid-glass: a popover row lights its WebGL-style rim and glow from --glass-light', () => {
    const css = liquidGlassRules()
    const find = (sel: string): string =>
      css
        .filter((x) => x.selectors.includes(sel))
        .map((x) => x.body)
        .join('\n')
    expect(find('[data-popover-item]:not(:disabled)')).toMatch(
      /--row-light:\s*var\(--glass-light,\s*135deg\)/
    )
    expect(find('[data-popover-item]:not(:disabled)::before')).toMatch(
      /box-shadow:\s*inset calc\(-5\.66px \* cos\(var\(--row-light\)\)\)/
    )
    const rim = find('[data-popover-item]:not(:disabled)::after')
    for (const side of ['t', 'r', 'b', 'l']) expect(rim).toContain(`var(--row-lit-${side})`)
  })
  // Drive 2026-10-08: the field hook is on the icon wrapper, which had no radius, so the WebGL rim
  // was square while the input still painted its own rounded box on top.
  it('liquid-glass: the search field glass takes the input radius and the input clears under it', () => {
    const css = liquidGlassRules()
    const find = (sel: string): string =>
      css
        .filter((x) => x.selectors.includes(sel))
        .map((x) => x.body)
        .join('\n')
    expect(find("[data-glass='field']")).toMatch(/border-radius:\s*var\(--rounded-md\)/)
    const input = find(":root[data-glass-on] [data-glass='field'][data-glass][data-glass] input")
    expect(input).toMatch(/background:\s*transparent/)
    expect(input).toMatch(/border-color:\s*transparent/)
  })
  it('liquid-glass describes the canvas glass and the 16px gap', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok && r.bundle.glass?.surfaces.card).toEqual({
      refract: 8,
      edge: 12,
      blur: 8,
      chroma: 0.15,
      tint: '#0e0e10',
      tintAmount: 0.36,
      // 0.26, not the canvas 0.3: owner, 2026-10-08 ("a little less bright").
      rim: 0.26,
      // +0.4 over the canvas (1.4): owner, 2026-10-09 ("add brightness to the app"). Exposure
      // brightens what shows through the glass without the white fog lift/glow add.
      exposure: 1.8,
      // lift/glow a little lower than the canvas: owner, 2026-10-08 ("a tiny bit more transparent");
      // glow lower again, 2026-10-09 ("decrease the overall white inner glow"), and again ("bring
      // the white glow lower a little"), and again ("its too white"): lift too, both add white;
      // and once more ("reduce the white one more time").
      lift: 0.013,
      glow: 0.008,
      lightFollowsCursor: true
    })
    expect(r.ok && r.bundle.glass?.surfaces.column.tintNeedsYou).toBe('#2a2414')
    expect(
      r.ok &&
        Object.fromEntries(
          Object.entries(r.bundle.glass?.surfaces ?? {}).map(([k, v]) => [k, v.exposure])
        )
    ).toEqual({ header: 2, column: 1.9, card: 1.8, control: 2, field: 2 })
    expect(
      r.ok &&
        Object.fromEntries(
          Object.entries(r.bundle.glass?.surfaces ?? {}).map(([k, v]) => [k, v.glow])
        )
    ).toEqual({ header: 0.012, column: 0.005, card: 0.008, control: 0.01, field: 0.01 })
    // Owner, 2026-10-08: the big bodies (header, columns, the focused box) keep a fixed light;
    // the small surfaces follow the pointer.
    expect(r.ok && r.bundle.glass?.surfaces.header.lightFollowsCursor).toBe(false)
    expect(r.ok && r.bundle.glass?.surfaces.column.lightFollowsCursor).toBe(false)
    expect(r.ok && r.bundle.glass?.surfaces.card.lightFollowsCursor).toBe(true)
    expect(r.ok && r.bundle.css).toMatch(/--gutter:\s*16px/)
    expect(r.ok && r.bundle.css).toMatch(/--idle:\s*#9a9aa0/)
  })

  // Spec D.1: text on lit glass keeps 4.5:1. Grounds from canvas-capture.md: the needs-you hero card
  // (#3d3932), a calm card (#232326) and the brightest lit card measured over a photo (#3d3d3e).
  it('liquid-glass text tokens read 4.5:1 on every lit card ground', () => {
    const t = (
      JSON.parse(readFileSync(resolve(examples, 'liquid-glass/theme.json'), 'utf8')) as {
        tokens: Record<string, string>
      }
    ).tokens
    const alpha = (v: string | undefined): number => {
      const m = /^rgba\(235,\s*235,\s*245,\s*([\d.]+)\)$/.exec(v ?? '')
      if (m === null || m[1] === undefined) throw new Error(`not an ink token: ${v}`)
      return Number(m[1])
    }
    for (const ground of ['#3d3932', '#232326', '#3d3d3e']) {
      for (const ink of ['text-secondary', 'text-muted']) {
        const g = hexToRgb(ground)
        expect(
          contrast(over([235, 235, 245], alpha(t[ink]), g), g),
          `${ink} on ${ground}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
    // The real glass (drive 2026-10-09, exposure +0.4, all six wallpapers): the brightest grounds
    // behind card text, solved from the measured ratios — a lit card on Warm smoke (#515151) and a
    // calm card on Lake (#414141), whose text also carries the card's 0.82 opacity.
    for (const [ground, opacity] of [
      ['#515151', 1],
      ['#414141', 0.82]
    ] as const) {
      const g = hexToRgb(ground)
      expect(
        contrast(over([235, 235, 245], alpha(t['text-muted']) * opacity, g), g),
        `text-muted on ${ground} at ${opacity}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('liquid-glass clears the hooked surfaces only while the WebGL glass is on, above the old rules', () => {
    const on = liquidGlassRules().filter((x) =>
      x.selectors.some((sel) =>
        sel.startsWith(':root[data-glass-on] [data-glass][data-glass][data-glass]')
      )
    )
    const body = on.map((x) => x.body).join('\n')
    expect(body).toMatch(/background:\s*transparent/)
    expect(body).toMatch(/backdrop-filter:\s*none/)
    expect(body).toMatch(/(^|[\s;])filter:\s*none/)
    expect(body).toMatch(/content:\s*none/)
    for (const sel of on.flatMap((x) => x.selectors)) {
      expect(sel, sel).toContain(":not([role='dialog'][aria-modal='true'] *)")
    }
  })

  it('liquid-glass column header: mark shown, separator hidden, no tick or divider, canvas sizes', () => {
    const css = liquidGlassRules()
    const find = (sel: string): string =>
      css
        .filter((x) => x.selectors.includes(sel))
        .map((x) => x.body)
        .join('\n')
    expect(find('[data-column-header] [data-column-mark]')).toMatch(/display:\s*inline-block/)
    expect(find('[data-column-header] [data-count-sep]')).toMatch(/display:\s*none/)
    expect(find('[data-column-header]')).toMatch(/border-top-color:\s*transparent/)
    expect(find('[data-column-header]')).toMatch(/border-bottom-color:\s*transparent/)
    expect(find("[data-column-header] [data-testid='column-count']")).toMatch(
      /font-size:\s*12px[\s\S]*font-weight:\s*500/
    )
    expect(find("[data-column-header][data-prominent='true'] [data-testid='column-name']")).toMatch(
      /font-size:\s*15px[\s\S]*font-weight:\s*700/
    )
  })

  it("liquid-glass drops the coloured card edge (beats the app's .root[data-status] rule)", () => {
    const body = liquidGlassRules()
      .filter((x) => x.selectors.includes("[data-glass='card'][data-glass][data-status]"))
      .map((x) => x.body)
      .join('\n')
    expect(body).toMatch(/border-left-color:\s*transparent/)
  })

  it('liquid-glass has reduced-transparency and more-contrast rules', () => {
    const raw = readFileSync(resolve(examples, 'liquid-glass/theme.css'), 'utf8')
    expect(raw).toContain('@media (prefers-reduced-transparency: reduce)')
    expect(raw).toContain('@media (prefers-contrast: more)')
  })
})
