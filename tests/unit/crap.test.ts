// The CRAP check (`npm run crap`, tools/crap/). Ported from the self-test of the
// dev-project-bootstrap skill's crap.py (LCOV only; its coverage.py and Go cases are not ported),
// plus the TS extractor against the skill's sample fixture and its CC table.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  check,
  checkShrink,
  crap,
  findFile,
  fnCoverage,
  main,
  parseCoverageText,
  scoreAll,
  validate
} from '../../tools/crap/crap.mjs'
import type { AllowEntry, FnRow } from '../../tools/crap/crap.mjs'

const TOOLS = resolve(__dirname, '../../tools/crap')
const LCOV = 'SF:a/x.py\nDA:1,1\nDA:2,0\nDA:3,4\nDA:4,0\nend_of_record\n'
const cov = parseCoverageText(LCOV)
const FN: FnRow = { file: 'a/x.py', name: 'f', start: 1, end: 4, cc: 15 } // cov 0.5 -> 43.125, scored 43.13 (half up; crap.py's round() gives 43.12)
const PIN: AllowEntry = { file: 'a/x.py', name: 'f', crap: 43.13, reason: 'old' }
const rows = scoreAll([FN], cov)
const kinds = (findings: string[]): string[] => findings.map((f) => f.split(/[\s:]/)[0] ?? '')

describe('crap score and LCOV', () => {
  it.each([
    [15, 0, 240],
    [15, 1, 15],
    [15, 0.5, 43.13]
  ])('crap(%d, %d) is %d', (cc, c, want) => {
    expect(Number(crap(cc, c).toFixed(2))).toBe(want)
  })

  it('parses SF/DA records into a covered-line map', () => {
    expect(cov).toEqual(
      new Map([
        [
          'a/x.py',
          new Map([
            [1, true],
            [2, false],
            [3, true],
            [4, false]
          ])
        ]
      ])
    )
  })

  it('counts a line hit in any record as covered', () => {
    expect(parseCoverageText('SF:a/x.py\nDA:1,0\nDA:1,3\nend_of_record\n')).toEqual(
      new Map([['a/x.py', new Map([[1, true]])]])
    )
  })

  it('refuses text that is not LCOV', () => {
    expect(() => parseCoverageText('this is not coverage')).toThrow(/unknown coverage format/)
  })

  it('joins a function file to a coverage path by suffix on a path boundary only', () => {
    expect(findFile(cov, 'x.py')).toBe('a/x.py')
    expect(findFile(new Map([['xa/x.py', new Map()]]), 'a/x.py')).toBeNull()
  })

  it('throws on two coverage paths that match equally', () => {
    const two = new Map([
      ['p/a/x.py', new Map([[1, true]])],
      ['q/a/x.py', new Map([[1, true]])]
    ])
    expect(() => findFile(two, 'a/x.py')).toThrow(/ambiguous/)
  })

  it.each([
    ['covered half', { file: 'a/x.py', start: 1, end: 4 }, { cov: 0.5, hasData: true }],
    ['no file: 0, no data', { file: 'zzz.py', start: 1, end: 4 }, { cov: 0, hasData: false }],
    ['no executable line: 1', { file: 'a/x.py', start: 10, end: 12 }, { cov: 1, hasData: true }]
  ])('function coverage: %s', (_label, fn, want) => {
    expect(fnCoverage(cov, fn)).toEqual(want)
  })

  it('renames two functions with one name to name@start', () => {
    const dups = scoreAll(
      [
        { file: 'a/x.py', name: 'f', start: 1, end: 1, cc: 1 },
        { file: 'a/x.py', name: 'f', start: 5, end: 5, cc: 1 }
      ],
      cov
    )
    expect(dups.map((r) => r.name)).toEqual(['f@1', 'f@5'])
  })
})

describe('check', () => {
  it('reports an unlisted offender as NEW', () => {
    expect(kinds(check(rows, [], 30, 10))).toEqual(['NEW'])
  })

  it('passes an offender at its pin', () => {
    expect(check(rows, [PIN], 30, 10)).toEqual([])
  })

  it.each([
    ['ROSE', 40],
    ['FELL', 60]
  ])('reports %s when the score moved off the pin %d', (kind, pin) => {
    expect(kinds(check(rows, [{ ...PIN, crap: pin }], 30, 10))).toEqual([kind])
  })

  it('reports STALE when a listed function is now under the limits', () => {
    expect(kinds(check(scoreAll([{ ...FN, cc: 2 }], cov), [PIN], 30, 10))).toEqual(['STALE'])
  })

  it('reports STALE when a listed function is gone', () => {
    const other = scoreAll([{ ...FN, name: 'other' }], cov)
    expect(kinds(check(other, [PIN], 30, 10)).filter((k) => k === 'STALE')).toEqual(['STALE'])
  })

  it('reports non-vacuity on zero functions', () => {
    expect(kinds(check([], [], 30, 10))).toEqual(['non-vacuity'])
  })

  it('reports non-vacuity when no function matched coverage data, even beside other findings', () => {
    const only = scoreAll([FN], new Map([['other.py', new Map([[1, true]])]]))
    expect(kinds(check(only, [PIN], 30, 10))).toContain('non-vacuity')
  })

  it('reports an allow entry without a reason', () => {
    expect(check(rows, [{ ...PIN, reason: '' }], 30, 10)).toEqual([
      'allow list: a/x.py::f has no reason'
    ])
  })

  it('reports a duplicate allow entry', () => {
    expect(check(rows, [PIN, PIN], 30, 10)).toEqual(['allow list: duplicate entry a/x.py::f'])
  })

  it('reports an ambiguous coverage path', () => {
    const amb = new Map([
      ['p/a/x.py', new Map([[1, true]])],
      ['q/a/x.py', new Map([[1, true]])]
    ])
    const arows = scoreAll([{ file: 'a/x.py', name: 'f', start: 1, end: 1, cc: 1 }], amb)
    expect(kinds(check(arows, [], 30, 10))).toContain('AMBIGUOUS')
  })

  it('enforces the CC cap when the CRAP score is fine, and --cc-cap 0 turns it off', () => {
    const capped = scoreAll([{ file: 'a/x.py', name: 'g', start: 1, end: 1, cc: 12 }], cov)
    expect(kinds(check(capped, [], 30, 10))).toEqual(['NEW'])
    expect(check(capped, [], 30, 0)).toEqual([])
  })

  it('passes a score exactly on the limit and a CC exactly on the cap; one over is NEW', () => {
    const exact = scoreAll([{ file: 'a/x.py', name: 'g', start: 1, end: 1, cc: 15 }], cov)
    expect(check(exact, [], 15, 15)).toEqual([])
    expect(check(exact, [], 1000, 15)).toEqual([])
    expect(kinds(check(exact, [], 1000, 14))).toEqual(['NEW'])
  })
})

describe('checkShrink (the list only shrinks against main)', () => {
  it('reports a new entry and a higher pin as GREW', () => {
    expect(kinds(checkShrink([PIN], []))).toEqual(['GREW'])
    expect(kinds(checkShrink([{ ...PIN, crap: 50 }], [PIN]))).toEqual(['GREW'])
  })

  it('passes a lower or equal pin and a removed entry', () => {
    expect([
      ...checkShrink([{ ...PIN, crap: 40 }], [PIN]),
      ...checkShrink([PIN], [PIN]),
      ...checkShrink([], [PIN])
    ]).toEqual([])
  })
})

describe('validate', () => {
  it.each([
    ['allow entry without crap', [], [{ file: 'a', name: 'b' }]],
    ['allow list that is an object', [], { a: 1 }],
    ['cc as a string', [{ file: 'a', name: 'b', start: 1, end: 1, cc: '3' }], []],
    ['bool cc', [{ file: 'a', name: 'b', start: 1, end: 1, cc: true }], []],
    ['functions that are an object', { a: 1 }, []]
  ])('rejects %s', (_label, fns, allow) => {
    expect(() => validate(fns, allow)).toThrow()
  })
})

describe('the command', () => {
  let dir = ''
  const w = (name: string, value: unknown): string => {
    const p = join(dir, name)
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value))
    return p
  }
  const run = (args: string[]): { code: number; out: string } => {
    const lines: string[] = []
    const code = main(args, { out: (s) => lines.push(s), err: (s) => lines.push(s) })
    return { code, out: lines.join('\n') }
  }
  let c = ''
  let risky = ''
  let fine = ''
  let tall = ''
  let empty = ''
  const listed = [
    { file: 'a/x.py', name: 'f', crap: 35, reason: 'pinned at T16 start (2026-11-24)' }
  ]

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crap-test-'))
    c = w('cov.lcov', 'SF:a/x.py\nDA:1,1\nDA:2,0\nDA:3,0\nDA:4,0\nend_of_record\n')
    risky = w('risky.json', [{ file: 'a/x.py', name: 'f', start: 1, end: 4, cc: 8 }]) // CRAP 35
    fine = w('fine.json', [{ file: 'a/x.py', name: 'f', start: 1, end: 1, cc: 2 }])
    tall = w('tall.json', [{ file: 'a/x.py', name: 'g', start: 1, end: 1, cc: 12 }])
    empty = w('empty.json', [])
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it.each([
    ['clean', (): string[] => ['--functions', fine, '--coverage', c], 0, 'crap: 1 functions'],
    ['a new offender', () => ['--functions', risky, '--coverage', c, '--limit', '20'], 1, 'NEW'],
    ['garbage coverage', () => ['--functions', risky, '--coverage', w('g.txt', 'nope')], 2, 'bad'],
    ['no functions', () => ['--functions', empty, '--coverage', c], 1, 'zero functions'],
    ['the CC cap', () => ['--functions', tall, '--coverage', c, '--limit', '1000'], 1, 'NEW'],
    [
      'the CC cap off',
      () => ['--functions', tall, '--coverage', c, '--limit', '1000', '--cc-cap', '0'],
      0,
      '0 finding'
    ],
    ['an unknown flag', () => ['--functions', fine, '--coverage', c, '--bogus', 'x'], 2, 'usage'],
    [
      'an excluded offender',
      () => ['--functions', risky, '--coverage', c, '--limit', '20', '--exclude', 'a/'],
      1,
      'zero functions'
    ],
    [
      'a missing base file',
      () => ['--functions', risky, '--coverage', c, '--base-allow', join(dir, 'nope.json')],
      2,
      'bad input'
    ],
    [
      'an allow entry without crap',
      () => [
        '--functions',
        fine,
        '--coverage',
        c,
        '--allow',
        w('nc.json', [{ file: 'a', name: 'b' }])
      ],
      2,
      'bad input'
    ],
    [
      'a string cc',
      () => [
        '--functions',
        w('s.json', [{ file: 'a/x.py', name: 'f', start: 1, end: 1, cc: '3' }]),
        '--coverage',
        c
      ],
      2,
      'bad input'
    ]
  ])('exits on %s with the expected code and line', (_label, args, code, text) => {
    const r = run(args())
    expect({ code: r.code, has: r.out.includes(text) }).toEqual({ code, has: true })
  })

  it('--init-allow lists today’s offenders with a reason', () => {
    const r = run(['--functions', risky, '--coverage', c, '--limit', '20', '--init-allow'])
    expect({ code: r.code, list: JSON.parse(r.out) }).toEqual({ code: 0, list: listed })
  })

  it('--init-allow applies the CC cap', () => {
    const r = run(['--functions', tall, '--coverage', c, '--limit', '1000', '--init-allow'])
    expect(JSON.parse(r.out).map((a: AllowEntry) => a.name)).toEqual(['g'])
  })

  it.each([
    ['no functions', (): string => empty, (): string => c],
    [
      'coverage that matches no file',
      () => risky,
      () => w('e.lcov', 'SF:zzz/o.py\nDA:1,1\nend_of_record\n')
    ]
  ])('--init-allow with %s is a non-vacuity finding', (_label, fns, lcov) => {
    const r = run(['--functions', fns(), '--coverage', lcov(), '--init-allow'])
    expect({ code: r.code, has: r.out.includes('non-vacuity') }).toEqual({ code: 1, has: true })
  })

  it('an allow list pins the offender', () => {
    const allow = w('allow.json', listed)
    expect(
      run(['--functions', risky, '--coverage', c, '--limit', '20', '--allow', allow]).code
    ).toBe(0)
  })

  it('--base-allow: a new entry is GREW, the same list passes', () => {
    const allow = w('allow2.json', listed)
    const args = ['--functions', risky, '--coverage', c, '--limit', '20', '--allow', allow]
    const grew = run([...args, '--base-allow', w('base0.json', [])])
    const same = run([...args, '--base-allow', w('base1.json', listed)])
    expect([grew.code, grew.out.includes('GREW'), same.code]).toEqual([1, true, 0])
  })

  it('the script sets its exit code when run as a command', () => {
    const p = spawnSync(
      process.execPath,
      [join(TOOLS, 'crap.mjs'), '--functions', risky, '--coverage', c, '--limit', '20'],
      {
        encoding: 'utf8'
      }
    )
    expect({ status: p.status, out: p.stdout.includes('NEW') }).toEqual({ status: 1, out: true })
  })
})

describe('cc_ts.mjs (the TS extractor)', () => {
  let dir = ''
  const extract = (file: string): FnRow[] => {
    const p = spawnSync(
      process.execPath,
      [join(TOOLS, 'cc_ts.mjs'), '--root', dir, join(dir, file)],
      {
        encoding: 'utf8'
      }
    )
    expect(p.status, p.stderr).toBe(0)
    return JSON.parse(p.stdout) as FnRow[]
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-ts-test-'))
    writeFileSync(join(dir, 'sample.ts'), SAMPLE_TS)
    writeFileSync(join(dir, 'risky.ts'), RISKY_TS)
    writeFileSync(join(dir, 'bad.ts'), 'export function (\n')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('counts the skill fixture’s CC table', () => {
    expect(Object.fromEntries(extract('sample.ts').map((r) => [r.name, r.cc]))).toEqual({
      simple: 1,
      branchy: 14,
      'K.method': 2,
      arrow: 2,
      'arrow.helper': 2,
      wide: 1,
      lazy: 3
    })
  })

  it('starts a function at its first body statement, after a multi-line signature or `const f = () => {`', () => {
    const byName = Object.fromEntries(extract('sample.ts').map((r) => [r.name, r.start]))
    expect({ wide: byName.wide, lazy: byName.lazy }).toEqual({ wide: 48, lazy: 52 })
  })

  it('a never-called CC-6 function whose declaration line ran at import is a NEW finding', () => {
    const fns = extract('risky.ts')
    // Only the `const` line ran (module load); every body line is missed.
    const lcov = `SF:risky.ts\nDA:1,1\n${[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `DA:${n},0`).join('\n')}\nend_of_record\n`
    const found = check(scoreAll(fns, parseCoverageText(lcov)), [], 30, 0)
    expect({ cc: fns[0]?.cc, start: fns[0]?.start, kinds: kinds(found) }).toEqual({
      cc: 6,
      start: 2,
      kinds: ['NEW']
    })
  })

  it('exits 2 with no rows on a file it cannot parse', () => {
    const p = spawnSync(
      process.execPath,
      [join(TOOLS, 'cc_ts.mjs'), '--root', dir, join(dir, 'bad.ts')],
      {
        encoding: 'utf8'
      }
    )
    expect({ status: p.status, stdout: p.stdout }).toEqual({ status: 2, stdout: '' })
  })
})

const RISKY_TS = `export const risky = (a: boolean, b: boolean, c: boolean): number => {
  if (a && b) {
    return 1
  }
  if (c || a) {
    return 2
  }
  for (let i = 0; i < 3; i++) c = !c
  return 0
}
`

// The dev-project-bootstrap skill's scripts/crap/fixtures/sample.ts, byte for byte.
const SAMPLE_TS = `export function simple(): number {
  return 1;
}

export function branchy(a: boolean, b: boolean, items: number[]): number {
  if (a && b) {
    return 1;
  } else if (a || b) {
    for (const i of items) {
      if (i) {
        return 2;
      }
    }
  }
  while (a) {
    a = false;
  }
  try {
    items.map((x) => (x ? 1 : 0));
  } catch (e) {
    return a ?? 0 ? 1 : 2;
  }
  switch (items.length) {
    case 0:
      return 0;
    case 1:
      return 1;
    default:
      return 3;
  }
}

export class K {
  method(v: number): number {
    return v > 1 ? 1 : 0;
  }
}

export const arrow = (v: number): number => {
  const helper = (z: number) => (z ? 1 : 0);
  return v ? helper(v) : 0;
};

function wide(
  a: number,
  b: number,
): number {
  return a + b;
}

export const lazy = (a: number, b: number): number => {
  if (a && b) {
    return 1;
  }
  return 0;
};
`
