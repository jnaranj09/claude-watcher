// The docs examples ARE theme folders: the scanner reads them as an operator's themes folder.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, statSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { TOKENS } from '../../shared/theme/tokens'
import { xtermTheme, xtermLightTheme } from '../../shared/theme/xtermTheme'
import { contrast, hexToRgb, over } from '../../renderer/src/test/contrast'
import { createThemeScanner } from './themeScanner'
import { THEME_ASSETS_MAX_BYTES, ThemeManifestSchema } from '../../shared/schemas/theme'

const here = dirname(fileURLToPath(import.meta.url))
const examples = resolve(here, '../../../docs/themes/examples')
const scanner = createThemeScanner({ dir: examples, log: () => {} })

function paperManifest(): { tokens: Record<string, string>; terminal: unknown } {
  return JSON.parse(readFileSync(resolve(examples, 'paper/theme.json'), 'utf8')) as {
    tokens: Record<string, string>
    terminal: unknown
  }
}

// liquid-glass/theme.css as `{ selectors, body }` rules, comments stripped. No nesting is parsed:
// the inner rules of the theme's two @media blocks read as top-level rules, which the assertions
// below accept (they check bodies by selector; the @media guard is a raw-text test).
function liquidGlassRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(examples, 'liquid-glass/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel = '', body = '']) => ({
    // One line per selector: Prettier wraps a long one (and inside `:not(…)`).
    selectors: sel
      .split(',')
      .map((s) => s.trim().replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')),
    body
  }))
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
  // control (its action is a secondary Button), so it is a container: it blurs from `::before`,
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
  it('paper text reads on every ground it sits on (4.5:1)', () => {
    const t = paperManifest().tokens
    for (const ground of ['bg-base', 'bg-surface', 'bg-row-rest', 'bg-card-calm', 'bg-card-hero']) {
      for (const ink of ['text-primary', 'text-secondary']) {
        expect(
          contrast(hexToRgb(t[ink] ?? ''), hexToRgb(t[ground] ?? '')),
          `${ink} on ${ground}`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
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
    // Header → filter bar is the filter bar's own gap: the bubble has no bottom margin.
    expect(bodyOf("[data-testid='app-header']")).toMatch(
      /margin:\s*var\(--inset-compact-x\) var\(--inset-compact-x\) 0;/
    )
    // Column 24 = card 12 + the column's 12 padding (inner = outer − padding).
    expect(bodyOf('section[data-column]')).toMatch(/border-radius:\s*24px;/)
    const group = bodyOf('[data-settings-group]')
    expect(group).toMatch(/background:\s*rgba\(255, 255, 255, 0\.04\);/)
    expect(group).toMatch(/border:\s*1px solid var\(--border\);/)
    expect(group).toMatch(/border-radius:\s*var\(--rounded-md\);/)
    expect(group).toMatch(/padding:\s*4px 16px 12px;/)
  })
})

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
    expect(on).toMatch(/--glass-row-fill:\s*rgba\(255,\s*255,\s*255,\s*0\.15\)/)
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
      "[data-popover-item][style*='--glass-light']:not(:disabled)::before",
      "button[data-variant='primary'][style*='--glass-light']:not(:disabled)::before",
      "button[data-variant='secondary'][style*='--glass-light']:not(:disabled):not([data-lit])::before",
      "[data-popover-item][style*='--glass-light']:not(:disabled)::after",
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
      // the white glow lower a little").
      lift: 0.03,
      glow: 0.02,
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
    ).toEqual({ header: 0.03, column: 0.014, card: 0.02, control: 0.025, field: 0.025 })
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
