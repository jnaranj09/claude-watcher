// Pins the active-row flare's opacity-independence fix (fix/theme-glass-flare).
//
// `.active::before` / `.active::after` (the concave "tab shoulder" corners) used to paint
// `var(--bg-surface)` for the disc INSIDE the arc, reasoning "the rail continues over the top of
// the flare" — true for an opaque theme, but on a translucent one (liquid-glass's
// `--bg-surface: rgba(255,255,255,.06)`) it double-paints that 6% layer on top of the rail's own
// already-`--bg-surface` background, and the two compound into a visibly lighter square with its
// own edge. Verified with a zoomed screenshot comparison (see the report): the disc region can
// never reach a row pixel, so it is safe to leave fully transparent and let the rail's own
// (possibly translucent) surface show through exactly once.
//
// The arc (`var(--border)`) and the outside band (`var(--bg-base)`) do the REAL work of covering
// the tab's own straight border stub near the corner (the `+ 1px` height trick) and must stay
// literal opaque colors regardless of theme — hollowing those out too would let that stub show
// again. This test pins both halves: the disc is transparent, and the arc/outside bands are not.
//
// Reads the stylesheet off disk on purpose: vitest.config.ts sets no `css` option, so an imported
// *.module.css resolves to a proxy that answers EVERY key with a string
// (.claude/rules/design.md "A note on testing CSS classes").
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/attention/AttentionRail.module.css'),
  'utf8'
)

/** `.active::before` and `.active::after` each appear TWICE: once in the shared
 *  `.active::before,\n.active::after { … }` block (content/position/size, no gradient) and once
 *  in their own dedicated block (the `background: radial-gradient(...)`). A naive first-match
 *  regex finds the shared block (its second selector line reads identically to the dedicated
 *  rule's own opening line: `.active::after {`), so this picks the match whose body actually
 *  carries the gradient instead of the first one found. */
function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
  const bodies = [...css.matchAll(pattern)].map((m) => m[1] ?? '')
  if (bodies.length === 0) throw new Error(`rule ${selector} not found`)
  const gradientBody = bodies.find((b) => b.includes('radial-gradient'))
  return gradientBody ?? bodies[0]!
}

describe('AttentionRail .active::before/::after flares are opacity-independent', () => {
  it('.active::before paints the inside disc transparent, not a surface color', () => {
    const body = ruleBody('.active::before')
    expect(body).toMatch(/circle at 0 0,\s*transparent\s/)
  })

  it('.active::after paints the inside disc transparent, not a surface color', () => {
    const body = ruleBody('.active::after')
    expect(body).toMatch(/circle at 0 100%,\s*transparent\s/)
  })

  it('.active::before keeps the arc and outside band as literal opaque colors', () => {
    const body = ruleBody('.active::before')
    expect(body).toContain('var(--border)')
    expect(body).toContain('var(--bg-base)')
  })

  it('.active::after keeps the arc and outside band as literal opaque colors', () => {
    const body = ruleBody('.active::after')
    expect(body).toContain('var(--border)')
    expect(body).toContain('var(--bg-base)')
  })

  it('neither flare references --bg-surface any more (that was the double-paint)', () => {
    expect(ruleBody('.active::before')).not.toContain('--bg-surface')
    expect(ruleBody('.active::after')).not.toContain('--bg-surface')
  })
})

describe('ruleBody() reads THAT rule only (non-vacuity)', () => {
  it('throws when the selector is not present', () => {
    expect(() => ruleBody('.does-not-exist')).toThrow()
  })
})
