// Guard `security-allow-list` (.claude/rules/security.md "The allow-list only shrinks").
// `security/allow.json` is the one list of findings the scans may skip (`security/run.mjs` hands
// the live entries to each tool). Each entry has a reason and an expiry at most 180 days ahead,
// and the narrowest id its tool supports. An expired entry is red here AND stops being handed to
// the tool, so its finding comes back. gitleaks false positives live in `.gitleaksignore` (its
// own format, by fingerprint); each one needs a comment line above it saying why.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

const ROOT = resolve(__dirname, '../..')
const MAX_DAYS = 180
const DAY_MS = 24 * 60 * 60 * 1000

const EntrySchema = z
  .object({
    tool: z.enum(['trivy', 'semgrep', 'zizmor']),
    id: z.string().regex(/^[^\s,]+$/, 'id has whitespace or a comma'),
    reason: z.string().min(10),
    expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
  .strict()
const AllowSchema = z.array(EntrySchema)
type Entry = z.infer<typeof EntrySchema>

/** Why an id has the wrong shape for its tool, or null. `rules` = the repo's Semgrep rule ids. */
function idProblem(e: Entry, rules: Set<string>): string | null {
  switch (e.tool) {
    case 'trivy':
      return /^(CVE-\d{4}-\d{4,}|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/.test(e.id)
        ? null
        : 'a trivy id is one CVE-… or GHSA-… id'
    case 'semgrep':
    case 'zizmor': {
      const m = /^([a-z0-9-]+):([\w./-]+)$/.exec(e.id)
      if (m?.[1] === undefined || m[2] === undefined) return `a ${e.tool} id is <rule>:<path>`
      if (m[2].split('/').includes('..')) return 'the path has ".."'
      if (e.tool === 'semgrep' && !rules.has(m[1])) return `no Semgrep rule "${m[1]}" in the repo`
      if (e.tool === 'zizmor' && !m[2].startsWith('.github/'))
        return 'a zizmor path is under .github/'
      return null
    }
  }
}

/** Every problem in an allow-list, measured on `today` (UTC date). */
export function allowListProblems(json: unknown, today: Date, rules: Set<string>): string[] {
  const parsed = AllowSchema.safeParse(json)
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  const problems: string[] = []
  const seen = new Set<string>()
  const day0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  for (const e of parsed.data) {
    const key = `${e.tool} ${e.id}`
    if (seen.has(key)) problems.push(`duplicate ${key}`)
    seen.add(key)
    const shape = idProblem(e, rules)
    if (shape !== null) problems.push(`${key}: ${shape}`)
    const t = Date.parse(`${e.expires}T00:00:00Z`)
    if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== e.expires)
      problems.push(`${key}: expires is not a real date`)
    else if (t < day0) problems.push(`${key}: expired on ${e.expires}`)
    else if (t > day0 + MAX_DAYS * DAY_MS)
      problems.push(`${key}: expires more than ${MAX_DAYS} days ahead`)
  }
  return problems
}

/** `.gitleaksignore`: fingerprint lines only, each right under a `#` comment. */
export function gitleaksIgnoreProblems(text: string): string[] {
  const lines = text.split('\n')
  const problems: string[] = []
  lines.forEach((line, i) => {
    if (line.trim() === '' || line.startsWith('#')) return
    if (!/^([0-9a-f]{40}:)?[^:\s]+:[\w-]+:\d+$/.test(line))
      problems.push(`line ${i + 1} is not a fingerprint`)
    if (!(lines[i - 1] ?? '').startsWith('#'))
      problems.push(`line ${i + 1} has no comment line above it`)
  })
  return problems
}

const RULES = new Set(
  readdirSync(resolve(ROOT, 'security/semgrep'))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
)

describe('allowListProblems (probes)', () => {
  const today = new Date('2026-11-23T12:00:00Z')
  const ok: Entry = {
    tool: 'trivy',
    id: 'CVE-2026-12345',
    reason: 'no fixed version reachable yet',
    expires: '2027-01-01'
  }
  const check = (e: Partial<Entry> | Record<string, unknown>): string[] =>
    allowListProblems([{ ...ok, ...e }], today, new Set(['dynamic-code']))

  it('accepts a good entry for each tool', () => {
    expect(check({})).toEqual([])
    expect(check({ tool: 'semgrep', id: 'dynamic-code:src/main/x.ts' })).toEqual([])
    expect(check({ tool: 'zizmor', id: 'artipacked:.github/workflows/ci.yml' })).toEqual([])
  })

  it('refuses an expired, an impossible and a too-far date', () => {
    expect(check({ expires: '2026-11-22' })).toHaveLength(1)
    expect(check({ expires: '2027-02-30' })).toHaveLength(1)
    expect(check({ expires: '2027-06-01' })).toHaveLength(1)
  })

  it('refuses a missing field, an unknown tool and an extra key', () => {
    expect(allowListProblems([{ tool: 'trivy', id: 'CVE-2026-1234' }], today, RULES)).not.toEqual(
      []
    )
    expect(check({ tool: 'gitleaks' })).not.toEqual([])
    expect(check({ note: 'x' })).not.toEqual([])
  })

  it('refuses ids of the wrong shape, a whitespace id, a path with ".." and a duplicate', () => {
    expect(check({ id: 'trivy-everything' })).toHaveLength(1)
    expect(check({ id: 'CVE-2026-1 x' })).not.toEqual([])
    expect(check({ tool: 'semgrep', id: 'dynamic-code:src/../x.ts' })).toHaveLength(1)
    expect(check({ tool: 'semgrep', id: 'unknown-rule:src/x.ts' })).toHaveLength(1)
    expect(allowListProblems([ok, ok], today, RULES)).toEqual(['duplicate trivy CVE-2026-12345'])
  })
})

describe('gitleaksIgnoreProblems (probes)', () => {
  it('needs a fingerprint under a comment', () => {
    const fp = `${'a'.repeat(40)}:src/x.ts:generic-api-key:3`
    expect(gitleaksIgnoreProblems(`# why\n${fp}\n`)).toEqual([])
    expect(gitleaksIgnoreProblems(`# why\n\n${fp}\n`)).toEqual([
      'line 3 has no comment line above it'
    ])
    expect(gitleaksIgnoreProblems('# why\ngeneric-api-key\n')).toEqual([
      'line 2 is not a fingerprint'
    ])
  })
})

describe('security allow-lists in this repo', () => {
  it('security/allow.json: every entry has its reason, a live expiry and a narrow id', () => {
    const json: unknown = JSON.parse(readFileSync(resolve(ROOT, 'security/allow.json'), 'utf8'))
    expect(allowListProblems(json, new Date(), RULES)).toEqual([])
  })

  it('.gitleaksignore: every fingerprint has its reason', () => {
    expect(gitleaksIgnoreProblems(readFileSync(resolve(ROOT, '.gitleaksignore'), 'utf8'))).toEqual(
      []
    )
  })
})
