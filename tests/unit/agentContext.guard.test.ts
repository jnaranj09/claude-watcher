// Agent context budget (technical-taste §5b-19). What loads into EVERY agent session costs every
// session, and long context files are followed worse. CLAUDE.md stays at or under 200 lines; each
// rule file declares `paths:` so it loads only when an agent reads a matching file (a rule file
// without it loads at every start). Layer detail belongs in a scoped rule file, not CLAUDE.md.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const RULES = join(ROOT, '.claude/rules')
const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')

/** The `paths:` globs of a rule file's frontmatter, or null when it has none. */
function rulePaths(text: string): string[] | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (m?.[1] === undefined) return null
  const lines = m[1].split('\n')
  const at = lines.findIndex((l) => /^paths:\s*$/.test(l))
  if (at === -1) return null
  const globs: string[] = []
  for (const l of lines.slice(at + 1)) {
    // Prettier writes single quotes; either quote style (or none) is valid YAML.
    const item = /^ {2}- (['"]?)(.+)\1$/.exec(l)
    if (item?.[2] === undefined) break
    globs.push(item[2])
  }
  return globs
}

describe('rulePaths', () => {
  it('reads a YAML list in either quote style', () => {
    expect(rulePaths('---\npaths:\n  - \'src/a/**\'\n  - "b.ts"\n---\n# x\n')).toEqual([
      'src/a/**',
      'b.ts'
    ])
  })

  it('is null without frontmatter and empty for an empty list', () => {
    expect(rulePaths('# x\n')).toBeNull()
    expect(rulePaths('---\npaths:\n---\n')).toEqual([])
  })
})

describe('agent context budget', () => {
  it('CLAUDE.md is at most 200 lines', () => {
    expect(claudeMd.split('\n').length).toBeLessThanOrEqual(200)
  })

  it('every rule file is scoped by a non-empty paths: list', () => {
    const unscoped = readdirSync(RULES)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => (rulePaths(readFileSync(join(RULES, f), 'utf8')) ?? []).length === 0)
    expect(unscoped).toEqual([])
  })

  it('every rules/<x>.md CLAUDE.md points to exists', () => {
    const named = [...claudeMd.matchAll(/rules\/([\w-]+\.md)/g)].map((m) => m[1] ?? '')
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((f) => !existsSync(join(RULES, f)))).toEqual([])
  })
})
