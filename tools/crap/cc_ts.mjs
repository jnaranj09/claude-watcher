#!/usr/bin/env node
// Copied 2026-11-24 from the dev-project-bootstrap skill (scripts/crap/cc_ts.mjs). Changes here:
// Prettier style, and `ownName`/`count` split into small helpers so each function stays under this
// repo's complexity cap (10). The counting is unchanged; tests/unit/crap.test.ts pins it.
//
// Per-function cyclomatic complexity for TS/JS files, using the TARGET REPO's own `typescript` package
// (classic compiler API: createSourceFile / forEachChild). Nothing is installed by this script.
//
// Usage: node cc_ts.mjs [--root DIR] [--resolve-from DIR] PATH...
//   --resolve-from (or env CRAP_TS_RESOLVE_FROM): folder to resolve `typescript` from (default cwd).
// Exit 2 with a message when `typescript` cannot be resolved or has no createSourceFile (TypeScript 7
// native builds expose no JS compiler API: use the repo's 5.x/6.x, or skip this extractor).
// Output: JSON list [{file,name,start,end,cc}]. CC = 1 + each `if`, `for`, `for…in`, `for…of`,
// `while`, `do`, `case` (not `default`), `catch`, ternary, `&&`, `||`, `??` (optional chaining is
// not counted). Named nested functions (declarations, methods, `const f = () => …`) are their own
// rows (`outer.inner`), not counted in the parent; anonymous callbacks count in the parent. `start`
// is the first body statement's line, so a never-called `const f = () => {` shows no covered line.
// Skipped: node_modules, dist, build, coverage, __tests__, dot folders, `.d.ts`, `*.test.*`, `*.spec.*`.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
let root = process.cwd()
let resolveFrom = process.env.CRAP_TS_RESOLVE_FROM || process.cwd()
const paths = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = path.resolve(argv[++i])
  else if (argv[i] === '--resolve-from') resolveFrom = path.resolve(argv[++i])
  else paths.push(argv[i])
}
if (paths.length === 0) {
  console.error('usage: node cc_ts.mjs [--root DIR] [--resolve-from DIR] PATH...')
  process.exit(2)
}

let ts
try {
  ts = createRequire(path.join(resolveFrom, 'noop.js'))('typescript')
} catch {
  console.error(
    `cc_ts: cannot resolve the 'typescript' package from ${resolveFrom}. Run from the target repo (or pass --resolve-from) after its dependencies are installed.`
  )
  process.exit(2)
}
if (typeof ts.createSourceFile !== 'function') {
  console.error(
    `cc_ts: 'typescript' ${ts.version ?? '?'} has no JS compiler API (TypeScript 7 native build?). Use a 5.x/6.x install.`
  )
  process.exit(2)
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__'])
const EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const SKIP_FILE = /(\.d\.ts|\.test\.[a-z]+|\.spec\.[a-z]+)$/

function* filesUnder(p) {
  const st = fs.statSync(p)
  if (st.isFile()) {
    yield p
    return
  }
  for (const e of fs
    .readdirSync(p, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const q = path.join(p, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) yield* filesUnder(q)
    } else if (EXT.test(e.name) && !SKIP_FILE.test(e.name)) yield q
  }
}

const isFnExpr = (n) => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))

const isMethodLike = (n) =>
  ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)
const isFnHolder = (n) =>
  (ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n)) &&
  isFnExpr(n.initializer)

// Name of a node that is reported as its own function, or null (anonymous: counted in the parent).
function ownName(n) {
  if (ts.isFunctionDeclaration(n) && n.name) return n.name.text
  if (ts.isConstructorDeclaration(n)) return 'constructor'
  if ((isMethodLike(n) || isFnHolder(n)) && n.name) return n.name.getText()
  return null
}

const DECISION_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression
])
const DECISION_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken
])
const isDecision = (x) =>
  DECISION_KINDS.has(x.kind) ||
  (x.kind === ts.SyntaxKind.BinaryExpression && DECISION_OPERATORS.has(x.operatorToken.kind))

function count(fnNode) {
  let n = 1
  const visit = (x) => {
    if (x !== fnNode && ownName(x) !== null) return // reported separately
    if (isDecision(x)) n++
    ts.forEachChild(x, visit)
  }
  ts.forEachChild(fnNode, visit)
  return n
}

const out = []
for (const p of paths)
  for (const f of filesUnder(p)) {
    const text = fs.readFileSync(f, 'utf8')
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true)
    const rel = path.relative(root, path.resolve(f)).split(path.sep).join('/')
    const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
    // First line that runs when the function is CALLED: the first statement of a block (not the `{`, which
    // for `const f = () => {` shares a line with the `const` that runs at import); an expression body's own start.
    const firstBodyPos = (body) =>
      (ts.isBlock(body) && body.statements.length > 0 ? body.statements[0] : body).getStart(sf)
    if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
      const d = sf.parseDiagnostics[0]
      console.error(
        `cc_ts: cannot parse ${f}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (line ${line(d.start ?? 0)})`
      )
      process.exit(2)
    }
    const walk = (node, prefix) => {
      const nm = ownName(node)
      if (nm !== null) {
        const full = prefix + nm
        const fnNode = isFnExpr(node.initializer) ? node.initializer : node
        if (fnNode.body !== undefined) {
          out.push({
            file: rel,
            name: full,
            start: line(firstBodyPos(fnNode.body)),
            end: line(node.getEnd()),
            cc: count(fnNode)
          })
        }
        ts.forEachChild(node, (c) => walk(c, full + '.'))
        return
      }
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
        ts.forEachChild(node, (c) => walk(c, prefix + node.name.text + '.'))
        return
      }
      ts.forEachChild(node, (c) => walk(c, prefix))
    }
    walk(sf, '')
  }
process.stdout.write(JSON.stringify(out, null, 1) + '\n')
