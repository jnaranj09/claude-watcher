// The docs examples ARE theme folders: the scanner reads them as an operator's themes folder.
// This file covers the example set as a whole (scan, manifests, tokens, contrast, Paper, Liquid Glass v1);
// the liquid-glass v2 surface rules are in themeExamples.liquidGlassV2.test.ts.
import { resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { TOKENS } from '../../shared/theme/tokens'
import { xtermTheme, xtermLightTheme } from '../../shared/theme/xtermTheme'
import { contrast, hexToRgb } from '../../renderer/src/test/contrast'
import { THEME_ASSETS_MAX_BYTES, ThemeManifestSchema } from '../../shared/schemas/theme'
import { examples, scanner, liquidGlassRules, themeRules } from '../../__fixtures__/themeExamples'

function paperManifest(): { tokens: Record<string, string>; terminal: unknown } {
  return JSON.parse(readFileSync(resolve(examples, 'paper/theme.json'), 'utf8')) as {
    tokens: Record<string, string>
    terminal: unknown
  }
}

/** Every body whose selector list holds `selector`, joined. */
function bodyOf(id: 'liquid-glass' | 'paper', selector: string): string {
  return themeRules(id)
    .filter((r) => r.selectors.includes(selector))
    .map((r) => r.body)
    .join('\n')
}

// Every popover box liquid-glass styles — Popover stamps `data-popover` on menus, lists, the
// `+ New session` popover and the expander alike.
const POPOVERS = ['[data-popover]']

// Header buttons liquid-glass blurs from themselves: leaves (nothing inside them blurs), and the
// workspace menu is their sibling, not their child.
const LEAF_BUTTONS = [
  "[data-testid='workspace-switcher']",
  "[data-testid='workspace-elsewhere-tab']",
  "button[data-variant='primary']:not(:disabled)",
  "button[data-variant='secondary']:not(:disabled):not([data-lit])",
  'button[data-variant][data-lit]:not(:disabled)'
]

describe('docs/themes/examples', () => {
  it('scan lists the three examples, none broken, sorted by name', () => {
    expect(scanner.scan()).toEqual([
      { id: 'builtin-dark', name: 'Built-in dark', author: 'claude-watcher', colorScheme: 'dark' },
      {
        id: 'liquid-glass',
        name: 'Liquid Glass',
        author: 'claude-watcher',
        colorScheme: 'dark',
        wallpapers: [
          { id: 'lake', name: 'Lake' },
          { id: 'bridge', name: 'Bridge' },
          { id: 'subway', name: 'Subway' },
          { id: 'graphite', name: 'Graphite' },
          { id: 'aurora', name: 'Aurora gradient' },
          { id: 'smoke', name: 'Warm smoke' }
        ]
      },
      { id: 'paper', name: 'Paper', author: 'claude-watcher', colorScheme: 'light' }
    ])
  })
  it('liquid-glass ships six lossless WebP wallpapers under the asset cap, Lake first', () => {
    const dir = resolve(examples, 'liquid-glass')
    const manifest = ThemeManifestSchema.parse(
      JSON.parse(readFileSync(resolve(dir, 'theme.json'), 'utf8'))
    )
    const files = (manifest.wallpapers ?? []).map((w) => w.file)
    expect((manifest.wallpapers ?? []).map((w) => w.id)).toEqual([
      'lake',
      'bridge',
      'subway',
      'graphite',
      'aurora',
      'smoke'
    ])
    expect(files.every((f) => f.endsWith('.webp'))).toBe(true)
    const total = files.reduce((n, f) => n + statSync(resolve(dir, f)).size, 0)
    expect(total).toBeLessThanOrEqual(THEME_ASSETS_MAX_BYTES)
    for (const f of files) {
      const head = readFileSync(resolve(dir, f)).subarray(0, 16)
      expect(head.subarray(0, 4).toString('latin1')).toBe('RIFF')
      expect(head.subarray(12, 16).toString('latin1')).toBe('VP8L') // lossless chunk
    }
  })
  it('builtin-dark equals TOKENS + xtermTheme', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(examples, 'builtin-dark/theme.json'), 'utf8')
    ) as { tokens: unknown; terminal: unknown }
    expect(manifest.tokens).toEqual(TOKENS)
    expect(manifest.terminal).toEqual(xtermTheme)
    const r = scanner.load('builtin-dark')
    expect(r.ok).toBe(true)
  })
  it('liquid-glass composes with a transparent terminal and backdrop-filter in its CSS', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.terminal.allowTransparency).toBe(true)
      expect(r.bundle.css).toContain('backdrop-filter')
      expect(r.bundle.css.startsWith(':root {')).toBe(true)
    }
  })
  // LIQUID glass carries no grain: a noise tile is the acrylic (frosted) recipe and read matte.
  // The material is the lit rim instead. The ground is the chosen WALLPAPER (spec 2026-09-24):
  // the app inlines exactly one as --theme-wallpaper and body is its only consumer; the theme CSS
  // references no asset of its own.
  // The one other url() is `url(#cw-text-refraction)`: an SVG filter the app ships in index.html,
  // a reference into the page, never a file.
  it('liquid-glass has no grain, no sheen, and one image: the chosen wallpaper on body only', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.wallpaperId).toBe('lake')
      expect(r.bundle.css.match(/url\("/g)).toHaveLength(1)
      expect(r.bundle.css).toContain('--theme-wallpaper: url("data:image/webp;base64,')
      const urls = liquidGlassRules().flatMap((rule) => rule.body.match(/url\([^)]*\)/g) ?? [])
      expect([...new Set(urls)]).toEqual(['url(#cw-text-refraction)'])
      const users = liquidGlassRules().filter((rule) =>
        rule.body.includes('var(--theme-wallpaper)')
      )
      expect(users.map((rule) => rule.selectors)).toEqual([['body']])
      expect(r.bundle.css).toContain('--glass-rim:')
      expect(r.bundle.css).toContain('--glass-fill:')
      expect(r.bundle.css).not.toContain('--glass-sheen')
    }
  })
  it.each([
    ['lake', 'image/webp'],
    ['bridge', 'image/webp'],
    ['subway', 'image/webp'],
    ['graphite', 'image/webp'],
    ['aurora', 'image/webp'],
    ['smoke', 'image/webp']
  ])('liquid-glass loads with wallpaper %s', (id, mime) => {
    const r = scanner.load('liquid-glass', id)
    expect(r.ok && r.bundle.wallpaperId).toBe(id)
    expect(r.ok && r.bundle.css).toContain(`--theme-wallpaper: url("data:${mime};base64,`)
  })
  // ONE material. The header, the columns and the popovers all take `--glass-fill` and the same
  // `--glass-filter`; three recipes (a smoky black header, milky dialogs under a sheen, black
  // popovers) read as three materials side by side (2026-09-23). The ONE exception is a MODAL
  // panel: it sits over the scrim and read too dark through 3% glass (2026-09-25), so it takes the
  // brighter `--glass-fill-modal` / `--glass-filter-modal` pair — and nothing else does.
  it('liquid-glass paints every surface with the one --glass-fill and the one blur', () => {
    const rules = liquidGlassRules()
    const fillOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    for (const sel of [
      "[data-testid='app-header']",
      'section[data-column]:not([data-hero-accent])',
      ...POPOVERS
    ]) {
      expect(fillOf(sel), sel).toMatch(/background(-color)?:\s*var\(--glass-fill\);/)
    }
    const MODAL_PANELS = [
      "[role='dialog'][aria-modal='true'] > *",
      "[data-testid='settings-panel']"
    ]
    for (const sel of MODAL_PANELS) {
      expect(fillOf(sel), sel).toMatch(/background(-color)?:\s*var\(--glass-fill-modal\);/)
      expect(fillOf(`${sel}::before`), sel).toMatch(
        /backdrop-filter:\s*var\(--glass-filter-modal\);/
      )
    }
    const modalUsers = rules
      .filter((r) => /var\(--glass-(fill|filter)-modal\)/.test(r.body))
      .flatMap((r) => r.selectors)
    expect(new Set(modalUsers)).toEqual(
      new Set([...MODAL_PANELS, ...MODAL_PANELS.map((sel) => `${sel}::before`)])
    )
    const filters = rules.flatMap((r) => [...r.body.matchAll(/backdrop-filter:\s*([^;]+);/g)])
    expect(new Set(filters.map((m) => m[1]))).toEqual(
      new Set([
        'var(--glass-filter)',
        'var(--glass-filter-modal)',
        'none',
        'blur(12px)',
        // A popover reads the glass-on exposure when set, else the one blur.
        'var(--glass-pop-filter, var(--glass-filter))'
      ])
    )
  })
  // An element with its own `backdrop-filter` is a BACKDROP ROOT: a blurred element inside it
  // blurs only what that element painted, never the page — the header's border and a dialog's
  // buttons showed through the menus and dropdowns sharp. So a CONTAINER blurs from a `::before`
  // layer, never from itself. Only the popovers — leaves, nothing inside them blurs — blur from
  // themselves.
  it('liquid-glass blurs only from ::before layers, never from a container itself', () => {
    const rules = liquidGlassRules()
    const blurring = rules
      .filter((r) => /(^|[\s;])backdrop-filter:(?!\s*none\b)/.test(r.body))
      .flatMap((r) => r.selectors)
    expect(blurring.length).toBeGreaterThan(0)
    expect(blurring.filter((s) => !s.endsWith('::before'))).toEqual([...POPOVERS, ...LEAF_BUTTONS])
    // A modal's panel is its ONLY child, and it is not always a <div>: "Name this session" is a
    // <form>, and a `> div` rule left it with no glass at all.
    expect(blurring).toContain("[role='dialog'][aria-modal='true'] > *::before")
    // "Terminal exited." covers the dead terminal's last output; a bare tint left it readable.
    expect(blurring).toContain("[data-testid='dead-terminal']::before")
    // `+ New session` is a `role="dialog"` too, but a POPOVER, not a modal: a panel rule on
    // `[role='dialog'] > div` turned its template list into a square slab of glass. Every real
    // modal carries `aria-modal="true"`; the popover does not.
    const dialogSelectors = rules
      .flatMap((r) => r.selectors)
      .filter((s) => s.includes("[role='dialog']"))
    expect(dialogSelectors.length).toBeGreaterThan(0)
    expect(
      dialogSelectors.filter((s) => !s.includes("[role='dialog'][aria-modal='true']"))
    ).toEqual([])
  })
  // With the GPU off, a backdrop blur samples only inside its own box and reads "nothing" past
  // the edge, so the sharp page shows through near every edge of a glass panel. The layer of each
  // modal panel therefore bleeds past the box and is masked back to it.
  it('liquid-glass bleeds each modal panel blur layer past its box and masks it back', () => {
    const overlays = [
      "[role='dialog'][aria-modal='true'] > *::before",
      "[data-testid='settings-panel']::before"
    ]
    const bleeding = liquidGlassRules().filter(
      (r) => overlays.every((o) => r.selectors.includes(o)) && /--bleed:/.test(r.body)
    )
    expect(bleeding).toHaveLength(1)
    const body = bleeding[0]?.body ?? ''
    expect(body).toMatch(/(^|[\s;])inset:\s*calc\(-1 \* var\(--bleed\)\);/)
    expect(body).toMatch(/(^|[\s;])mask:\s*linear-gradient\([^)]*\) content-box;/)
  })
  // Popovers are GLASS again since the GPU came back (2026-09-22): with GPU compositing their
  // blur is even out to the edge. They were opaque while the software compositor faded it out.
  it('liquid-glass blurs every popover', () => {
    const glass = liquidGlassRules().filter(
      (r) => POPOVERS.every((p) => r.selectors.includes(p)) && /backdrop-filter:/.test(r.body)
    )
    expect(glass).toHaveLength(1)
    // The shared `--glass-filter` (declared on :root), itself a blur — through the glass-on
    // popover filter when it is set.
    expect(glass[0]?.body).toMatch(
      /(^|[\s;])backdrop-filter:\s*var\(--glass-pop-filter,\s*var\(--glass-filter\)\);/
    )
    const root = liquidGlassRules()
      .filter((r) => r.selectors.includes(':root'))
      .map((r) => r.body)
      .join('\n')
    expect(root).toMatch(/--glass-filter:\s*blur\(\d+px\)/)
    // An opaque colour on the same rule would hide the blur it pays for.
    expect(glass[0]?.body).not.toMatch(/background(-color)?:/)
    // The expander's list is Popover.List — not `[data-popover]` — so no theme rule gives it a box.
    expect(
      liquidGlassRules()
        .flatMap((r) => r.selectors)
        .filter((s) => s.includes('expander-box'))
    ).toEqual([])
  })

  // Every popover ROW is a glass bubble (operator, 2026-10-01): a tint-aware fill and, since
  // 2026-10-05, THE CONTROL EDGE the buttons use (no visible border, no shallow rim) — never its own
  // blur (the box is the row's backdrop root).
  it('liquid-glass draws every popover row as a bubble, from the Popover hooks only', () => {
    const rules = liquidGlassRules()
    const row = rules.filter((r) => r.selectors.includes('[data-popover-item]'))
    const body = row.map((r) => r.body).join('\n')
    expect(body).toMatch(/background(-color)?:\s*var\(--ws-fill, var\(--glass-row-fill\)\);/)
    expect(
      rules
        .filter((r) => r.selectors.includes(':root'))
        .map((r) => r.body)
        .join('\n')
    ).toMatch(/--glass-row-fill:\s*rgba\(255, 255, 255, 0\.05\);/)
    expect(body).not.toMatch(/--glass-rim-row/)
    expect(body).not.toMatch(/backdrop-filter/)
    const edge = rules
      .filter((r) => r.selectors.includes('[data-popover-item]:where(:not(:disabled))'))
      .map((r) => r.body)
      .join('\n')
    expect(edge).toMatch(/border-color:\s*transparent;/)
    const root = rules
      .filter((r) => r.selectors.includes(':root'))
      .map((r) => r.body)
      .join('\n')
    expect(root).toMatch(/--glass-rim-row:\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.3\)/)
    // The header shares the one shallow rim.
    const header = rules
      .filter((r) => r.selectors.includes("[data-testid='app-header']"))
      .map((r) => r.body)
      .join('\n')
    expect(header).toMatch(/box-shadow:\s*var\(--glass-rim-row\), var\(--shadow-pop\);/)
    // States: a brighter border, from ARIA.
    for (const s of [
      "[data-popover-item][aria-selected='true']",
      "[data-popover-item][aria-checked='true']",
      "[data-popover-item][aria-expanded='true']",
      '[data-popover-item][data-active]',
      "[data-popover-item][aria-selected='true']:hover",
      "[data-popover-item][aria-checked='true']:hover",
      "[data-popover-item][aria-expanded='true']:hover",
      '[data-popover-item][data-active]:hover'
    ]) {
      expect(
        rules.some(
          (r) =>
            r.selectors.includes(s) &&
            /border-color:\s*var\(--text-primary\);/.test(r.body) &&
            /background-color:\s*var\(--ws-fill, var\(--glass-row-fill\)\);/.test(r.body)
        ),
        s
      ).toBe(true)
    }
    // Hover draws no outline (an outline is for keyboard focus only), and never lands on a state row.
    const hover = rules.filter((r) =>
      r.selectors.some((x) => x.startsWith('[data-popover-item]:hover'))
    )
    expect(hover.map((r) => r.body).join('\n')).toMatch(/border-color:\s*transparent;/)
    for (const st of [
      "[aria-selected='true']",
      "[aria-checked='true']",
      "[aria-expanded='true']",
      '[data-active]'
    ]) {
      expect(
        hover.every((r) => r.selectors.every((x) => x.replace(/\s+/g, '').includes(`:not(${st})`))),
        st
      ).toBe(true)
    }
    // No popover is reached by test id or by the retired tag-menu hooks any more.
    const all = rules.flatMap((r) => r.selectors).join('\n')
    for (const gone of ["new-session-menu'", '[data-tag-menu', "expander-box'"]) {
      expect(all).not.toContain(gone)
    }
  })

  // A popover that HOLDS a popover (the ☰ menu and its Tags submenu) is a container: it blurs from
  // `::before`, or the submenu's blur reads only the menu's paint.
  it('liquid-glass blurs a popover holding a popover from ::before', () => {
    const rules = liquidGlassRules()
    const outer = rules.filter((r) => r.selectors.includes('[data-popover]:has([data-popover])'))
    expect(outer.map((r) => r.body).join('\n')).toMatch(/(^|[\s;])backdrop-filter:\s*none;/)
    const layer = rules.filter((r) =>
      r.selectors.includes('[data-popover]:has([data-popover])::before')
    )
    expect(layer.map((r) => r.body).join('\n')).toMatch(
      /backdrop-filter:\s*var\(--glass-pop-filter,\s*var\(--glass-filter\)\);/
    )
  })

  // A popover is GLASS like the header: the token's white film + the sheen's dark bottom band read
  // as a flat grey card beside the glass header, and the header's own dark fill read as a black
  // slab over the near-black board (a blur of black is black). A FAINT WHITE tint lifts it. The
  // fill sits in its own rule (the blur rule must carry no colour) and the sheen is off the
  // popovers. NO rim and no border (operator, 2026-10-05): the rows carry the control edge, and a
  // rim around them read as a box around boxes. The rim token stays for the toast.
  it('liquid-glass gives every popover a faint white glass fill and no rim, no sheen', () => {
    const rules = liquidGlassRules()
    const popoverRules = rules.filter((r) => POPOVERS.every((p) => r.selectors.includes(p)))
    const smoky = popoverRules.filter((r) => /background-color:/.test(r.body))
    expect(smoky).toHaveLength(1)
    expect(smoky[0]?.body).toMatch(/background-color:\s*var\(--glass-fill\);/)
    expect(smoky[0]?.body).not.toMatch(/backdrop-filter/)
    expect(popoverRules.map((r) => r.body).join('\n')).not.toMatch(/sheen/)
    expect(smoky[0]?.body).toMatch(/border-color:\s*transparent;/)
    const rim = popoverRules.filter((r) => /box-shadow:/.test(r.body))
    expect(rim).toHaveLength(1)
    expect(rim[0]?.body).toMatch(/box-shadow:\s*var\(--shadow-pop\);/)
    const root = rules
      .filter((r) => r.selectors.includes(':root'))
      .map((r) => r.body)
      .join('\n')
    expect(root).toMatch(/--glass-rim-pop:\s*inset 1px 1px 0 rgba\([^)]*\), inset -1px -1px 0 rgba/)
  })
  // Toasts had no rule at all and kept the token's flat fill (operator, 2026-10-01: "the toasts
  // don't have blur"). They take the popover's fill, border and rim, but a toast HOLDS a blurring
  // control (its action is a primary Button), so it is a container: it blurs from `::before`,
  // never from itself, or the action's blur would read only the toast's paint.
  it('liquid-glass draws every toast as popover glass, blurring from ::before', () => {
    const rules = liquidGlassRules()
    const bodyOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    const toast = bodyOf('[data-toast]')
    expect(toast).toMatch(/background(-color)?:\s*var\(--glass-fill\);/)
    // The CONTROL EDGE, not the directional rim (operator, 2026-10-06: "only the corners look
    // bright … it doesn't look like the standard of the buttons"): the rim's two offset inset lines
    // and the 6% border overlapped on the curve. No visible border, the buttons' soft dark shadow,
    // and ONE even ring on `::after` (`::before` is the blur layer).
    expect(toast).toMatch(/border-color:\s*transparent;/)
    expect(toast).toMatch(/box-shadow:\s*1px 1px 1px rgba\(0, 0, 0, 0\.5\),\s*var\(--shadow-pop\);/)
    expect(toast).not.toContain('--glass-rim')
    const ring = bodyOf('[data-toast]::after')
    expect(ring).toMatch(/inset:\s*-1px;/)
    expect(ring).toMatch(/padding:\s*1px;/)
    expect(ring).toMatch(/border-radius:\s*inherit;/)
    expect(ring).toMatch(/content-box exclude/)
    // Directional like the button: the top line lit at the left, the bottom line at the right.
    expect(ring).toMatch(/linear-gradient\(to right, rgba\(255, 255, 255, 0\.35\)[^)]*\)\) top/)
    expect(ring).toMatch(/linear-gradient\(to left, rgba\(255, 255, 255, 0\.35\)[^)]*\)\) bottom/)
    expect(ring).toMatch(/radial-gradient\(circle at 0 0/)
    expect(toast).toMatch(/position:\s*relative;/)
    expect(toast).toMatch(/isolation:\s*isolate;/)
    expect(toast).not.toMatch(/backdrop-filter/)
    const layer = bodyOf('[data-toast]::before')
    expect(layer).toMatch(/(^|[\s;])backdrop-filter:\s*var\(--glass-filter\);/)
    expect(layer).toMatch(/-webkit-backdrop-filter:\s*var\(--glass-filter\);/)
    expect(layer).toMatch(/z-index:\s*-1;/)
    // No rule on any toast selector (a kind, a hover) brings back the sheen or a self-blur.
    const anyToast = rules
      .filter((r) =>
        r.selectors.some((s) => s.startsWith('[data-toast') && !s.endsWith('::before'))
      )
      .map((r) => r.body)
      .join('\n')
    expect(anyToast).not.toContain('--glass-sheen')
    expect(anyToast).not.toMatch(/backdrop-filter/)
  })
  // The grey count pill is ONE look wherever it sits: the button, each menu row AND the elsewhere
  // tab behind the button. The tab's pill was left out and kept the token's white 28% over glass,
  // so the same "1" read in two colours side by side (operator, 2026-10-01).
  it('liquid-glass draws every grey count pill solid, the elsewhere tab included', () => {
    const rules = liquidGlassRules()
    for (const sel of [
      "[data-testid='workspace-card-count']",
      "[data-testid='workspace-elsewhere-count']",
      "[data-testid^='workspace-row-count-']"
    ]) {
      const body = rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
      expect(body, sel).toMatch(/background:\s*#3a3e48;/)
      expect(body, sel).toMatch(/color:\s*#ffffff;/)
      expect(body, sel).toMatch(/box-shadow:\s*inset 0 0 0 1px rgba\(255, 255, 255, 0\.22\);/)
    }
  })
  // Every terminal panel (the frame, or claude's half and the shell while split) is a bubble like
  // the header and the columns: rim, directional ring, faint
  // border. Its fill stays the token's darker `--bg-terminal` (glyphs need it), so no `--glass-fill`.
  // The rim is the SHALLOW one: the 14px glow of `--glass-rim` lit a wide band along every edge and
  // the plain middle read as a darker, smaller box inside the frame (operator, 2026-10-01).
  it('liquid-glass gives the terminal frame the bubble rim and ring, not the glass fill', () => {
    const rules = liquidGlassRules()
    const frame = rules
      .filter((r) => r.selectors.includes('[data-terminal-panel]'))
      .map((r) => r.body)
      .join('\n')
    expect(frame).toMatch(/box-shadow:\s*var\(--glass-rim-row\), var\(--shadow-pop\);/)
    expect(frame).not.toContain('--glass-fill')
    const ring = rules
      .filter((r) => r.selectors.includes('[data-terminal-panel]::after'))
      .map((r) => r.body)
      .join('\n')
    expect(ring).toMatch(/conic-gradient\(/)
    expect(ring).toMatch(/pointer-events:\s*none;/)
    expect(ring).not.toMatch(/z-index/)
  })
  // Primary and secondary Buttons are the switcher's glass: their own blur and THE CONTROL EDGE
  // (2026-10-04/05) — no visible border, a soft dark shadow down-right, a lit top ring on `::before`
  // and a lit bottom ring on `::after`, so the top edge is ONE line (border + `--glass-rim`'s top
  // inset drew two, which read as blurry). The fill colour is untouched (primary's raised fill vs
  // secondary's clear one is what tells them apart; a clear secondary carries only a 0.4% film the
  // refraction filter needs as a shape), and a lit button (opaque white, its own border) is
  // excluded. All of them carry the corner sheen and the text's refracted light.
  it('liquid-glass gives primary and secondary buttons the switcher glass, fill untouched', () => {
    const rules = liquidGlassRules()
    const bodyOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    const edged = ["[data-testid='workspace-switcher']", ...LEAF_BUTTONS.slice(2, 4)]
    for (const sel of edged) {
      const body = bodyOf(sel)
      expect(body, sel).toMatch(/border-color:\s*transparent;/)
      expect(body, sel).toMatch(/box-shadow:\s*1px 1px 1px rgba\(0, 0, 0, 0\.25\);/)
      expect(body, sel).not.toMatch(/--glass-rim/)
      expect(body, sel).toMatch(/background-image:\s*var\(--glass-control-sheen\);/)
      expect(body, sel).toMatch(/filter:\s*url\(#cw-text-refraction\);/)
      for (const [pseudo, dir] of [
        ['::before', 'to bottom'],
        ['::after', 'to top']
      ] as const) {
        const ring = bodyOf(`${sel}${pseudo}`)
        expect(ring, sel + pseudo).toMatch(/inset:\s*-1px;/)
        expect(ring, sel + pseudo).toMatch(new RegExp(`linear-gradient\\(\\s*${dir}`))
        expect(ring, sel + pseudo).toMatch(/pointer-events:\s*none;/)
      }
    }
    for (const sel of LEAF_BUTTONS.slice(2, 4)) {
      const body = bodyOf(sel)
      expect(body, sel).toMatch(/backdrop-filter:\s*var\(--glass-filter\);/)
      expect(body, sel).not.toMatch(/background:/)
    }
    expect(LEAF_BUTTONS.slice(2).find((s) => s.includes('secondary'))).toContain(':not([data-lit])')
  })
  // A LIT toggle is glass too: a translucent white fill, not the app's opaque one, with the same
  // blur and rim, and it STAYS lit on hover (a hover that dropped the fill kept the dark lit ink
  // and blanked the Filter button).
  it('liquid-glass draws a lit button as translucent glass that stays lit on hover', () => {
    const rules = liquidGlassRules()
    const bodyOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    const lit = bodyOf('button[data-variant][data-lit]:not(:disabled)')
    expect(lit).toMatch(/background:\s*rgba\(242, 244, 248, 0\.\d+\);/)
    expect(lit).toMatch(/backdrop-filter:\s*var\(--glass-filter\);/)
    expect(lit).toMatch(/box-shadow:\s*var\(--glass-rim\);/)
    const hover = bodyOf('button[data-variant][data-lit]:hover:not(:disabled)')
    expect(hover).toMatch(/background:\s*rgba\(242, 244, 248, 0\.\d+\);/)
  })
  // The focused view's body (rail + terminal column) is ONE bubble like the header: inset from the
  // window by padding on its absolute layer (a margin on the 100%-tall body would overflow), and
  // rounded with a clip so the rail's surface follows the corners.
  it('liquid-glass floats the focused body as one rounded, inset bubble', () => {
    const rules = liquidGlassRules()
    const body = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    expect(body("[data-testid='focused-layer']")).toMatch(
      /padding:\s*0 var\(--inset-compact-x\) var\(--inset-compact-x\);/
    )
    const bubble = body("[data-testid='focused-session']")
    expect(bubble).toMatch(/border-radius:\s*var\(--rounded-lg\);/)
    expect(bubble).toMatch(/overflow:\s*clip;/)
    expect(bubble).not.toMatch(/margin/)
  })
  // `data-column` is on the board's column <section> AND on each rail status group (a <div>). A
  // bare `[data-column]` bubble rule drew a square glass box (rim, blur, shadow) around every
  // group of the focused view's rail.
  it('liquid-glass scopes the column bubble to the board <section>, not the rail groups', () => {
    const selectors = liquidGlassRules().flatMap((r) => r.selectors)
    const column = selectors.filter((s) => s.includes('[data-column]'))
    expect(column.length).toBeGreaterThan(0)
    expect(column.filter((s) => !s.startsWith('section[data-column]'))).toEqual([])
  })
  // `--bg-base` is transparent here, so the app's hover fill (`--bg-base`) left a hovered rail row
  // on the rail's surface instead of the active tab's dark ground. The theme darkens it back.
  it('liquid-glass darkens a hovered resting rail row to the active tab tone', () => {
    const hover = liquidGlassRules()
      .filter((r) =>
        r.selectors.includes("[data-testid='attention-rail'] button[data-testid='rail-row']:hover")
      )
      .map((r) => r.body)
      .join('\n')
    expect(hover).toMatch(/background:\s*rgba\(0, 0, 0, 0\.\d+\);/)
  })
  it('paper is a light theme with its own CSS and no glass', () => {
    const r = scanner.load('paper')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.colorScheme).toBe('light')
      expect(r.bundle.css).toMatch(/^:root \{/)
      expect(r.bundle.css).toContain("button[data-variant='primary']")
      expect(r.bundle.css).not.toContain('backdrop')
    }
  })
  const PAPER_HEAD = '#f7f8f9' // the column header and Settings category rail fill (theme.css)
  it('paper text reads on every ground it sits on (4.5:1)', () => {
    const t = paperManifest().tokens
    const grounds: Record<string, string> = {
      'bg-base': t['bg-base'] ?? '',
      'bg-surface': t['bg-surface'] ?? '',
      'bg-row-rest': t['bg-row-rest'] ?? '',
      'bg-card-calm': t['bg-card-calm'] ?? '',
      'bg-card-hero': t['bg-card-hero'] ?? '',
      '--paper-head': PAPER_HEAD
    }
    for (const [name, ground] of Object.entries(grounds)) {
      for (const ink of ['text-primary', 'text-secondary']) {
        expect(
          contrast(hexToRgb(t[ink] ?? ''), hexToRgb(ground)),
          `${ink} on ${name}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it("paper's theme-local greys match the values the contrast tests use", () => {
    expect(bodyOf('paper', ':root')).toContain(`--paper-head: ${PAPER_HEAD};`)
  })
  it('paper filled controls keep their ink readable (4.5:1)', () => {
    const t = paperManifest().tokens
    const pairs: [string, string][] = [
      ['text-primary', 'needs-you'], // the dark digit on the gold count (spec: Assumed)
      ['text-on-lit', 'text-primary'], // primary button and lit toggle: white on ink
      ['text-on-danger', 'danger'],
      ['text-on-success', 'success']
    ]
    for (const [ink, fill] of pairs) {
      expect(
        contrast(hexToRgb(t[ink] ?? ''), hexToRgb(t[fill] ?? '')),
        `${ink} on ${fill}`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('paper status colours read as indicators on white (3:1)', () => {
    const t = paperManifest().tokens
    for (const s of ['working', 'needs-you', 'idle', 'danger']) {
      expect(
        contrast(hexToRgb(t[s] ?? ''), hexToRgb(t['bg-surface'] ?? '')),
        s
      ).toBeGreaterThanOrEqual(3)
    }
  })
  it('paper ships its two fonts inlined, each with a system fallback', () => {
    const t = paperManifest().tokens
    expect(t['font-ui']).toMatch(/^'Familjen Grotesk', .*sans-serif$/)
    expect(t['font-mono']).toMatch(/^'Martian Mono', .*monospace$/)
    const r = scanner.load('paper')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.css.match(/url\("data:font\/woff2;base64,/g)).toHaveLength(2)
    }
    const css = readFileSync(resolve(examples, 'paper/theme.css'), 'utf8')
    expect(css).toMatch(/font-family: 'Familjen Grotesk'/)
    expect(css).toMatch(/font-family: 'Martian Mono'/)
  })
  it('paper assets stay under the theme asset cap', () => {
    const dir = resolve(examples, 'paper')
    const total = [
      'familjen-grotesk-latin-wght-normal.woff2',
      'martian-mono-latin-wght-normal.woff2'
    ].reduce((sum, f) => sum + statSync(resolve(dir, f)).size, 0)
    expect(total).toBeLessThanOrEqual(THEME_ASSETS_MAX_BYTES)
  })
  it('paper selects no test id and no CSS-module class', () => {
    const css = readFileSync(resolve(examples, 'paper/theme.css'), 'utf8')
    expect(css).not.toContain('data-testid')
    expect(css).not.toMatch(/\[class[*^$]?=/)
  })
  it("paper: a card rule never uses the `background:` shorthand (it resets the card's hover image)", () => {
    const offenders = themeRules('paper')
      .filter((r) => r.selectors.some((s) => s.includes("[data-glass='card']")))
      .filter((r) => /(^|[;\s])background\s*:/.test(r.body))
      .map((r) => r.selectors.join(', '))
    expect(offenders).toEqual([])
  })
  it('paper: one control look — no pills, no black hover, a ring instead of a border', () => {
    const css = readFileSync(resolve(examples, 'paper/theme.css'), 'utf8')
    expect(css).not.toContain('--rounded-full')
    expect(css).not.toMatch(/#2a2b2a/i)
    const secondary = bodyOf('paper', "button[data-variant='secondary']")
    expect(secondary).toMatch(/box-shadow:\s*var\(--paper-ring\)/)
    expect(secondary).toMatch(/border-color:\s*transparent/)
    expect(bodyOf('paper', "button[data-variant='primary']")).toMatch(
      /background:\s*var\(--text-primary\)/
    )
  })
  it('paper: a lit toggle keeps the app look over the white secondary', () => {
    const lit = bodyOf('paper', 'button[data-variant][data-lit]')
    expect(lit).toMatch(/background:\s*var\(--text-primary\)/)
    expect(lit).toMatch(/color:\s*var\(--text-on-lit\)/)
    expect(lit).toMatch(/box-shadow:\s*none/)
  })
  it('paper never sets text to --text-muted, and keyboard focus gets the sunk fill', () => {
    for (const r of themeRules('paper'))
      expect(r.body).not.toMatch(/(^|[;\s])color:\s*var\(--text-muted\)/)
    expect(
      bodyOf(
        'paper',
        ":root[data-input='keyboard'] [data-popover-item]:not([data-tone]):focus-visible"
      )
    ).toMatch(/background-color:\s*var\(--bg-row-rest\)/)
  })
  it('paper: the workspace switcher keeps its tint (no background of its own)', () => {
    expect(bodyOf('paper', '[data-workspace-switcher]')).not.toMatch(/background/)
  })
  it('paper: every count is a radius-4 mono square with a dark digit on gold', () => {
    expect(bodyOf('paper', '[data-count]')).toMatch(/border-radius:\s*var\(--rounded-sm\)/)
    expect(bodyOf('paper', '[data-count]')).toMatch(/font-family:\s*var\(--font-mono\)/)
    expect(bodyOf('paper', "[data-count='needs-you']")).toMatch(/color:\s*var\(--text-primary\)/)
  })
  it('paper: the three columns sit in one white panel split by lines', () => {
    expect(bodyOf('paper', '[data-column-grid]')).toMatch(/box-shadow:\s*var\(--paper-panel\)/)
    expect(bodyOf('paper', '[data-column-grid]')).toMatch(/gap:\s*0/)
    expect(bodyOf('paper', "[data-column-header][data-accent='needs-you']")).toMatch(
      /inset 0 3px 0 var\(--needs-you\)/
    )
  })
  it('paper: only needs-you cards lift; the rest sit sunk', () => {
    expect(bodyOf('paper', "[data-glass='card'][data-status='needs-you']")).toMatch(
      /box-shadow:\s*var\(--paper-lift\)/
    )
    expect(bodyOf('paper', "[data-glass='card']")).toMatch(/box-shadow:\s*none/)
  })
  it('paper: rail headings drop their rules only when the rail is open (Review Focus 1)', () => {
    const hide = themeRules('paper').filter((r) => /display:\s*none/.test(r.body))
    const selectors = hide
      .flatMap((r) => r.selectors)
      .filter((s) => s.includes('data-rail-heading'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const s of selectors) expect(s).toContain("[data-collapsed='false']")
  })
  it('paper: the rail rows keep the app status edge (no second edge drawn over it)', () => {
    const railRowRules = themeRules('paper').filter((r) =>
      r.selectors.some((s) => s.includes('data-rail-row'))
    )
    expect(railRowRules.length).toBeGreaterThan(0)
    for (const r of railRowRules) expect(r.body).not.toMatch(/inset 3px 0 0/)
  })
  it('paper: menus are radius 12 with sunk active rows and no border', () => {
    const box = bodyOf('paper', '[data-popover]')
    expect(box).toMatch(/border-radius:\s*12px/)
    expect(box).toMatch(/border-color:\s*transparent/)
    expect(bodyOf('paper', "[data-popover-item][aria-expanded='true']")).toMatch(
      /background-color:\s*var\(--bg-row-rest\)/
    )
    expect(bodyOf('paper', "[data-popover-item][aria-expanded='true']")).toMatch(
      /border-color:\s*transparent/
    )
  })
  it('paper: dialogs are radius 14; the selected category is white with the ring', () => {
    expect(bodyOf('paper', '[data-manage-panel]')).toMatch(/border-radius:\s*14px/)
    expect(bodyOf('paper', "[data-manage-list] [data-selected='true']")).toMatch(
      /box-shadow:\s*var\(--paper-ring\)/
    )
    // Owner 2026-10-14: Manage rows keep the app's height; Paper sets none.
    expect(bodyOf('paper', '[data-manage-list] [data-manage-row-select]')).not.toMatch(/height/)
  })
  it("paper's terminal IS the built-in light palette (Follow theme = Light)", () => {
    expect(paperManifest().terminal).toEqual(xtermLightTheme)
    expect(paperManifest().tokens['bg-terminal']).toBe(xtermLightTheme.background)
  })

  it('liquid-glass: one 16px rhythm, concentric radii, the Settings inset group (spec 2026-10-07 B; 16px: spec 2026-10-08 D.7)', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(examples, 'liquid-glass/theme.json'), 'utf8')
    ) as { tokens: Record<string, string> }
    expect(manifest.tokens['gutter']).toBe('16px')
    expect(manifest.tokens['rounded-lg']).toBe('20px')
    const rules = liquidGlassRules()
    const bodyOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    // Header → filter bar is the filter bar's own gap: the bubble has no bottom margin. Its top
    // margin (12) matches the focused view's gap under it; the board's search row keeps 16.
    expect(bodyOf("[data-testid='app-header']")).toMatch(
      /margin:\s*var\(--gap-group\) var\(--inset-compact-x\) 0;/
    )
    expect(bodyOf("[data-testid='filter-bar']")).toMatch(/margin-top:\s*var\(--gap-page\);/)
    expect(bodyOf("[data-testid='focused-layer']")).toMatch(/padding-top:\s*var\(--gap-group\);/)
    // Column 24 = card 12 + the column's 12 padding (inner = outer − padding).
    expect(bodyOf('section[data-column]')).toMatch(/border-radius:\s*24px;/)
    const group = bodyOf('[data-settings-group]')
    expect(group).toMatch(/background:\s*rgba\(255, 255, 255, 0\.04\);/)
    expect(group).toMatch(/border:\s*1px solid var\(--border\);/)
    expect(group).toMatch(/border-radius:\s*var\(--rounded-md\);/)
    expect(group).toMatch(/padding:\s*4px 16px 12px;/)
  })
})
