// Pins the rail-wall NOTCH mechanism (fix/theme-glass-flare) — see
// .superpowers/sdd/2026-09-20-custom-themes/rail-wall-design.md.
//
// This file used to pin the active-row flare's opacity-independence fix (`.active::before` /
// `.active::after` painting a transparent disc instead of `--bg-surface`). That mechanism is
// GONE for the pinned row: the wall is no longer interrupted by painting over it. `.rail` draws
// no background/border of its own any more, and the active tab is a genuine HOLE cut out of the
// pinned slot's own chrome layer (`.pinnedSlot::before`, a `mask-composite: subtract`) — so no
// token has to be opaque for the break to hold, on ANY row, not just the arc's inside disc.
//
// What is pinned now:
//   - `.rail` paints neither `background` nor `border-right` — the wall lives on the tiling
//     chrome layers instead (`.rail::before`/`.rail::after`/`.pinnedSlot::before`).
//   - `.pinnedSlot::before`'s mask SUBTRACTS the hole from the rest (`mask-composite: subtract`
//     is the FIRST composite value), and its background's LAST layer is `var(--bg-surface)` (the
//     rail's own surface, painted once, not composited twice).
//   - The ring gradient's outside stop is `transparent` (never a fill) — the shape is a 1px ring
//     with a hole on the far side, not a flare with paint beyond the arc.
//   - `.row.active::after`, the hit strip that replaces the width the row's box gave up, carries
//     `pointer-events: auto` — the row's clickable area must not shrink.
//   - The STARTING row's flares (`.startingRow.active::before`/`::after`) are the ONE place still
//     doing the OLD trick: they have no chrome layer of their own (that row lives inside
//     `.scroll`), so they still paint a literal `--bg-base` cover — kept on purpose, not an
//     oversight (see that rule's own comment and the rail-wall design doc's "what it costs").
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

const block = (selector: RegExp): string => selector.exec(css)?.[1] ?? ''

describe('AttentionRail — the rail paints no background/border of its own', () => {
  it('.rail carries neither background nor border-right — the chrome layers do', () => {
    const rail = block(/^\.rail\s*\{([^}]*)/m)
    expect(rail).not.toMatch(/^\s*background\s*:/m)
    expect(rail).not.toMatch(/^\s*border-right\s*:/m)
  })

  it('.rail::before/.rail::after paint the surface + wall above/below the pinned slot', () => {
    const chrome = block(/^\.rail::before,\s*\n\.rail::after\s*\{([^}]*)/m)
    expect(chrome).toMatch(/background:\s*var\(--bg-surface\)/)
    expect(chrome).toMatch(/border-right:\s*1px solid var\(--border\)/)
  })
})

describe('AttentionRail — the notch is a genuine hole (mask), not a paint-over', () => {
  it('.pinnedSlot::before SUBTRACTS the hole — mask-composite leads with "subtract"', () => {
    const chrome = block(/^\.pinnedSlot::before\s*\{([^}]*)/m)
    expect(chrome).toMatch(/mask-composite:\s*subtract,/)
  })

  it("the slot's own surface is the LAST background layer — painted once, never composited twice", () => {
    const chrome = block(/^\.pinnedSlot::before\s*\{([^}]*)/m)
    const backgroundBlock = /background:\s*([^;]*);/.exec(chrome)?.[1] ?? ''
    expect(backgroundBlock.trim().endsWith('var(--bg-surface)')).toBe(true)
  })

  it("the ring gradients' outside stop is transparent — a ring with a hole beyond it, never a fill", () => {
    const chrome = block(/^\.pinnedSlot::before\s*\{([^}]*)/m)
    expect(chrome).toMatch(
      /var\(--rounded-md\) - 1px\)\s+var\(--rounded-md\),\s*\n\s*transparent var\(--rounded-md\)/
    )
    // Neither ring references --bg-base any more — that fill lived on the OLD `.active::before` /
    // `.active::after`, which are gone for the pinned row.
    expect(chrome).not.toMatch(/--bg-base/)
  })
})

describe('AttentionRail — the hit strip keeps the row clickable where its box gave up width', () => {
  it('.row.active::after is pointer-events: auto (chrome around it stays pointer-events: none)', () => {
    const strip = block(/^\.row\.active::after\s*\{([^}]*)\}/m)
    expect(strip).toMatch(/pointer-events:\s*auto/)
  })
})

describe('AttentionRail — the STARTING row is the one place still painting a literal cover', () => {
  it('.startingRow.active::before/::after still paint var(--bg-base) as a cover, on purpose', () => {
    for (const selector of ['.startingRow.active::before', '.startingRow.active::after']) {
      const pattern = new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g')
      const bodies = [...css.matchAll(pattern)].map((m) => m[1] ?? '')
      const gradientBody = bodies.find((b) => b.includes('radial-gradient'))
      expect(gradientBody, `${selector} must exist with a gradient body`).toBeTruthy()
      expect(gradientBody).toContain('var(--bg-base)')
    }
  })
})

describe('ruleFor-style helpers read the sheet only (non-vacuity)', () => {
  it('a selector that is not present reads as an empty block, not a false pass', () => {
    expect(block(/^\.does-not-exist\s*\{([^}]*)/m)).toBe('')
  })
})
