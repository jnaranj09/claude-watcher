// Test hygiene the lint rules cannot see (spec 2026-10-15 testing standards;
// `.claude/rules/testing.md`). Walks every Vitest test file under `src/` and `tests/`, parsed with
// the TypeScript parser so a comment never counts. Same-file heuristics, not proofs:
//   - `vi.mock` / `vi.doMock` only at process edges (technical-taste §5b-21); today's internal
//     mocks are listed and the list only shrinks;
//   - a file that turns on fake timers turns them off (`vi.useRealTimers`);
//   - a file that creates a temp folder (`mkdtemp*`) removes one (`rm*`) — 640 leftover
//     `/tmp/find-name-*` folders came from this;
//   - no test file over MAX_LINES (the size the big files were split below on 2026-10-14).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { parseSource } from './sourceScan'

const ROOT = resolve(__dirname, '../..')
const MAX_LINES = 1000

/** Lines in a file: a trailing newline ends the last line, it does not start another. */
export function countLines(text: string): number {
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/** Module ids a test may mock: the process edges (pty, fs, Electron, xterm, node built-ins). */
export function isEdge(id: string): boolean {
  return (
    id === 'electron' ||
    id === 'electron-store' ||
    id === 'node-pty' ||
    id === 'fs' ||
    id.startsWith('node:') ||
    id.startsWith('@xterm/')
  )
}

/** Internal mocks that existed when the guard landed: `<test file>: <module id>`. Only shrinks. */
const INTERNAL_MOCKS: readonly string[] = [
  'src/renderer/src/components/SessionsDialog/ActiveSessionsPage.test.tsx: ../../lib/openFromNotification'
]

function testFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) testFiles(p, out)
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/')

/** `vi.mock('<id>')` / `vi.doMock('<id>')` first arguments that are string literals. */
export function mockTargets(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'vi' &&
      (n.expression.name.text === 'mock' || n.expression.name.text === 'doMock')
    ) {
      const a = n.arguments[0]
      if (a !== undefined && ts.isStringLiteralLike(a)) out.push(a.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** True when the file calls a function (bare or as a member) whose name is in `names`. */
export function callsNamed(sf: ts.SourceFile, names: readonly string[]): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const e = n.expression
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''
      if (names.includes(name)) found = true
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

const FAKE_ON = ['useFakeTimers']
const FAKE_OFF = ['useRealTimers']
const TMP_MAKE = ['mkdtemp', 'mkdtempSync']
const TMP_REMOVE = ['rm', 'rmSync', 'rmdir', 'rmdirSync']

const probe = (text: string): ts.SourceFile => parseSource('probe.test.ts', text)

describe('probes', () => {
  it('reads vi.mock and vi.doMock targets, not comments', () => {
    expect(
      mockTargets(probe("vi.mock('../x')\nvi.doMock('electron')\n// vi.mock('../y')"))
    ).toEqual(['../x', 'electron'])
  })
  it('countLines does not count the newline that ends the last line', () => {
    expect(countLines('x\n'.repeat(MAX_LINES))).toBe(MAX_LINES)
    expect(countLines('x\n'.repeat(MAX_LINES - 1) + 'x')).toBe(MAX_LINES)
  })
  it('isEdge accepts the process edges only', () => {
    expect(
      ['electron', 'electron-store', 'node-pty', 'fs', 'node:fs', '@xterm/xterm'].every(isEdge)
    ).toBe(true)
    expect(['../lib/x', 'zustand', 'react'].some(isEdge)).toBe(false)
  })
  it('callsNamed sees bare and member calls, not comments', () => {
    expect(callsNamed(probe('vi.useFakeTimers()'), FAKE_ON)).toBe(true)
    expect(callsNamed(probe('mkdtempSync(x)'), TMP_MAKE)).toBe(true)
    expect(callsNamed(probe('// vi.useRealTimers()'), FAKE_OFF)).toBe(false)
  })
})

describe('test hygiene', () => {
  const files = [...testFiles(join(ROOT, 'src')), ...testFiles(join(ROOT, 'tests'))]
  const parsed = files.map((f) => {
    const text = readFileSync(f, 'utf8')
    return { file: rel(f), text, sf: parseSource(f, text) }
  })

  it('walks the test files (a walk that finds none is broken)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('mocks only process edges, beyond the listed internal mocks (the list only shrinks)', () => {
    const internal = parsed.flatMap(({ file, sf }) =>
      mockTargets(sf)
        .filter((id) => !isEdge(id))
        .map((id) => `${file}: ${id}`)
    )
    expect(internal.sort()).toEqual([...INTERNAL_MOCKS].sort())
  })

  it('a file that turns on fake timers turns them off', () => {
    const bad = parsed.filter(({ sf }) => callsNamed(sf, FAKE_ON) && !callsNamed(sf, FAKE_OFF))
    expect(bad.map((p) => p.file)).toEqual([])
  })

  it('a file that makes a temp folder removes one', () => {
    const bad = parsed.filter(({ sf }) => callsNamed(sf, TMP_MAKE) && !callsNamed(sf, TMP_REMOVE))
    expect(bad.map((p) => p.file)).toEqual([])
  })

  it(`no test file is over ${MAX_LINES} lines`, () => {
    const big = parsed.filter(({ text }) => countLines(text) > MAX_LINES)
    expect(big.map((p) => p.file)).toEqual([])
  })
})
