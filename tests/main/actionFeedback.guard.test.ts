// Guard `action-feedback` (design.md "Feedback", UI pipeline stage 7): a component or view calls a
// preload bridge (`window.<bridge>.<method>(…)`) only from inside the feedback layer, a function
// handed to `useAsyncAction` (it owns busy and the double-submit guard; the function owns the
// error copy). A function counts when it is the hook's argument itself, or a named function (a
// declaration or a `const` arrow) whose name is passed to `useAsyncAction` in the same file.
//
// Walk: every non-test `.ts`/`.tsx` under `src/renderer/src/components/` and `views/`, and
// `App.tsx`. Bridges: every `exposeInMainWorld('<name>', …)` in `src/preload/`. A call outside the
// layer fails unless ALLOWED names its file with the EXACT count and a reason. The list only
// shrinks: a file that loses a call must lower its count (a count too high fails too).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { SRC, parseSource, srcRel } from './sourceScan'

const LISTENER =
  'push subscriptions and reads on mount or on a selection; no operator press to answer'

/** Bridge calls outside `useAsyncAction` when this guard landed (2026-11-24), with a reason. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'renderer/src/App.tsx': {
    count: 11,
    why: `${LISTENER}; the native folder picker (its own window is the feedback); the quit key and the Quit guard cancel (the guard is the feedback, a failure is logged)`
  },
  'renderer/src/components/ContextDialog/ContextDialog.tsx': { count: 4, why: LISTENER },
  'renderer/src/components/ContextDialog/ContextHistory.tsx': {
    count: 2,
    why: `${LISTENER}: the history list and a version's diff load into the pane; a failure is the dialog's error toast`
  },
  'renderer/src/components/ContextDialog/contextPages.tsx': {
    count: 1,
    why: 'Open in editor hands off to another app; a refusal is the dialog error toast (no busy, not yet moved to useAsyncAction)'
  },
  'renderer/src/components/MemoryDialog/MemoryPage.tsx': {
    count: 3,
    why: `${LISTENER}; the pin keeps its own per-row in-flight set (pinning) and a refusal toasts`
  },
  'renderer/src/components/MemoryDialog/useCommandList.ts': { count: 2, why: LISTENER },
  'renderer/src/components/MemoryDialog/useMemoryList.ts': { count: 3, why: LISTENER },
  'renderer/src/components/PastSessionsDialog/PastSessionsPage.tsx': {
    count: 1,
    why: `${LISTENER}: the selected record's episode`
  },
  'renderer/src/components/QuitGuard/QuitGuard.tsx': {
    count: 1,
    why: 'Cancel: the guard closing is the feedback; a failed cancel is logged, never toasted'
  },
  'renderer/src/components/Settings/Settings.tsx': {
    count: 3,
    why: `${LISTENER} (theme list, API token); Copy shows Button feedback for its result`
  },
  'renderer/src/components/board/Board.tsx': { count: 3, why: LISTENER }
}

/** Every bridge name the preload exposes. */
export function bridgeNames(): string[] {
  const names: string[] = []
  const dir = join(SRC, 'preload')
  for (const name of readdirSync(dir)) {
    if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name) || name.endsWith('.d.ts')) continue
    const sf = parseSource(join(dir, name))
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'exposeInMainWorld' &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        names.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return names.sort()
}

/** The walked files: components/**, views/** and App.tsx (no tests, no `test/` folder). */
export function walkedFiles(root = join(SRC, 'renderer/src')): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== 'test' && e.name !== '__fixtures__') walk(p)
      } else if (
        /\.tsx?$/.test(e.name) &&
        !/\.test\.tsx?$/.test(e.name) &&
        !e.name.endsWith('.d.ts')
      ) {
        out.push(p)
      }
    }
  }
  for (const sub of ['components', 'views']) walk(join(root, sub))
  out.push(join(root, 'App.tsx'))
  return out.sort()
}

const isFunctionNode = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)

const isUseAsyncAction = (n: ts.Node): n is ts.CallExpression =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useAsyncAction'

/** The name a function is known by: `function f()` or `const f = () => …`. */
function functionName(fn: ts.FunctionLikeDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? null
  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return null
}

/** `window.<bridge>.<m>(…)` calls in `text` that no function handed to `useAsyncAction` holds. */
export function bareBridgeCalls(file: string, text: string, bridges: readonly string[]): string[] {
  const sf = parseSource(file, text)
  const passedNames = new Set<string>()
  const collect = (node: ts.Node): void => {
    if (isUseAsyncAction(node)) {
      for (const a of node.arguments) if (ts.isIdentifier(a)) passedNames.add(a.text)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  const inLayer = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
      if (!isFunctionNode(p)) continue
      if (isUseAsyncAction(p.parent) && p.parent.arguments.some((a) => a === p)) return true
      const name = functionName(p)
      if (name !== null && passedNames.has(name)) return true
    }
    return false
  }

  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const bridge = node.expression.expression
      if (
        ts.isPropertyAccessExpression(bridge) &&
        ts.isIdentifier(bridge.expression) &&
        bridge.expression.text === 'window' &&
        bridges.includes(bridge.name.text) &&
        !inLayer(node)
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        hits.push(`${bridge.name.text}.${node.expression.name.text} (line ${line + 1})`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('action-feedback: bridge calls go through useAsyncAction', () => {
  const bridges = bridgeNames()
  const files = walkedFiles()

  it('finds the preload bridges and the component files (non-vacuity)', () => {
    expect(bridges).toContain('tags')
    expect(bridges.length).toBeGreaterThan(10)
    expect(files.length).toBeGreaterThan(50)
  })

  it('fails when the walk finds no files', () => {
    expect(() => walkedFiles(join(SRC, 'no-such-folder'))).toThrow()
  })

  it('flags a bare bridge call in a click handler', () => {
    const probe = 'export const P = () => <button onClick={() => window.tags.list()}>x</button>\n'
    expect(bareBridgeCalls('probe.tsx', probe, bridges)).toEqual(['tags.list (line 1)'])
  })

  it('passes a bridge call inside a function handed to useAsyncAction, inline or by name', () => {
    const probe = [
      'function P() {',
      '  const a = useAsyncAction(async () => { await window.tags.list() })',
      '  async function save() { await window.rules.list() }',
      '  const b = useAsyncAction(save)',
      '}'
    ].join('\n')
    expect(bareBridgeCalls('probe.tsx', probe, bridges)).toEqual([])
  })

  it('no file has more bare bridge calls than ALLOWED names, and none fewer (shrink-only)', () => {
    const counts: Record<string, number> = {}
    const where: string[] = []
    for (const file of files) {
      const hits = bareBridgeCalls(file, readFileSync(file, 'utf8'), bridges)
      const rel = srcRel(file)
      if (hits.length > 0) counts[rel] = hits.length
      for (const h of hits) where.push(`${rel}: ${h}`)
    }
    const pinned = Object.fromEntries(Object.entries(ALLOWED).map(([f, e]) => [f, e.count]))
    expect(counts, `bare bridge calls:\n${where.join('\n')}`).toEqual(pinned)
  })

  it('every ALLOWED entry has a reason', () => {
    const missing = Object.entries(ALLOWED).filter(([, e]) => e.why.trim().length < 10)
    expect(missing).toEqual([])
  })
})
