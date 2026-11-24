// Living-doc guard (maintainability.md rule 5, technical-taste §5b-19). Next to
// `agentContext.guard.test.ts` (size and `paths:`), this file checks what the docs SAY:
// - every rule bullet names its sensor (`Sensor:`, `Prose only`, or the older `Lint:` /
//   `Guard:`); bullets that did not when this landed sit in a shrink-only count per file;
// - every path and `CH.<key>` CLAUDE.md and the rule files name exists (doc-paths).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CH } from '../../src/shared/ipc/contract'

const ROOT = resolve(__dirname, '../..')
const RULES = join(ROOT, '.claude/rules')
const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
const ruleFiles = readdirSync(RULES).filter((f) => f.endsWith('.md'))
const ruleText = (f: string): string => readFileSync(join(RULES, f), 'utf8')

/** Top-level bullets (with their wrapped lines) that name no sensor. */
export function unlabeledRules(text: string): string[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
  const bullets: string[] = []
  let current: string | null = null
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) {
      if (current !== null) bullets.push(current)
      current = line
    } else if (current !== null && /^ {2,}\S/.test(line)) {
      current += ` ${line.trim()}`
    } else if (current !== null) {
      bullets.push(current)
      current = null
    }
  }
  if (current !== null) bullets.push(current)
  return bullets.filter((b) => !/Sensor:|[Pp]rose only|\bLint:|\bGuards?:/.test(b))
}

/** Unlabeled bullets that existed when the label check landed (2026-11-23). Only shrinks: label
 *  one, lower its count in the same commit. A file not listed must have none. */
const UNLABELED_ALLOWED: Record<string, number> = {
  'api.md': 25,
  'design.md': 113,
  'ipc.md': 3,
  'maintainability.md': 51,
  'release.md': 5,
  'run-app.md': 10,
  'session-engine.md': 22,
  'state.md': 4,
  'terminal.md': 11,
  'testing.md': 6,
  'themes.md': 11,
  'troubleshooting.md': 3,
  'zod-boundaries.md': 4
}

/** `.gitignore` entries: a doc may name a local-only path (`.claude/settings.local.json`). */
const gitignored = readFileSync(join(ROOT, '.gitignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim().replace(/^\//, ''))
  .filter((l) => l !== '' && !l.startsWith('#') && !/[*?]/.test(l))

/** Blocks (bullets with their wrapped lines, or paragraphs) of a doc. */
function blocks(text: string): string[] {
  return text.split(/\n(?=- |\s*\n)/)
}

/** Backticked `src/`, `tests/` and `.claude/` paths a doc names, outside a `_(to write)_` block,
 *  skipping globs, placeholders and git-ignored paths. */
export function namedPaths(text: string): string[] {
  return blocks(text)
    .filter((b) => !b.includes('_(to write)_'))
    .flatMap((b) => [...b.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] ?? ''))
    .filter((p) => /^(src|tests|\.claude)\//.test(p))
    .filter((p) => !/[*?{<…]/.test(p))
    .filter((p) => !gitignored.some((g) => p === g || p.startsWith(g.endsWith('/') ? g : `${g}/`)))
}

/** A named path exists as written, as a folder, or as a module (`.ts`, `.tsx`, `/index.ts`). */
function pathExists(p: string): boolean {
  const abs = join(ROOT, p.replace(/:\d+$/, ''))
  return ['', '.ts', '.tsx', '/index.ts'].some((ext) => existsSync(abs + ext))
}

/** `CH.<key>` names a doc uses, skipping placeholders (`CH.x`, `<`, `…`) and families (`*`). */
export function namedChannels(text: string): string[] {
  return [...text.matchAll(/\bCH\.([\w<…*]+)/g)]
    .map((m) => m[1] ?? '')
    .filter((k) => k !== 'x' && !/[<…*]/.test(k))
}

describe('living-doc helpers', () => {
  it('unlabeledRules sees a wrapped bullet as one rule', () => {
    expect(unlabeledRules('- one rule\n  wrapped. Sensor: lint\n- two rule\n')).toEqual([
      '- two rule'
    ])
  })

  it('namedPaths skips globs, placeholders, ignored paths and _(to write)_ blocks', () => {
    const doc = [
      '- see `src/a.ts`, `src/*.ts`, `src/<x>.ts` and `.claude/settings.local.json`',
      '- planned `src/b.ts` _(to write)_'
    ].join('\n')
    expect(namedPaths(doc)).toEqual(['src/a.ts'])
  })

  it('namedChannels skips placeholders and families', () => {
    expect(namedChannels('`CH.ptyStart`, `CH.x`, `CH.watch*`, `CH.<key>`')).toEqual(['ptyStart'])
  })
})

describe('living docs', () => {
  it('every rule bullet names its sensor or says prose only (old ones: shrink-only counts)', () => {
    expect(ruleFiles.length).toBeGreaterThan(0)
    const counts = Object.fromEntries(
      ruleFiles
        .map((f) => [f, unlabeledRules(ruleText(f)).length] as const)
        .filter(([, n]) => n > 0)
    )
    expect(counts).toEqual(UNLABELED_ALLOWED)
  })

  it('every path and CH.<key> CLAUDE.md and the rule files name exists (doc-paths)', () => {
    const docs = [claudeMd, ...ruleFiles.map(ruleText)]
    const paths = docs.flatMap(namedPaths)
    const channels = docs.flatMap(namedChannels)
    expect(paths.length).toBeGreaterThan(0)
    expect(channels.length).toBeGreaterThan(0)
    expect(paths.filter((p) => !pathExists(p))).toEqual([])
    expect(channels.filter((k) => !(k in CH))).toEqual([])
  })
})
