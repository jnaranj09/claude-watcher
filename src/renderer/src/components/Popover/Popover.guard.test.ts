// The structural guard (spec 2026-10-01-popover-standard-design.md), like Button's and TextInput's:
// the next hand-made popover turns this red before a screenshot has to.
//   1. No `.tsx` outside components/Popover/ puts a menu / list role on a RAW element (a lower-case
//      JSX tag). Passing a role to `Popover.*` is the allowed path.
//   2. No `.module.css` outside Popover draws a popover box: `--shadow-pop` is its signature.
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import ts from 'typescript'

const rendererDir = join(__dirname, '..', '..')
const MENU_ROLES = new Set([
  'menu',
  'listbox',
  'menuitem',
  'option',
  'menuitemradio',
  'menuitemcheckbox'
])
/** Modules that may use `--shadow-pop` and are NOT popovers, each with its reason. */
const SHADOW_POP_ALLOWED: Record<string, string> = {
  'components/Popover/Popover.module.css': 'the owner',
  'components/Toaster/Toaster.module.css': 'a toast is a notification, not a menu or list'
}

function files(ext: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(ext) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
    }
  }
  walk(rendererDir)
  return out
}

/** Every raw JSX element in `file` whose `role` is (or may evaluate to) a menu / list role. */
function rawMenuRoles(file: string): string[] {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(src)
      if (/^[a-z]/.test(tag)) {
        for (const attr of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attr) ||
            attr.name.getText(src) !== 'role' ||
            attr.initializer === undefined
          )
            continue
          const init = attr.initializer
          const text = ts.isStringLiteral(init) ? init.text : init.getText(src)
          const named = ts.isStringLiteral(init)
            ? MENU_ROLES.has(text)
            : [...MENU_ROLES].some((r) => new RegExp(`['"\`]${r}['"\`]`).test(text)) ||
              /\{\s*role\s*\}/.test(text)
          if (named) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart(src))
            hits.push(`${relative(rendererDir, file)}:${line + 1} <${tag} role=${text}>`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return hits
}

const tmpFiles: string[] = []
afterEach(() => {
  for (const f of tmpFiles.splice(0)) rmSync(f, { force: true })
})

describe('Popover owns every menu and list popup', () => {
  it('no raw element outside Popover carries a menu or list role', () => {
    const offenders = files('.tsx')
      .filter((f) => !relative(rendererDir, f).startsWith('components/Popover/'))
      .flatMap(rawMenuRoles)
    expect(offenders).toEqual([])
  })

  it('no CSS module outside the allow-list draws a popover box', () => {
    const offenders = files('.module.css')
      .map((f) => relative(rendererDir, f))
      .filter((rel) => !(rel in SHADOW_POP_ALLOWED))
      .filter((rel) => readFileSync(join(rendererDir, rel), 'utf8').includes('--shadow-pop'))
    expect(offenders).toEqual([])
  })

  // Non-vacuity: the walks must see the tree and the detector must fire.
  it('sees the renderer and catches a raw role', () => {
    expect(files('.tsx').length).toBeGreaterThan(20)
    expect(files('.module.css').length).toBeGreaterThan(20)
    const tmp = join(tmpdir(), `popover-guard-probe-${process.pid}.tsx`)
    tmpFiles.push(tmp)
    writeFileSync(tmp, 'export const X = () => <div role="menu" />\n')
    expect(rawMenuRoles(tmp)).toHaveLength(1)
    writeFileSync(tmp, 'export const X = () => <div role="dialog" />\n')
    expect(rawMenuRoles(tmp)).toEqual([])
  })
})

// Overlay motion (2026-10-04 review): a leaving Surface is inert, but the caller's positioned
// WRAPPER is still a hit target the size of the menu — a click during the 150 ms exit landed on it
// (and on a card, bubbled to the card and opened it). Every file that wraps a Surface marks its
// wrapper with `leavingProps`. ExpanderBox opens only from its chord, so it never plays an exit.
describe('a leaving popover lets clicks through its wrapper too', () => {
  const EXEMPT = new Set(['components/ExpanderBox/ExpanderBox.tsx'])
  const EXTRA = ['components/NewSessionMenu/NewSessionButton.tsx'] // its portal anchor
  it('every Popover.Surface caller puts leavingProps on its wrapper', () => {
    const callers = files('.tsx')
      .map((f) => relative(rendererDir, f))
      .filter((f) => !f.startsWith('components/Popover/') && !EXEMPT.has(f))
      .filter((f) => readFileSync(join(rendererDir, f), 'utf8').includes('<Popover.Surface'))
    expect(callers.length).toBeGreaterThan(5)
    const missing = [...callers, ...EXTRA].filter(
      (f) => !readFileSync(join(rendererDir, f), 'utf8').includes('leavingProps(')
    )
    expect(missing).toEqual([])
  })
})
