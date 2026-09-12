// ManageDialog owns the Manage-dialog styles (spec 2026-09-11 §0.3). Before it, the Delete button
// classes were copied into every dialog module and design.md told the next author to copy them
// again — the drift story TextInput.test.tsx tells about `.input`. This guard is how "copy the
// sibling" cannot come back.
//
// Reads the stylesheets off disk on purpose: `vitest.config.ts` sets no `css` option, so an
// imported *.module.css is a proxy that answers EVERY key with a string — an assertion on
// `styles.x` could never fail (.claude/rules/design.md).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const componentsDir = join(process.cwd(), 'src/renderer/src/components')

/** True when `css` has a rule whose selector list starts a line with `selector`. */
function declares(css: string, selector: string): boolean {
  return new RegExp(`^\\${selector}[\\s{:,\\[]`, 'm').test(css)
}

function componentModules(): { name: string; css: string }[] {
  const out: { name: string; css: string }[] = []
  for (const dir of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    for (const file of readdirSync(join(componentsDir, dir.name))) {
      if (!file.endsWith('.module.css')) continue
      out.push({
        name: `${dir.name}/${file}`,
        css: readFileSync(join(componentsDir, dir.name, file), 'utf8')
      })
    }
  }
  return out
}

describe('ManageDialog owns the Manage-dialog styles', () => {
  it('is the only module that declares the Delete button classes', () => {
    const offenders: string[] = []
    for (const { name, css } of componentModules()) {
      if (name.startsWith('ManageDialog/')) continue
      for (const selector of ['.deleteButton', '.dangerButton']) {
        if (declares(css, selector)) offenders.push(`${name} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the three Manage dialogs draw no shell and no button of their own', () => {
    const offenders: string[] = []
    for (const name of [
      'TemplatesDialog/TemplatesDialog.module.css',
      'ShortcutsDialog/ShortcutsDialog.module.css',
      'WorkspacesDialog/WorkspacesDialog.module.css'
    ]) {
      const css = readFileSync(join(componentsDir, name), 'utf8')
      for (const selector of [
        '.overlay',
        '.panel',
        '.header',
        '.closeButton',
        '.primaryButton',
        '.ghostButton',
        '.error'
      ]) {
        if (declares(css, selector)) offenders.push(`${name} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // Non-vacuity: the two guards above pass trivially if the classes vanish everywhere.
  it('declares both Delete classes itself', () => {
    const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
    expect(declares(css, '.deleteButton')).toBe(true)
    expect(declares(css, '.dangerButton')).toBe(true)
  })
})
