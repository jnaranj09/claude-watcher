// The docs examples ARE theme folders: the scanner reads them as an operator's themes folder.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { TOKENS } from '../../shared/theme/tokens'
import { xtermTheme } from '../../shared/theme/xtermTheme'
import { createThemeScanner } from './themeScanner'

const here = dirname(fileURLToPath(import.meta.url))
const examples = resolve(here, '../../../docs/themes/examples')
const scanner = createThemeScanner({ dir: examples, log: () => {} })

// liquid-glass/theme.css as `{ selectors, body }` rules, comments stripped. Flat CSS only: the
// theme has no @media or nested blocks.
function liquidGlassRules(): { selectors: string[]; body: string }[] {
  const css = readFileSync(resolve(examples, 'liquid-glass/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel = '', body = '']) => ({
    selectors: sel.split(',').map((s) => s.trim()),
    body
  }))
}

// Every floating surface liquid-glass styles as a popover, in the theme's own selector order.
const POPOVERS = [
  "[role='menu']",
  "[role='listbox']",
  "[data-testid='new-session-menu']",
  "[data-testid$='tag-picker']",
  "[data-testid='expander-box']"
]

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
          { id: 'graphite', name: 'Graphite' },
          { id: 'aurora', name: 'Aurora gradient' },
          { id: 'smoke', name: 'Warm smoke' }
        ]
      },
      { id: 'paper', name: 'Paper', author: 'claude-watcher', colorScheme: 'light' }
    ])
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
  it('liquid-glass has no grain, no sheen, and one image: the chosen wallpaper on body only', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.wallpaperId).toBe('graphite')
      expect(r.bundle.css.match(/url\(/g)).toHaveLength(1)
      expect(r.bundle.css).toContain('--theme-wallpaper: url("data:image/png;base64,')
      expect(liquidGlassRules().filter((rule) => rule.body.includes('url('))).toEqual([])
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
    ['graphite', 'image/png'],
    ['aurora', 'image/png'],
    ['smoke', 'image/png']
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
      new Set(['var(--glass-filter)', 'var(--glass-filter-modal)', 'none', 'blur(12px)'])
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
  it('liquid-glass blurs every popover, but not the expander box inline list', () => {
    const glass = liquidGlassRules().filter(
      (r) => POPOVERS.every((p) => r.selectors.includes(p)) && /backdrop-filter:/.test(r.body)
    )
    expect(glass).toHaveLength(1)
    // The shared `--glass-filter` (declared on :root), itself a blur.
    expect(glass[0]?.body).toMatch(/(^|[\s;])backdrop-filter:\s*var\(--glass-filter\);/)
    const root = liquidGlassRules()
      .filter((r) => r.selectors.includes(':root'))
      .map((r) => r.body)
      .join('\n')
    expect(root).toMatch(/--glass-filter:\s*blur\(\d+px\)/)
    // An opaque colour on the same rule would hide the blur it pays for.
    expect(glass[0]?.body).not.toMatch(/background(-color)?:/)
    // The expander's list is INLINE in the box, not a popover of its own: it must not paint a
    // second card (its own shadow and grain) inside the one the box already is, nor blur only
    // what the box painted.
    const inline = liquidGlassRules()
      .filter((r) => r.selectors.includes("[data-testid='expander-box'] [role='listbox']"))
      .map((r) => r.body)
      .join('\n')
    expect(inline).toMatch(/background:\s*none;/)
    expect(inline).toMatch(/box-shadow:\s*none;/)
    expect(inline).toMatch(/(^|[\s;])backdrop-filter:\s*none;/)
  })
  // A popover is GLASS like the header: the token's white film + the sheen's dark bottom band read
  // as a flat grey card beside the glass header, and the header's own dark fill read as a black
  // slab over the near-black board (a blur of black is black). A FAINT WHITE tint lifts it. The
  // fill sits in its own rule (the blur rule must carry no colour), the sheen is off the popovers,
  // and the rim is the directional one — two offset inset shadows, never a `::after` ring, because
  // a Select list and the tag picker scroll.
  it('liquid-glass gives every popover a faint white glass fill and a directional rim, no sheen', () => {
    const rules = liquidGlassRules()
    const popoverRules = rules.filter((r) => POPOVERS.every((p) => r.selectors.includes(p)))
    const smoky = popoverRules.filter((r) => /background-color:/.test(r.body))
    expect(smoky).toHaveLength(1)
    expect(smoky[0]?.body).toMatch(/background-color:\s*var\(--glass-fill\);/)
    expect(smoky[0]?.body).not.toMatch(/backdrop-filter/)
    expect(popoverRules.map((r) => r.body).join('\n')).not.toContain('--glass-sheen')
    const rim = popoverRules.filter((r) => /box-shadow:/.test(r.body))
    expect(rim).toHaveLength(1)
    expect(rim[0]?.body).toMatch(/box-shadow:\s*var\(--glass-rim-pop\), var\(--shadow-pop\);/)
    const root = rules
      .filter((r) => r.selectors.includes(':root'))
      .map((r) => r.body)
      .join('\n')
    expect(root).toMatch(/--glass-rim-pop:\s*inset 1px 1px 0 rgba\([^)]*\), inset -1px -1px 0 rgba/)
  })
  // The terminal frame is a bubble like the header and the columns: rim, directional ring, faint
  // border. Its fill stays the token's darker `--bg-terminal` (glyphs need it), so no `--glass-fill`.
  it('liquid-glass gives the terminal frame the bubble rim and ring, not the glass fill', () => {
    const rules = liquidGlassRules()
    const frame = rules
      .filter((r) => r.selectors.includes("[data-testid='embedded-terminal']"))
      .map((r) => r.body)
      .join('\n')
    expect(frame).toMatch(/box-shadow:\s*var\(--glass-rim\), var\(--shadow-pop\);/)
    expect(frame).not.toContain('--glass-fill')
    const ring = rules
      .filter((r) => r.selectors.includes("[data-testid='embedded-terminal']::after"))
      .map((r) => r.body)
      .join('\n')
    expect(ring).toMatch(/conic-gradient\(/)
    expect(ring).toMatch(/pointer-events:\s*none;/)
    expect(ring).not.toMatch(/z-index/)
  })
  // Primary and secondary Buttons are the switcher's glass: same blur, rim and faint border. They
  // never set a fill (primary's raised fill vs secondary's clear one is what tells them apart),
  // and a lit button (opaque white, its own border) is excluded.
  it('liquid-glass gives primary and secondary buttons the switcher glass, fill untouched', () => {
    const rules = liquidGlassRules()
    const bodyOf = (sel: string): string =>
      rules
        .filter((r) => r.selectors.includes(sel))
        .map((r) => r.body)
        .join('\n')
    const switcher = bodyOf("[data-testid='workspace-switcher']")
    for (const sel of LEAF_BUTTONS.slice(2, 4)) {
      const body = bodyOf(sel)
      expect(body, sel).toMatch(/backdrop-filter:\s*var\(--glass-filter\);/)
      expect(body, sel).toMatch(/box-shadow:\s*var\(--glass-rim\);/)
      const border = /border-color:\s*([^;]+);/.exec(body)?.[1]
      expect(border, sel).toBeDefined()
      expect(switcher).toContain(`border-color: ${border ?? ''};`)
      expect(body, sel).not.toMatch(/background/)
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
      /padding:\s*0 var\(--space-2\) var\(--space-2\);/
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
  it('paper is a light, tokens-only theme', () => {
    const r = scanner.load('paper')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.colorScheme).toBe('light')
      expect(r.bundle.css).toMatch(/^:root \{[\s\S]*\}\n$/)
      expect(r.bundle.css).not.toContain('backdrop')
    }
  })
})
