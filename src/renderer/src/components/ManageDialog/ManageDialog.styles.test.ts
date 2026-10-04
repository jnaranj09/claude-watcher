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

/** The declaration text of every rule whose selector list names `selector` (the same matcher
 *  `declares` uses), comments stripped and joined. `''` when no such rule exists — so an assertion
 *  on a property passes only when the rule IS there and carries it. */
function ruleBody(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const pattern = new RegExp(`(^|[\\s,>+~(])\\${selector}(?![\\w-])`)
  const bodies: string[] = []
  let start = 0
  let prelude = ''
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      prelude = stripped.slice(start, i)
      start = i + 1
    } else if (stripped[i] === '}') {
      if (pattern.test(prelude)) bodies.push(stripped.slice(start, i))
      prelude = ''
      start = i + 1
    }
  }
  return bodies.join('\n')
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
  // The buttons themselves — Save, Delete (armed in place), Cancel, + New, ✕ — moved to
  // `components/Button` (its own guard, Button.test.tsx). This shell draws none of its own.
  it('declares no button of its own', () => {
    const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
    for (const selector of [
      '.deleteButton',
      '.dangerButton',
      '.primaryButton',
      '.ghostButton',
      '.closeButton'
    ]) {
      expect(declares(css, selector), selector).toBe(false)
    }
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

  // Non-vacuity: the guard above passes trivially if the detector is broken. The slot rule is real.
  it('declares the rail`s bottom slot itself', () => {
    const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
    expect(declares(css, '.listBottom')).toBe(true)
  })
})

// The panel is centred in a fixed overlay, so anything taller than the window overflows BOTH
// edges: the ✕ goes off the top and `[Delete] [Save]` off the bottom, neither reachable by mouse.
// That is exactly what the Templates form did once the API's `Initial prompt` + `Parameters` rows
// grew it (~230px) against the app's default 1000×700 window — measured save rect.bottom 747 vs
// innerHeight 700. These three declarations are the fix, and all three are load-bearing: without
// the `minmax(0, 1fr)` row the grid sizes itself to the form's content and `overflow-y` never
// engages.
describe('the shell fits the window (the ✕ and the footer stay reachable)', () => {
  const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')

  it('caps .panel to the viewport height', () => {
    expect(ruleBody(css, '.panel')).toMatch(/max-height:\s*calc\(100vh/)
  })

  it('caps the body grid row so the form cannot size the panel past that cap', () => {
    expect(ruleBody(css, '.columns')).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/)
  })

  it('scrolls the form — the smallest region that leaves the rail and the header alone', () => {
    expect(ruleBody(css, '.form')).toMatch(/overflow-y:\s*auto/)
  })

  // `overflow-y: auto` makes overflow-x compute to `auto` too, so the form clips at its padding box
  // on EVERY side — not just the one it scrolls. A field flush with that edge loses its
  // `outline: 2px` + `outline-offset: 1px` focus ring (3px) to the clip. Both buffers, or the ring
  // is cut on one side of every full-width field in the form: measured `left: 0` on
  // `template-name` and `template-prompt` with `padding: 0px 8px 0px 0px`.
  it('buffers the focus ring on BOTH horizontal edges of its clip box', () => {
    const form = ruleBody(css, '.form')
    expect(form).toMatch(/padding-left:\s*var\(--inset-compact-x\)/)
    expect(form).toMatch(/padding-right:\s*var\(--inset-compact-x\)/)
  })

  it('leaves the rail`s own scroll and its `+ New` bottom pin intact', () => {
    expect(ruleBody(css, '.rows')).toMatch(/overflow-y:\s*auto/)
    expect(ruleBody(css, '.rows')).toMatch(/max-height:\s*360px/)
    expect(ruleBody(css, '.listBottom')).toMatch(/margin-top:\s*auto/)
  })

  it('the Pane shares the Form rule: one scroll region, both paddings, scroll padding', () => {
    const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
    const body = ruleBody(css, '.pane')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('padding-left: var(--inset-compact-x)')
    expect(body).toContain('padding-right: var(--inset-compact-x)')
    expect(body).toContain('scroll-padding-block: var(--inset-compact-x)')
    expect(ruleBody(css, '.form')).toBe(body)
  })

  it('the Placeholder text is --text-secondary, centred, and stretches to the row', () => {
    const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
    const body = ruleBody(css, '.placeholder')
    expect(body).toContain('color: var(--text-secondary)')
    expect(body).toContain('align-self: stretch')
    expect(body).toContain('justify-content: center')
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

// Non-vacuity for the four guards above: a `ruleBody` that answered with the whole stylesheet, or
// with a sibling's block, would pass them no matter what `.panel` says.
describe('ruleBody() returns THAT rule`s declarations and nothing else', () => {
  const css = '.panel {\n  max-height: 10px;\n}\n.panelWide {\n  max-height: 20px;\n}\n'

  it('does not answer with a longer class sharing the prefix', () => {
    expect(ruleBody(css, '.panel')).toContain('max-height: 10px')
    expect(ruleBody(css, '.panel')).not.toContain('max-height: 20px')
  })

  it('is empty for a rule that is not there', () => {
    expect(ruleBody(css, '.missing')).toBe('')
  })

  it('does not leak a neighbouring rule`s declarations', () => {
    expect(ruleBody('.a {\n  color: red;\n}\n.b {\n  color: blue;\n}\n', '.b')).not.toContain('red')
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

// Spacing roles (spec 2026-10-01-spacing-roles-design.md): a label sits closer to its own field
// than to the field above, and a form taller than the window scrolls UNDER [Delete] [Save].
describe('ManageDialog form rhythm', () => {
  const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    if (at === -1) throw new Error(`no ${selector} rule`)
    return css.slice(at, css.indexOf('}', at))
  }

  it('label → field is --gap-field; field → next label is --gap-section', () => {
    expect(rule('.form,\n.pane')).toMatch(/gap:\s*var\(--gap-field\)/)
    expect(rule('.label')).toMatch(
      /margin-top:\s*calc\(var\(--gap-section\) - var\(--gap-field\)\)/
    )
  })

  it('the scrolling form keeps its side buffer, so focus rings are not clipped', () => {
    expect(rule('.form,\n.pane')).toMatch(/padding-left:\s*var\(--inset-compact-x\)/)
    expect(rule('.form,\n.pane')).toMatch(/padding-right:\s*var\(--inset-compact-x\)/)
  })

  it('the footer is sticky at the bottom of the form, so Save is always visible', () => {
    expect(rule('.footer')).toMatch(/position:\s*sticky/)
    expect(rule('.footer')).toMatch(/bottom:\s*0/)
  })
})

describe('ManageDialog sticky footer never hides a field (final review)', () => {
  const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`)
    if (at === -1) throw new Error(`no ${selector} rule`)
    return css.slice(at, css.indexOf('}', at))
  }

  it('Tab scrolls a field clear of the sticky footer, not under it', () => {
    expect(rule('.form,\n.pane')).toMatch(
      /scroll-padding-block:\s*var\(--inset-compact-x\)\s+calc\(32px \+ var\(--gap-actions\) \+ var\(--inset-compact-y\) \+ var\(--inset-compact-x\)\)/
    )
  })

  // The space sits INSIDE the sticky footer (its padding), so it stays while the form scrolls
  // under it. No negative margin: the footer box paints over the field above it (z-index 1), so
  // the form's --gap-field must stay between them or the last field's focus ring is covered
  // (drive check 2026-10-02: Tab to `template-prompt` ended 0px from the footer box).
  it('the last field sits at least --gap-actions above the buttons, also while sticky', () => {
    expect(rule('.footer')).toMatch(/padding-top:\s*var\(--gap-actions\)/)
    expect(rule('.footer')).not.toMatch(/margin-top/)
  })

  it('the first label starts level with the first rail row', () => {
    expect(css).toMatch(
      /\.form > \.label:first-child,\s*\.pane > \.label:first-child\s*\{[^}]*margin-top:\s*0/
    )
  })
})

// Region spacing (spec 2026-10-02-region-spacing-design.md): two different regions never sit
// closer than --gap-group; a footnote belongs to its slot (--gap-field).
describe('ManageDialog region spacing', () => {
  const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')

  it('rail regions (search, list, bottom slot) are --gap-group apart', () => {
    expect(ruleBody(css, '.list')).toMatch(/gap:\s*var\(--gap-group\)/)
  })

  it('the bottom slot is pinned and its footnote belongs to it', () => {
    const body = ruleBody(css, '.listBottom')
    expect(body).toMatch(/margin-top:\s*auto/)
    expect(body).toMatch(/gap:\s*var\(--gap-field\)/)
    // Stacked, not side by side (Retry / Resume row / note in a 220px rail); a Button keeps its width.
    expect(body).toMatch(/flex-direction:\s*column/)
    expect(body).toMatch(/align-items:\s*flex-start/)
  })

  it('the footnote is secondary text with no margin of its own', () => {
    const body = ruleBody(css, '.listNote')
    expect(body).toMatch(/margin:\s*0;/)
    expect(body).toMatch(/color:\s*var\(--text-secondary\)/)
  })

  it('Past sessions` Resume row spans the slot (the slot is flex-start)', () => {
    const past = readFileSync(
      join(componentsDir, 'PastSessionsDialog/PastSessionsDialog.module.css'),
      'utf8'
    )
    expect(ruleBody(past, '.resumeById')).toMatch(/align-self:\s*stretch/)
  })

  it('title → description is --gap-field', () => {
    expect(ruleBody(css, '.headerText')).toMatch(/gap:\s*var\(--gap-field\)/)
  })

  it('a different region under the list sits behind a divider, --gap-section each side (spec 2026-10-03 I)', () => {
    const body = ruleBody(css, '.listBottomDivided')
    expect(body).toMatch(/border-top:\s*1px solid var\(--border\)/)
    expect(body).toMatch(/padding-top:\s*var\(--gap-section\)/)
    // The line spans the rail; the slot's own items stay flex-start.
    expect(body).toMatch(/align-self:\s*stretch/)
    // Above the line: the rail's --gap-group plus the rows' margin = --gap-section. Matched on the
    // raw sheet: `ruleBody` builds a RegExp from the selector, and `(`, `+` would break it.
    expect(css).toMatch(
      /\.rows:has\(\+ \.listBottomDivided\)\s*\{[^}]*margin-bottom:\s*calc\(var\(--gap-section\) - var\(--gap-group\)\)/
    )
  })

  it('the list fades at its end only while more rows are below (design.md rule 8)', () => {
    // Raw-sheet match: `[` in the selector would break `ruleBody`'s RegExp.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).toMatch(
      /\.rows\[data-overflow-end\]\s*\{[^}]*mask-image:\s*linear-gradient\(to bottom, black calc\(100% - 32px\), transparent\)/
    )
    // Exactly one mask in the sheet, and it is that rule: never on the plain .rows at rest.
    expect(stripped.match(/mask-image/g)).toHaveLength(1)
  })

  it('a row reached by keyboard parks above the fade, not inside it', () => {
    // Chromium scrolls a focused row to the nearest edge; without this its lower 32px (and focus
    // ring) would sit in the faded band. Same length as the fade.
    expect(ruleBody(css, '.rows')).toMatch(/scroll-padding-bottom:\s*32px/)
  })
})

// Region spacing inside the dialogs' own sheets (spec 2026-10-02-region-spacing-design.md).
describe('dialog sheets keep the region rules', () => {
  it('Settings rows share one height: a checkbox row is as tall as a dropdown row', () => {
    const css = readFileSync(join(componentsDir, 'Settings/Settings.module.css'), 'utf8')
    expect(ruleBody(css, '.row')).toMatch(
      /min-height:\s*calc\(36px \+ 2 \* var\(--inset-card\) \+ 1px\)/
    )
  })

  it('a Rules state note clears the next control by --gap-inline (form gap + the rest)', () => {
    const css = readFileSync(join(componentsDir, 'RulesDialog/RulesDialog.module.css'), 'utf8')
    expect(ruleBody(css, '.note')).toMatch(
      /margin-bottom:\s*calc\(var\(--gap-inline\) - var\(--gap-field\)\)/
    )
  })
})

describe('ManageDialog page column (spec 2026-10-03 C)', () => {
  const css = readFileSync(join(componentsDir, 'ManageDialog/ManageDialog.module.css'), 'utf8')
  // Raw-sheet matches: `ruleBody` builds a RegExp from the selector; `(`, `[` and `>` break it.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('sits left of the rail behind its own edge; a third track only beside a rail', () => {
    const pages = /\n\.pages\s*\{([^}]*)\}/.exec(stripped)?.[1] ?? ''
    expect(pages).toMatch(/width:\s*132px/)
    expect(pages).toMatch(/border-right:\s*1px solid var\(--border\)/)
    expect(pages).toMatch(/padding-right:\s*var\(--gap-page\)/)
    expect(stripped).toMatch(
      /\.columns:has\(> \.pages\):has\(> \.list\)\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\)/
    )
  })

  it('the current page is QUIETER than a selected row: ink + a 2px bar, no fill', () => {
    const current = /\.page\[aria-current='page'\]\s*\{([^}]*)\}/.exec(stripped)?.[1] ?? ''
    expect(current).toMatch(/color:\s*var\(--text-primary\)/)
    expect(current).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--border-strong\)/)
    expect(current).not.toMatch(/background/)
    // Same height, font and hover as a rail row (and a Settings category row): one rule.
    expect(stripped).toMatch(/\.rowSelect,\s*\.page\s*\{/)
    expect(stripped).toMatch(/\.rowSelect:hover,\s*\.page:hover\s*\{/)
    expect(stripped).toMatch(/\.rowSelect:focus-visible,\s*\.page:focus-visible\s*\{/)
  })
})
