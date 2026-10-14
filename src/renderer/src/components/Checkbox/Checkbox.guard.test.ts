// Guard: a checkbox is `components/Checkbox` (it selects things) or `components/Switch` (an on/off
// setting), never a bare `<input type="checkbox">`, which paints the native blue in every theme.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const rendererDir = join(__dirname, '..', '..')
/** The two owners of the native checkbox. */
const OWNERS = new Set(['components/Checkbox/Checkbox.tsx', 'components/Switch/Switch.tsx'])

function tsxFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(p)
    }
  }
  walk(rendererDir)
  return out
}

/** Every raw JSX element in `text` with `type="checkbox"`, as `line <tag>`. */
function bareCheckboxes(text: string): string[] {
  const src = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || attr.name.getText(src) !== 'type') continue
        const init = attr.initializer
        if (init === undefined) continue
        const value = ts.isStringLiteral(init) ? init.text : init.getText(src)
        if (value.includes('checkbox')) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart(src))
          hits.push(`${line + 1} <${node.tagName.getText(src)}>`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return hits
}

describe('Checkbox guard', () => {
  it('no renderer file but the two owners renders a bare checkbox', () => {
    const files = tsxFiles()
    expect(files.length).toBeGreaterThan(50)
    const hits = files.flatMap((f) => {
      const rel = relative(rendererDir, f)
      if (OWNERS.has(rel)) return []
      return bareCheckboxes(readFileSync(f, 'utf8')).map((h) => `${rel}:${h}`)
    })
    expect(hits).toEqual([])
  })

  it('sees a bare checkbox, in a string or an expression, and not one in a comment', () => {
    expect(bareCheckboxes('const a = <input type="checkbox" />')).toHaveLength(1)
    expect(bareCheckboxes("const a = <input type={'checkbox'} />")).toHaveLength(1)
    expect(bareCheckboxes('// <input type="checkbox" />\nconst a = <input type="text" />')).toEqual(
      []
    )
  })
})
