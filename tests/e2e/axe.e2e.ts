// Runtime accessibility (design.md "UI pipeline" stage 7): axe-core on the board and on every
// dialog the header menu opens, with the WCAG 2.0–2.2 A/AA tags. `wcag22aa` makes axe run
// `target-size` too. A violation fails the run unless ALLOWED lists its rule for that state;
// the list only shrinks (fix a violation, delete its entry in the same commit).
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Rule ids that already failed in a state when this spec landed (2026-11-23), with a reason. */
const NO_LANG = '`src/renderer/index.html` has no `lang` on <html> (one-line app fix, not done yet)'
const NAME_MISMATCH =
  'a control whose aria-label does not contain its visible text (to fix per control)'
const ALLOWED: Record<string, Record<string, string>> = {
  board: { 'html-has-lang': NO_LANG },
  settings: { 'html-has-lang': NO_LANG, 'label-content-name-mismatch': NAME_MISMATCH },
  shortcuts: { 'html-has-lang': NO_LANG, 'label-content-name-mismatch': NAME_MISMATCH },
  tags: { 'html-has-lang': NO_LANG, 'label-content-name-mismatch': NAME_MISMATCH },
  memory: { 'html-has-lang': NO_LANG, 'label-content-name-mismatch': NAME_MISMATCH }
}

/** Each state: how to reach it from the board. */
const STATES: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: 'board', open: async () => {} },
  { name: 'settings', open: (page) => fromMenu(page, ['app-menu-settings']) },
  { name: 'shortcuts', open: (page) => fromMenu(page, ['app-menu-shortcuts']) },
  { name: 'tags', open: (page) => fromMenu(page, ['app-menu-tags', 'tags-menu-manage-tags']) },
  { name: 'memory', open: (page) => fromMenu(page, ['app-menu-memory']) }
]

async function fromMenu(page: Page, path: string[]): Promise<void> {
  await page.getByTestId('app-menu').click()
  for (const id of path) await page.getByTestId(id).click()
  await expect(page.locator('[role="dialog"]:not([data-leaving])').first()).toBeVisible()
}

for (const state of STATES) {
  test(`axe finds no unlisted WCAG A/AA violation: ${state.name}`, async ({ page }) => {
    await expect(page.getByTestId('app-menu')).toBeVisible({ timeout: 20000 })
    await state.open(page)
    // Legacy mode: the default opens a blank page to merge frame results, and Electron refuses
    // new pages (`Target.createTarget: Not supported`). The app has no cross-origin frames.
    const result = await new AxeBuilder({ page }).withTags(TAGS).setLegacyMode().analyze()
    // `target-size` must have run (only `wcag22aa` turns it on): a run without it proves less.
    const ran = [
      ...result.violations,
      ...result.passes,
      ...result.incomplete,
      ...result.inapplicable
    ].map((r) => r.id)
    expect(ran).toContain('target-size')
    const allowed = ALLOWED[state.name] ?? {}
    const found = result.violations.map((v) => `${v.id} (${v.nodes.length})`)
    const unlisted = result.violations.filter((v) => !(v.id in allowed)).map((v) => v.id)
    expect(unlisted, `violations: ${found.join(', ')}`).toEqual([])
    const stale = Object.keys(allowed).filter((id) => !result.violations.some((v) => v.id === id))
    expect(stale, 'fixed violations: delete their ALLOWED entries').toEqual([])
  })
}
