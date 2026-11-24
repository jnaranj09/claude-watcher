// Guard `threat-model` (.claude/rules/security.md): every row of docs/threat-model.md names a
// check that EXISTS. A renamed test, a deleted CI job or a moved file turns the row red here, so
// the model cannot quietly point at nothing. References, separated by `; `:
//   test:<file>::<title>   an it/test/describe in that file with that exact title (parsed, not grepped)
//   file:<path>            a repo path that exists
//   npm:<script>           a package.json script
//   ci:<workflow>/<job>    a job in .github/workflows/<workflow>
//   accepted: / out of scope: / manual: <text>   a written reason (no check)
//   gap: <text>            allowed until T14 lands its checks; then GAP_ALLOWED turns false
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve(__dirname, '../..')
const DOC = 'docs/threat-model.md'

/** T14's last step flips this: from then on a `gap:` row is red. */
const GAP_ALLOWED = true

const TYPES = ['test', 'file', 'npm', 'ci', 'accepted', 'out of scope', 'manual', 'gap'] as const

export interface ThreatRow {
  id: string
  covered: string
}

/** The rows of the table under `## Threats`. Throws if the table is not where it should be. */
export function parseThreatTable(md: string): ThreatRow[] {
  const start = md.indexOf('\n## Threats')
  if (start < 0) throw new Error('no "## Threats" section')
  // From the heading line itself, then skip it: the loop stops at the NEXT `## `.
  const lines = md
    .slice(start + 1)
    .split('\n')
    .slice(1)
  const rows: ThreatRow[] = []
  let header = false
  for (const line of lines) {
    if (line.startsWith('## ')) break
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (!header) {
      if (cells.join('|') !== 'ID|Asset|Threat|Entry point|Covered by')
        throw new Error(`unexpected header: ${line}`)
      header = true
      continue
    }
    if (cells.every((c) => /^-+$/.test(c))) continue
    if (cells.length !== 5) throw new Error(`row with ${cells.length} cells: ${line}`)
    rows.push({ id: cells[0] ?? '', covered: cells[4] ?? '' })
  }
  return rows
}

/** Split "Covered by" on `; ` only where a known type starts, so a test title may hold `;`. */
export function splitRefs(covered: string): string[] {
  return covered
    .split(/;\s+(?=(?:test|file|npm|ci|accepted|out of scope|manual|gap):)/)
    .map((r) => r.trim())
    .filter((r) => r !== '')
}

/** Every it/test/describe title in a test file whose first argument is a plain string. */
export function testTitles(text: string): Set<string> {
  const sf = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : ''
      const first = node.arguments[0]
      if (
        ['it', 'test', 'describe'].includes(name) &&
        first !== undefined &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      )
        out.add(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The job ids under `jobs:` in a workflow file (two-space keys). */
export function workflowJobs(yml: string): Set<string> {
  const jobs = new Set<string>()
  let inJobs = false
  for (const line of yml.split('\n')) {
    if (/^\S/.test(line)) inJobs = line.startsWith('jobs:')
    else if (inJobs) {
      const m = /^ {2}([\w-]+):\s*$/.exec(line)
      if (m?.[1] !== undefined) jobs.add(m[1])
    }
  }
  return jobs
}

export interface RepoView {
  exists(path: string): boolean
  read(path: string): string
  scripts: Record<string, string>
}

/** Why one reference does not resolve, or null when it does. */
export function refProblem(ref: string, repo: RepoView, gapAllowed: boolean): string | null {
  const type = TYPES.find((t) => ref.startsWith(`${t}:`))
  if (type === undefined) return `unknown reference type: "${ref}"`
  const body = ref.slice(type.length + 1).trim()
  if (body === '') return `empty ${type}: reference`
  switch (type) {
    case 'test': {
      const [file, title, ...rest] = body.split('::')
      if (file === undefined || title === undefined || rest.length > 0)
        return `test: must be <file>::<title>: "${ref}"`
      if (!repo.exists(file)) return `test file does not exist: ${file}`
      if (!testTitles(repo.read(file)).has(title)) return `no test titled "${title}" in ${file}`
      return null
    }
    case 'file':
      return repo.exists(body) ? null : `file does not exist: ${body}`
    case 'npm':
      return body in repo.scripts ? null : `no npm script "${body}"`
    case 'ci': {
      const m = /^([\w.-]+\.ya?ml)\/([\w-]+)$/.exec(body)
      if (m?.[1] === undefined || m[2] === undefined)
        return `ci: must be <workflow>/<job>: "${ref}"`
      const wf = `.github/workflows/${m[1]}`
      if (!repo.exists(wf)) return `no workflow ${wf}`
      return workflowJobs(repo.read(wf)).has(m[2]) ? null : `no job "${m[2]}" in ${wf}`
    }
    case 'gap':
      return gapAllowed ? null : `gap: rows are no longer allowed: "${ref}"`
    case 'accepted':
    case 'out of scope':
    case 'manual':
      return body.length >= 3 ? null : `${type}: needs a reason`
  }
}

/** Every problem in the table: empty or duplicate ids, empty "Covered by", bad references. */
export function threatProblems(rows: ThreatRow[], repo: RepoView, gapAllowed: boolean): string[] {
  if (rows.length === 0) return ['the threat table has no rows']
  const problems: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!/^T-[A-Z]+\d+$/.test(row.id)) problems.push(`bad id "${row.id}"`)
    if (seen.has(row.id)) problems.push(`duplicate id ${row.id}`)
    seen.add(row.id)
    const refs = splitRefs(row.covered)
    if (refs.length === 0) problems.push(`${row.id}: "Covered by" is empty`)
    for (const ref of refs) {
      const p = refProblem(ref, repo, gapAllowed)
      if (p !== null) problems.push(`${row.id}: ${p}`)
    }
  }
  return problems
}

const realRepo: RepoView = {
  exists: (p) => existsSync(resolve(ROOT, p)),
  read: (p) => readFileSync(resolve(ROOT, p), 'utf8'),
  scripts: (
    JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
  ).scripts
}

describe('threat-model reference checks (probes)', () => {
  const fake: RepoView = {
    exists: (p) => ['a.test.ts', '.github/workflows/ci.yml', 'docs/x.md'].includes(p),
    read: (p) =>
      p === 'a.test.ts'
        ? "describe('group', () => { it('does a; b', () => {}) })"
        : 'on: push\njobs:\n  gate:\n    runs-on: x\n',
    scripts: { security: 'node x' }
  }
  const bad = (ref: string, gap = true): string | null => refProblem(ref, fake, gap)

  it('resolves every good reference type', () => {
    const refs = splitRefs(
      'test:a.test.ts::does a; b; test:a.test.ts::group; file:docs/x.md; npm:security; ci:ci.yml/gate; accepted: local only; out of scope: the OS; manual: monthly look; gap: T14'
    )
    expect(refs).toHaveLength(9)
    expect(refs.map((r) => bad(r))).toEqual(refs.map(() => null))
  })

  it('refuses a missing test, file, script, job and an unknown type', () => {
    expect([
      bad('test:a.test.ts::renamed'),
      bad('test:b.test.ts::x'),
      bad('file:docs/gone.md'),
      bad('npm:nope'),
      bad('ci:ci.yml/security'),
      bad('ci:other.yml/gate'),
      bad('todo: later'),
      bad('gap: T14', false)
    ]).not.toContain(null)
  })

  it('refuses a table with no rows, an empty cell and a duplicate id', () => {
    expect(threatProblems([], fake, true)).toEqual(['the threat table has no rows'])
    expect(
      threatProblems(
        [
          { id: 'T-A1', covered: 'npm:security' },
          { id: 'T-A1', covered: '' }
        ],
        fake,
        true
      )
    ).toEqual(['duplicate id T-A1', 'T-A1: "Covered by" is empty'])
  })
})

describe('docs/threat-model.md', () => {
  it('every row resolves to a check that exists, or a written reason', () => {
    const rows = parseThreatTable(readFileSync(resolve(ROOT, DOC), 'utf8'))
    expect(threatProblems(rows, realRepo, GAP_ALLOWED)).toEqual([])
  })
})
