// Guard `crap-budget` (.claude/rules/testing.md "Risky code"). CI's gate job writes the coverage
// report, then scores every function with tools/crap/crap.mjs: CRAP limit 30, the pinned allow
// list crap-allow.json, and `--base-allow` (the list as it is on main), so the list only shrinks.
// This fails when ci.yml drops the step, the limit, the allow list or the base copy, when the mods
// (src/mod, tested by `claude plugin test`, not Vitest) are scored without coverage, or when the
// local `npm run crap` stops running the same check as CI.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import config from '../../vitest.config'

const ROOT = resolve(__dirname, '../..')
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

/** The gate job's text: from `  gate:` up to the next job. */
export function gateJob(yml: string): string {
  const start = yml.indexOf('\n  gate:')
  if (start < 0) return ''
  const next = yml.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/)
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next)
}

/** Each shell line the gate job runs, trimmed: `- run: x` and the lines of a `run: |` block. */
export function runLines(job: string): string[] {
  const out: string[] = []
  let block = false
  for (const raw of job.split('\n')) {
    const single = /^\s+(?:- )?run: (?!\|)(.+)$/.exec(raw)
    if (/^\s+(?:- )?run: \|\s*$/.test(raw)) block = true
    else if (single?.[1]) {
      block = false
      out.push(single[1].trim())
    } else if (block && /^ {10}\S/.test(raw)) out.push(raw.trim())
    else if (!/^\s*$/.test(raw)) block = false
  }
  return out
}

const lines = runLines(gateJob(ci))
const crapLine = lines.find((l) => l.startsWith('node tools/crap/crap.mjs')) ?? ''
const ccLine = lines.find((l) => l.startsWith('node tools/crap/cc_ts.mjs')) ?? ''

describe('runLines (probes)', () => {
  it('reads single runs and the lines of a run block, and stops at the next key', () => {
    const job = [
      '  gate:',
      '    steps:',
      '      - run: npm ci',
      '      - name: x',
      '        run: |',
      '          a b',
      '          c',
      '      - run: d',
      '        env:',
      '          K: v'
    ].join('\n')
    expect(runLines(job)).toEqual(['npm ci', 'a b', 'c', 'd'])
  })
})

describe('ci.yml gate: the CRAP budget', () => {
  it('reads the gate job (a scan that read nothing proves nothing)', () => {
    expect(lines).toContain('npm ci')
  })

  it('writes the coverage report, then extracts and scores every function, in that order', () => {
    const order = [
      lines.indexOf('npm run test:coverage'),
      lines.indexOf(ccLine),
      lines.indexOf(crapLine)
    ]
    expect(Math.min(...order)).toBeGreaterThanOrEqual(0)
    expect(order).toEqual([...order].sort((x, y) => x - y))
  })

  it('scores with CRAP limit 30 against the pinned allow list', () => {
    expect(crapLine).toMatch(/--limit 30(\s|$)/)
    expect(crapLine).toMatch(/--allow crap-allow\.json(\s|$)/)
  })

  // An empty base on the first change failed every pin as new (PR #4's first CI run).
  it('compares the allow list with main’s copy, the branch’s own when main has none', () => {
    expect(crapLine).toMatch(/--base-allow "\$RUNNER_TEMP\/base-allow\.json"/)
    expect(lines).toContain(
      `git show origin/main:crap-allow.json > "$RUNNER_TEMP/base-allow.json" || cp crap-allow.json "$RUNNER_TEMP/base-allow.json"`
    )
    expect(lines).toContain('git fetch --no-tags --depth=1 origin main')
  })

  it('leaves the mods out of the score and out of the coverage run', () => {
    expect(crapLine).toMatch(/--exclude src\/mod\/(\s|$)/)
    expect(config.test?.coverage?.exclude).toContain('src/mod/**')
  })

  it('`npm run crap` runs the same extractor and check, with everything but the base copy', () => {
    const local = crapLine.replace(/ --base-allow "\$RUNNER_TEMP\/base-allow\.json"/, '')
    expect(pkg.scripts.crap).toBe(`${ccLine} && ${local}`)
  })
})
