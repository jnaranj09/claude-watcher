// The one source scanner behind the structural guards in tests/main (layers, silent catches, type
// assertions). It reads `src/` the way the compiler does — through the TypeScript AST — so a
// comment or a string that merely LOOKS like an import, a catch or a cast is never counted.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

export const SRC = resolve(__dirname, '../../src')

/** Path relative to `src/`, always with `/` (stable keys for allow-lists and messages). */
export const srcRel = (file: string): string => relative(SRC, file).split(sep).join('/')

/** Every shipped source file under `src/`: no tests, no fixtures. `.d.ts` only when asked. */
export function sourceFiles(options: { declarations?: boolean } = {}): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== '__fixtures__' && e.name !== 'test') walk(p)
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        if (options.declarations === true || !e.name.endsWith('.d.ts')) out.push(p)
      }
    }
  }
  walk(SRC)
  return out.sort()
}

export function parseSource(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

// ── Layers (technical-taste §5b-16) ─────────────────────────────────────────────────────────────

/** Module specifiers of every import, re-export, `import type`, `import('x')` type and dynamic
 *  `import('x')` in the file. */
export function importSpecifiers(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      out.push(node.argument.literal.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const BANNED_LAYERS: Record<string, { layers: readonly string[]; packages: readonly string[] }> = {
  shared: { layers: ['main', 'preload', 'renderer'], packages: ['electron', 'node-pty'] },
  renderer: { layers: ['main', 'preload'], packages: ['electron', 'node-pty'] },
  preload: { layers: ['main', 'renderer'], packages: ['node-pty'] },
  main: { layers: ['preload', 'renderer'], packages: [] }
}

/** `<file> → <target>` for each specifier that crosses a banned layer line. */
export function layerViolations(file: string, specifiers: readonly string[]): string[] {
  const from = srcRel(file)
  const banned = BANNED_LAYERS[from.split('/')[0] ?? '']
  if (banned === undefined) return []
  const hits: string[] = []
  for (const spec of specifiers) {
    if (spec.startsWith('.')) {
      const target = srcRel(resolve(dirname(file), spec))
      if (banned.layers.includes(target.split('/')[0] ?? '')) hits.push(`${from} → ${target}`)
    } else if (banned.packages.some((p) => spec === p || spec.startsWith(`${p}/`))) {
      hits.push(`${from} → ${spec}`)
    }
  }
  return hits
}

// ── Silent catches (technical-taste §5b-17) ─────────────────────────────────────────────────────

/** Catch blocks with no statement: `empty` (nothing at all), `commented` (only a comment) and,
 *  of those, `unexplained` (the comment is under 3 words — `/* ignore *\/` says no why). */
export function silentCatches(sf: ts.SourceFile): {
  empty: number
  commented: number
  unexplained: number
} {
  const text = sf.getFullText()
  const r = { empty: 0, commented: 0, unexplained: 0 }
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const inner = text.slice(node.block.getStart(sf) + 1, node.block.getEnd() - 1)
      const words = inner
        .replace(/\/\*|\*\/|\/\//g, ' ')
        .split(/\s+/)
        .filter((w) => /\w/.test(w))
      if (words.length === 0) r.empty++
      else {
        r.commented++
        if (words.length < 3) r.unexplained++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return r
}

// ── Type assertions (technical-taste §5b-9) ─────────────────────────────────────────────────────

/** `x as T` and `<T>x` in the file. `as const` is a literal-type hint, not an assertion. */
export function assertionCount(sf: ts.SourceFile): number {
  let n = 0
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node)) {
      const constHint =
        ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(sf) === 'const'
      if (!constHint) n++
    } else if (ts.isTypeAssertionExpression(node)) {
      n++
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return n
}
