// Pins the rail's surface hooks (spec 2026-10-09 rail surface hooks). The focused view's rail and
// top bar are ONE surface to the eye, painted by four layers: `.rail::before` (the header band),
// `.pinnedSlot::before` (the slot around the active tab), `.rail::after` (below the slot) and the
// focused `.bar`. Each reads the surface through one chain, so a theme sets `--rail-surface` (and,
// for the top bar row only, `--rail-surface-top`) once. A theme that had to find every layer
// missed one (2026-10-09: a whiter band under the active tab).
//
// Reads the stylesheets off disk on purpose: vitest.config.ts sets no `css` option, so an imported
// *.module.css resolves to a proxy that answers EVERY key with a string
// (.claude/rules/design.md "A note on testing CSS classes").
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), 'src/renderer/src', rel), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )
const squash = (s: string): string => s.replace(/\s+/g, '')

const RAIL = squash('var(--rail-surface, var(--bg-surface))')
const TOP = squash('var(--rail-surface-top, var(--rail-surface, var(--bg-surface)))')

const FILES = ['components/attention/AttentionRail.module.css', 'views/FocusedSession.module.css']

/** The body of the rule whose whole selector list is exactly `selector` (whitespace ignored). */
function rule(css: string, selector: string): string {
  for (const [, sel = '', body = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (squash(sel) === squash(selector)) return squash(body)
  }
  return ''
}

describe('the rail surface hooks', () => {
  it('never reads --bg-surface outside the two chains', () => {
    for (const file of FILES) {
      // TOP first: it contains RAIL.
      const rest = squash(read(file)).split(TOP).join('').split(RAIL).join('')
      expect(rest, file).not.toContain('--bg-surface')
    }
  })

  it('each layer paints its chain', () => {
    const rail = read('components/attention/AttentionRail.module.css')
    const bar = read('views/FocusedSession.module.css')
    // The header band: TOP on the top bar row only (an inset shadow --topbar-height tall), RAIL
    // below it (clipped to the content box, which the same padding pushes down) — the layer is full
    // height when there is no pinned slot. Not a gradient: Chromium dithers gradients, so Default
    // would no longer paint a plain surface.
    const before = rule(rail, '.rail::before')
    expect(before).toContain('padding-top:var(--topbar-height);')
    expect(before).toContain(`background:${RAIL}content-box;`)
    expect(before).toContain(`box-shadow:inset0var(--topbar-height)${TOP};`)
    expect(rule(rail, '.rail::after')).toContain(`background:${RAIL}`)
    expect(rule(rail, '.pinnedSlot::before')).toMatch(new RegExp(`${escape(RAIL)};`))
    expect(rule(bar, '.bar')).toContain(`background:${TOP}`)
  })

  it('declares neither property: a declaration would shadow the theme value', () => {
    for (const file of FILES) {
      expect(read(file), file).not.toMatch(/--rail-surface(-top)?\s*:/)
    }
  })
})

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
