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

describe('docs/themes/examples', () => {
  it('scan lists the three examples, none broken, sorted by name', () => {
    expect(scanner.scan()).toEqual([
      { id: 'builtin-dark', name: 'Built-in dark', author: 'claude-watcher', colorScheme: 'dark' },
      { id: 'liquid-glass', name: 'Liquid Glass', author: 'claude-watcher', colorScheme: 'dark' },
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
  // The grain is an ASSET, not a `data:` URI written by hand — `rewriteCssUrls` only accepts
  // `url("name.ext")`. Rename or drop noise.svg and the load fails closed (theme_asset_missing),
  // so this pins that the file is still there AND that every reference to it was inlined.
  it('liquid-glass inlines its noise.svg grain, leaving no un-rewritten url()', () => {
    const r = scanner.load('liquid-glass')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.css).toContain('url("data:image/svg+xml;base64,')
      // The name survives in the file's own comments — it is the `url()` that must be gone.
      expect(r.bundle.css).not.toContain('url("noise.svg")')
    }
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
    expect(blurring.filter((s) => !s.endsWith('::before'))).toEqual(POPOVERS)
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
    expect(glass[0]?.body).toMatch(/(^|[\s;])backdrop-filter:\s*blur\(\d+px\)/)
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
      /padding:\s*0 var\(--gutter\) var\(--space-2\);/
    )
    const bubble = body("[data-testid='focused-session']")
    expect(bubble).toMatch(/border-radius:\s*var\(--rounded-lg\);/)
    expect(bubble).toMatch(/overflow:\s*clip;/)
    expect(bubble).not.toMatch(/margin/)
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
