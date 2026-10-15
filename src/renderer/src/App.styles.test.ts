// Pins the header's stacking-context fix (custom-themes task 15). A Playwright drive of the
// liquid-glass example theme found the ☰ menu → Settings… click intercepted by the board's
// filter row: `backdrop-filter` on [data-testid='app-header'] creates a stacking context ON THE
// HEADER, and an ordinary in-flow .header (no position, no z-index of its own) has none — so
// AppMenu's z-index: 50 popover, once trapped inside that new header context, paints as part of
// the header, which (unpositioned) paints in plain DOM order BEFORE <main>. The board's
// FilterBar, also z-index: 50 but painted AFTER the header, wins the tie and covers the menu.
//
// The fix gives .header its OWN stacking context (position: relative + z-index) that beats
// FilterBar/AppMenu/NewSessionMenu/Settings/WorkspaceSwitcher's z-index: 50 unconditionally, so
// no theme's CSS on the header can trap the menu below the board again.
//
// Reads the stylesheet off disk on purpose: vitest.config.ts sets no `css` option, so an
// imported *.module.css resolves to a proxy that answers EVERY key with a string —
// `expect(styles.header).toBeTruthy()` would pass even against an empty file
// (.claude/rules/design.md "A note on testing CSS classes").
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ruleBody } from './test/cssRule'

const FILTER_BAR_Z_INDEX = 50
// Modal dialogs (ManageDialog/SessionNameDialog/QuitGuard/StopConfirm) sit at z-index: 60. The
// header must beat the board but never a modal, so it has to land strictly between the two.
const MODAL_Z_INDEX = 60

function readZIndex(css: string, selector: string): number {
  const body = ruleBody(css, selector)
  const match = /z-index:\s*(-?\d+)/.exec(body)
  if (match === null) return Number.NaN
  return Number(match[1])
}

describe('App.module.css .header outranks the board (custom-themes task 15)', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/src/App.module.css'), 'utf8')

  it('is positioned, so it forms its own stacking context regardless of a theme', () => {
    expect(ruleBody(css, '.header')).toMatch(/position:\s*relative/)
  })

  it('carries a z-index strictly ABOVE the FilterBar/AppMenu popovers (z-index: 50)', () => {
    const headerZ = readZIndex(css, '.header')
    expect(Number.isNaN(headerZ)).toBe(false)
    expect(headerZ).toBeGreaterThan(FILTER_BAR_Z_INDEX)
  })

  it('stays strictly BELOW the Manage-dialog modal layer (z-index: 60)', () => {
    const headerZ = readZIndex(css, '.header')
    expect(headerZ).toBeLessThan(MODAL_Z_INDEX)
  })
})

// The + New session menu is portaled to <body>, so the header no longer contains it: below the
// header's z-index it painted UNDER the header where the two overlap (its top edge).
describe('NewSessionMenu .portalAnchor sits over the header, under the modals', () => {
  const app = readFileSync(join(process.cwd(), 'src/renderer/src/App.module.css'), 'utf8')
  const menu = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/NewSessionMenu/NewSessionMenu.module.css'),
    'utf8'
  )

  it('is strictly above the header and strictly below the modal layer', () => {
    const menuZ = readZIndex(menu, '.portalAnchor')
    expect(menuZ).toBeGreaterThan(readZIndex(app, '.header'))
    expect(menuZ).toBeLessThan(MODAL_Z_INDEX)
  })
})

describe('ruleBody()/readZIndex() read THAT rule only (non-vacuity)', () => {
  it('does not answer with a longer class sharing the prefix', () => {
    const css = '.header {\n  z-index: 10;\n}\n.headerLead {\n  z-index: 99;\n}\n'
    expect(readZIndex(css, '.header')).toBe(10)
  })

  it('is NaN when the rule carries no z-index', () => {
    const css = '.header {\n  color: red;\n}\n'
    expect(Number.isNaN(readZIndex(css, '.header'))).toBe(true)
  })

  it('is NaN when the rule is not there at all', () => {
    const css = '.other {\n  z-index: 10;\n}\n'
    expect(Number.isNaN(readZIndex(css, '.header'))).toBe(true)
  })
})
