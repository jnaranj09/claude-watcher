// ManageDialog owns the Manage-dialog styles (spec 2026-09-11 §0.3). Before it, the Delete button
// classes were copied into every dialog module and design.md told the next author to copy them
// again — the drift story TextInput.test.tsx tells about `.input`. This guard is how "copy the
// sibling" cannot come back.
//
// Reads the stylesheets off disk on purpose: `vitest.config.ts` sets no `css` option, so an
// imported *.module.css is a proxy that answers EVERY key with a string — an assertion on
// `styles.x` could never fail (.claude/rules/design.md).
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const componentsDir = join(process.cwd(), 'src/renderer/src/components')

/** True when `css` names the class `selector` in a selector — anywhere a selector can: a
 *  descendant/combinator target (`.folderRow .deleteButton`), mid comma-list (`.x, .deleteButton`),
 *  indented, or nested inside `@media`. Runs ONLY over selector text (see `selectorSegments`), so a
 *  `content: ".deleteButton"` declaration value or a comment mentioning the class can't trip it. */
function declares(css: string, selector: string): boolean {
  const pattern = new RegExp(`(^|[\\s,>+~(])\\${selector}(?![\\w-])`)
  return selectorSegments(css).some((segment) => pattern.test(segment))
}

/** The selector-list text preceding every `{` in `css`, comments stripped. Plain CSS (no nesting)
 *  never puts a `{` inside a declaration body, and every `{` is preceded by either a selector list
 *  or an at-rule prelude (`@media (...)`) — so splitting on every brace and keeping only the
 *  segments that end in `{` (dropping the ones that end in `}`, i.e. declaration bodies) captures
 *  every real selector occurrence, top-level and nested inside `@media`, and nothing else. */
function selectorSegments(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const segments: string[] = []
  let start = 0
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      segments.push(stripped.slice(start, i))
      start = i + 1
    } else if (stripped[i] === '}') {
      start = i + 1
    }
  }
  return segments
}

/** Recurses — a `*.module.css` any number of directories under `baseDir` must still be seen (a
 *  sibling dialog one folder deeper is a real place for a copy of a guarded class to hide). */
function componentModules(baseDir: string = componentsDir): { name: string; css: string }[] {
  const out: { name: string; css: string }[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relName = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relName)
      } else if (entry.name.endsWith('.module.css')) {
        out.push({ name: relName, css: readFileSync(join(dir, entry.name), 'utf8') })
      }
    }
  }
  walk(baseDir, '')
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

// The detector only ever saw a selector that starts a line — a descendant target, a selector
// mid comma-list, an indented rule, or a module one directory deeper all slipped past it. These
// feed it exactly those cases.
describe('declares() sees a selector anywhere a selector can name it', () => {
  it('a descendant selector (`.folderRow .deleteButton`)', () => {
    const css = '.folderRow .deleteButton {\n  color: red;\n}\n'
    expect(declares(css, '.deleteButton')).toBe(true)
  })

  it('an indented top-level rule', () => {
    const css = '.card {\n  color: blue;\n}\n\n  .deleteButton {\n    color: red;\n  }\n'
    expect(declares(css, '.deleteButton')).toBe(true)
  })

  it('mid a comma-separated selector list, same line (`.x, .deleteButton`)', () => {
    const css = '.x, .deleteButton {\n  color: red;\n}\n'
    expect(declares(css, '.deleteButton')).toBe(true)
  })

  it('nested inside an @media block', () => {
    const css =
      '@media (prefers-reduced-motion: reduce) {\n  .deleteButton {\n    color: red;\n  }\n}\n'
    expect(declares(css, '.deleteButton')).toBe(true)
  })

  it('does not flag a longer class name sharing the prefix', () => {
    const css = '.deleteButtonWide {\n  color: red;\n}\n'
    expect(declares(css, '.deleteButton')).toBe(false)
  })

  it('does not flag a comment or a declaration value naming the class', () => {
    const css = '/* .deleteButton lives here once */\n.foo {\n  content: ".deleteButton";\n}\n'
    expect(declares(css, '.deleteButton')).toBe(false)
  })
})

describe('componentModules() scans every *.module.css under baseDir, any number of levels deep', () => {
  let tmpDir: string | undefined

  afterEach(() => {
    if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  it('finds a module one directory deeper than a component dir', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'manage-dialog-styles-test-'))
    const nestedDir = join(tmpDir, 'TemplatesDialog', 'nested')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(nestedDir, 'Deep.module.css'), '.deleteButton {\n  color: red;\n}\n')

    const modules = componentModules(tmpDir)

    expect(modules).toContainEqual({
      name: 'TemplatesDialog/nested/Deep.module.css',
      css: '.deleteButton {\n  color: red;\n}\n'
    })
  })
})
