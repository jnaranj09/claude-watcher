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
import { cssRule, readCss } from '../../test/cssRule'

const squash = (s: string): string => s.replace(/\s+/g, '')

const RAIL = squash('var(--rail-surface, var(--bg-surface))')
const TOP = squash('var(--rail-surface-top, var(--rail-surface, var(--bg-surface)))')

const FILES = ['components/attention/AttentionRail.module.css', 'views/FocusedSession.module.css']

/** The declarations of the rule whose selector list is exactly `selector`, all whitespace removed
 *  (the chains above are compared squashed). */
const rule = (file: string, selector: string): string => squash(cssRule(file, selector))

describe('the rail surface hooks', () => {
  it('never reads --bg-surface outside the two chains', () => {
    for (const file of FILES) {
      // TOP first: it contains RAIL.
      const rest = squash(readCss(file)).split(TOP).join('').split(RAIL).join('')
      expect(rest, file).not.toContain('--bg-surface')
    }
  })

  it('each layer paints its chain', () => {
    const rail = 'components/attention/AttentionRail.module.css'
    const bar = 'views/FocusedSession.module.css'
    // The header band: TOP on the top bar row only (an inset shadow --topbar-height tall), RAIL
    // below it (clipped to the content box, which the same padding pushes down) — the layer is full
    // height when there is no pinned slot. Not a gradient: Chromium dithers gradients, so Default
    // would no longer paint a plain surface.
    const before = rule(rail, '.rail::before')
    expect(before).toContain('padding-top:var(--topbar-height);')
    expect(before).toContain(`background:${RAIL}content-box;`)
    // The wall is the first shadow, not the shared border-right: the content-box background and an
    // inset shadow both stop at the padding edge, so a border would have no surface under it, and
    // a translucent --border would step at the slot (review 2026-10-09).
    expect(before).toContain('border-right:0;')
    expect(before).toContain(`box-shadow:inset-1px0var(--border),inset0var(--topbar-height)${TOP};`)
    expect(rule(rail, '.rail::after')).toContain(`background:${RAIL}`)
    expect(rule(rail, '.pinnedSlot::before')).toMatch(new RegExp(`${escape(RAIL)};`))
    expect(rule(bar, '.bar')).toContain(`background:${TOP}`)
  })

  it('declares neither property: a declaration would shadow the theme value', () => {
    for (const file of FILES) {
      expect(readCss(file), file).not.toMatch(/--rail-surface(-top)?\s*:/)
    }
  })
})

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
