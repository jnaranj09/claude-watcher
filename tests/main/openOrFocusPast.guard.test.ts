// Every Open of a Past sessions record goes through ONE step, `openOrFocusPast`
// (src/renderer/src/components/PastSessionsDialog/pastSessionsView.ts; spec 2026-11-18 memory
// session goals, "Shared open step"; maintainability rule 4): open, and on `already_open` go to
// the live card. So no renderer file calls `focusLiveSession(` itself (passing it as a value is the
// allowed form) outside the store that defines it, and the four callers really call the step.
// Parsed with the TypeScript AST, so a comment or a string never counts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parseSource, sourceFiles, srcRel } from './sourceScan'

const OWNER = 'renderer/src/stores/pastSessionsStore.ts'
const CALLERS: readonly [string, ...string[]] = [
  'renderer/src/components/PastSessionsDialog/PastSessionsPage.tsx',
  'renderer/src/components/SessionsDialog/ImportSessionPage.tsx',
  'renderer/src/lib/sessionExit.ts',
  'renderer/src/components/GoalsDialog/GoalSessions.tsx'
]

function calleeName(call: ts.CallExpression): string {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return ''
}

/** The names of every function called in the file. */
function calls(rel: string, text: string): string[] {
  const sf = parseSource(rel, text)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) out.push(calleeName(node))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The offences over `files` (path under `src/` → text); empty = the rule holds. */
function offences(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  if (files.size === 0) out.push('the walk found no renderer files')
  for (const [rel, text] of files) {
    const called = calls(rel, text)
    if (rel !== OWNER && called.includes('focusLiveSession')) {
      out.push(`${rel} calls focusLiveSession( itself; use openOrFocusPast`)
    }
  }
  for (const rel of CALLERS) {
    const text = files.get(rel)
    if (text === undefined) out.push(`${rel} is missing`)
    else if (!calls(rel, text).includes('openOrFocusPast'))
      out.push(`${rel} has no openOrFocusPast(`)
  }
  return out
}

function rendererFiles(): Map<string, string> {
  return new Map(
    sourceFiles()
      .map((file) => [srcRel(file), file] as const)
      .filter(([rel]) => rel.startsWith('renderer/src/'))
      .map(([rel, file]) => [rel, readFileSync(file, 'utf8')])
  )
}

describe('openOrFocusPast — the one Past sessions open step', () => {
  it('no renderer file calls focusLiveSession( outside its store, and the four callers use the step', () => {
    expect(offences(rendererFiles())).toEqual([])
  })

  it('catches a direct call, and a caller that dropped the step (the guard is not vacuous)', () => {
    const files = rendererFiles()
    const [first] = CALLERS
    files.set(first, 'await focusLiveSession(id)\n')
    expect(offences(files)).toEqual([
      `${first} calls focusLiveSession( itself; use openOrFocusPast`,
      `${first} has no openOrFocusPast(`
    ])
    expect(offences(new Map())).toContain('the walk found no renderer files')
  })

  it('ignores comments, strings and focusLiveSession passed as a value', () => {
    const files = new Map([
      [
        'renderer/src/x.ts',
        '// focusLiveSession(id)\nconst s = "focusLiveSession(id)"\nf(focusLiveSession)\n'
      ]
    ])
    expect(offences(files).filter((o) => o.startsWith('renderer/src/x.ts'))).toEqual([])
  })
})
