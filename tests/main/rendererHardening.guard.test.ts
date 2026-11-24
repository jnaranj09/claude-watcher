// The renderer's walls (CLAUDE.md "Security", docs/threat-model.md T-R1–T-R3): the CSP in
// `src/renderer/index.html` runs only the app's own scripts (no inline, no eval), and the window
// is sandboxed with context isolation and no Node. A theme needs inline STYLES, so style-src keeps
// 'unsafe-inline'; scripts never do. Both read the source: a weakened setting is red before a build.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { SRC, parseSource, sourceFiles, srcRel } from './sourceScan'

const INDEX = resolve(SRC, 'renderer/index.html')
const WINDOW = resolve(SRC, 'main/window/createWindow.ts')

/** The CSP `<meta>` content as directive → sources. Throws when there is not exactly one. */
export function cspOf(html: string): Map<string, string[]> {
  const metas = [...html.matchAll(/<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi)]
  if (metas.length !== 1) throw new Error(`expected one CSP meta, found ${metas.length}`)
  const content = /content="([^"]*)"/.exec(metas[0]?.[0] ?? '')?.[1] ?? ''
  return new Map(
    content
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0] !== undefined && parts[0] !== '')
      .map(([name = '', ...sources]) => [name, sources])
  )
}

/** Why the CSP lets a script in that is not the app's own file, or []. */
export function cspProblems(csp: Map<string, string[]>): string[] {
  const problems: string[] = []
  const def = csp.get('default-src')
  if (def?.join(' ') !== "'self'") problems.push(`default-src is ${def?.join(' ')}, not 'self'`)
  const script = csp.get('script-src') ?? def ?? []
  if (script.join(' ') !== "'self'")
    problems.push(`script-src is "${script.join(' ')}", not 'self'`)
  for (const [name, sources] of csp)
    for (const s of sources)
      if (s === "'unsafe-eval'" || s === '*' || /^https?:$/.test(s))
        problems.push(`${name} allows ${s}`)
  return problems
}

/** Inline `<script>` blocks (no `src`): the CSP would refuse them, so none may ship. */
export function inlineScripts(html: string): number {
  return [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc=/.test(m[1] ?? '')).length
}

/** `key: literal` pairs of every `webPreferences: { … }` object in a file. */
export function webPreferences(sf: ts.SourceFile): Record<string, string>[] {
  const out: Record<string, string>[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sf) === 'webPreferences' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const prefs: Record<string, string> = {}
      for (const p of node.initializer.properties)
        if (ts.isPropertyAssignment(p)) prefs[p.name.getText(sf)] = p.initializer.getText(sf)
      out.push(prefs)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const DANGEROUS: Record<string, string> = {
  sandbox: 'false',
  contextIsolation: 'false',
  nodeIntegration: 'true',
  nodeIntegrationInSubFrames: 'true',
  webSecurity: 'false',
  allowRunningInsecureContent: 'true',
  experimentalFeatures: 'true'
}

describe('CSP checks (probes)', () => {
  it('passes the strict policy and refuses inline, eval and wildcard scripts', () => {
    const ok = cspOf(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'" />`
    )
    expect(cspProblems(ok)).toEqual([])
    const bad = cspOf(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'" />`
    )
    expect(cspProblems(bad)).toHaveLength(2)
    expect(inlineScripts('<script src="/a.js"></script><script>go()</script>')).toBe(1)
  })
})

describe('renderer hardening', () => {
  const html = readFileSync(INDEX, 'utf8')

  it('the renderer CSP runs only the app own scripts: no inline script, no eval', () => {
    expect(cspProblems(cspOf(html))).toEqual([])
    expect(inlineScripts(html)).toBe(0)
  })

  it('the window is sandboxed, context-isolated and has no Node', () => {
    const prefs = webPreferences(parseSource(WINDOW))
    expect(prefs).toHaveLength(1)
    expect(prefs[0]).toMatchObject({
      sandbox: 'true',
      contextIsolation: 'true',
      nodeIntegration: 'false'
    })
  })

  it('no main file turns a webPreferences wall off', () => {
    const offenders = sourceFiles()
      .filter((f) => srcRel(f).startsWith('main/'))
      .flatMap((f) =>
        webPreferences(parseSource(f)).flatMap((p) =>
          Object.entries(DANGEROUS)
            .filter(([k, v]) => p[k] === v)
            .map(([k, v]) => `${srcRel(f)} ${k}: ${v}`)
        )
      )
    expect(offenders).toEqual([])
  })
})
