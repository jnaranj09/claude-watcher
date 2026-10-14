// Guard: a checkbox is `components/Checkbox` (it selects things) or `components/Switch` (an on/off
// setting), and a radio is `components/Radio`; never a bare `<input type="checkbox">` or
// `<input type="radio">`, which paint the native blue in every theme. An <input> whose type is
// computed or comes from a spread could hide one, so it fails too.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const rendererDir = join(__dirname, '..')
/** The owners of each native input type. */
const OWNERS: Record<'checkbox' | 'radio', ReadonlySet<string>> = {
  checkbox: new Set(['components/Checkbox/Checkbox.tsx', 'components/Switch/Switch.tsx']),
  radio: new Set(['components/Radio/Radio.tsx'])
}

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

/** A spread whose every outcome is an object literal with no `type` key cannot set the type. */
function spreadWithoutType(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return spreadWithoutType(e.expression)
  if (ts.isConditionalExpression(e)) {
    return spreadWithoutType(e.whenTrue) && spreadWithoutType(e.whenFalse)
  }
  if (!ts.isObjectLiteralExpression(e)) return false
  return e.properties.every(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      !/^['"]?type['"]?$/.test(p.name.getText())
  )
}

/** Every raw JSX element in `text` whose `type` names `kind`, as `line <tag>`. */
function bareInputs(text: string, kind: keyof typeof OWNERS): string[] {
  const src = ts.createSourceFile('x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const isInput = node.tagName.getText(src) === 'input'
      const hit = (): void => {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src))
        hits.push(`${line + 1} <${node.tagName.getText(src)}>`)
      }
      for (const attr of node.attributes.properties) {
        // A spread may carry the type: an <input> takes only one that cannot.
        if (ts.isJsxSpreadAttribute(attr)) {
          if (isInput && !spreadWithoutType(attr.expression)) hit()
          continue
        }
        if (attr.name.getText(src) !== 'type') continue
        const init = attr.initializer
        if (init === undefined) continue
        const value = ts.isStringLiteral(init) ? init.text : init.getText(src)
        // An <input>'s type must be readable here: a string, never a computed value.
        const computed =
          ts.isJsxExpression(init) &&
          init.expression !== undefined &&
          !ts.isStringLiteral(init.expression)
        if (value.includes(kind) || (isInput && computed)) hit()
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return hits
}

describe.each(['checkbox', 'radio'] as const)('bare %s guard', (kind) => {
  it(`no renderer file but its owners renders a bare ${kind}`, () => {
    const files = tsxFiles()
    expect(files.length).toBeGreaterThan(50)
    const hits = files.flatMap((f) => {
      const rel = relative(rendererDir, f)
      if (OWNERS[kind].has(rel)) return []
      return bareInputs(readFileSync(f, 'utf8'), kind).map((h) => `${rel}:${h}`)
    })
    expect(hits).toEqual([])
  })

  // A computed type or a spread could hide a checkbox or a radio, so an <input> may not use either.
  it('sees an <input> whose type it cannot read: an expression or a spread', () => {
    expect(bareInputs('const a = <input type={t} />', kind)).toHaveLength(1)
    expect(bareInputs('const a = <input {...props} />', kind)).toHaveLength(1)
    expect(bareInputs("const a = <input {...(c ? { type: 'x' } : {})} />", kind)).toHaveLength(1)
    // An object literal with no `type` key is readable: it is fine (TextInput's data attributes).
    expect(
      bareInputs('const a = <input type="text" {...(c ? { \'data-x\': 1 } : {})} />', kind)
    ).toEqual([])
    expect(bareInputs('const a = <Button type={t} {...props} />', kind)).toEqual([])
  })

  it(`sees a bare ${kind}, in a string or an expression, and not one in a comment`, () => {
    expect(bareInputs(`const a = <input type="${kind}" />`, kind)).toHaveLength(1)
    expect(bareInputs(`const a = <input type={'${kind}'} />`, kind)).toHaveLength(1)
    expect(
      bareInputs(`// <input type="${kind}" />\nconst a = <input type="text" />`, kind)
    ).toEqual([])
  })
})
