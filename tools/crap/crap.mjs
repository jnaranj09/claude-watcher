#!/usr/bin/env node
// CRAP score check: CRAP = CC² × (1 − coverage)³ + CC, per function. Ported 2026-11-24 from the
// dev-project-bootstrap skill's scripts/crap/crap.py, LCOV input only (the Vitest v8 report);
// its coverage.py and Go parsers are left out. Cases: tests/unit/crap.test.ts.
//
//   node crap.mjs --functions fn.json --coverage lcov.info [--allow crap-allow.json]
//        [--limit 30] [--cc-cap 10] [--exclude PREFIX]... [--base-allow BASE.json] [--init-allow]
//        [--report N]
//
// fn.json:     [{file,name,start,end,cc}] from cc_ts.mjs. The CC comes from there, never from the
//              lint report; `--cc-cap 0` turns this script's cap off (ESLint `complexity` is the CC
//              sensor here).
// --exclude:   drop functions whose file starts with PREFIX (code the coverage run does not load).
// allow list:  [{file,name,crap,reason}], only shrinks. `--base-allow` is the list as it is on the
//              main branch (`[]` when it has none): a new entry or a higher pin is a GREW finding.
//
// Coverage of a function = covered / executable lines in [start, end]. A file with no coverage
// data scores 0; a function with data but no executable line in range scores 1.
// Exit 1 on: a function over the limit or the cap and not listed; a listed function whose score
// rose, fell (lower the pin in the same commit; 2 decimals), went under both limits or is gone;
// an allow entry with no reason or listed twice; a file matching two coverage paths equally;
// non-vacuity (zero functions, or none matched coverage data). Exit 2: bad input. Exit 0: clean.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EPS = 0.005 // scores are compared at 2 decimals
const INIT_REASON = 'pinned at T16 start (2026-11-24)'

export const crap = (cc, cov) => cc * cc * (1 - cov) ** 3 + cc
// Half up (43.125 -> 43.13); crap.py's round() gives 43.12. Pins and scores both use this one.
const round2 = (x) => Math.round(x * 100) / 100

/** LCOV text → Map(path → Map(line → covered)), executable lines only. A line hit in any record counts. */
export function parseLcov(text) {
  const files = new Map()
  let cur = null
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      const p = line.slice(3)
      if (!files.has(p)) files.set(p, new Map())
      cur = files.get(p)
    } else if (line.startsWith('DA:') && cur !== null) {
      const [n, hits] = line.slice(3).split(',').map(Number)
      cur.set(n, cur.get(n) === true || hits > 0)
    } else if (line === 'end_of_record') cur = null
  }
  return files
}

export function parseCoverageText(text) {
  if (!text.includes('SF:')) throw new Error('unknown coverage format (expected LCOV)')
  return parseLcov(text)
}

const norm = (p) => path.posix.normalize(p.split(path.sep).join('/'))

/** A coverage path for a function's file: exact, else the longest suffix match on a path boundary. */
export function findFile(cov, name) {
  const n = norm(name)
  let best = null
  let bestLen = -1
  let tie = false
  for (const p of cov.keys()) {
    const q = norm(p)
    if (q === n) return p
    if (!q.endsWith('/' + n) && !n.endsWith('/' + q)) continue
    const score = Math.min(q.length, n.length)
    if (score > bestLen) {
      best = p
      bestLen = score
      tie = false
    } else if (score === bestLen) tie = true
  }
  if (tie) throw new Error(`ambiguous coverage path for ${name}`)
  return best
}

/** { cov in [0,1], hasData }. */
export function fnCoverage(cov, fn) {
  const p = findFile(cov, fn.file)
  if (p === null) return { cov: 0, hasData: false }
  const lines = [...cov.get(p)].filter(([n]) => fn.start <= n && n <= fn.end).map(([, c]) => c)
  if (lines.length === 0) return { cov: 1, hasData: true }
  return { cov: lines.filter(Boolean).length / lines.length, hasData: true }
}

const key = (fn) => `${fn.file}::${fn.name}`

export function scoreAll(fns, cov) {
  const seen = new Map()
  for (const fn of fns) seen.set(key(fn), (seen.get(key(fn)) ?? 0) + 1)
  return fns.map((fn) => {
    const name = seen.get(key(fn)) > 1 ? `${fn.name}@${fn.start}` : fn.name
    let c = { cov: 0, hasData: false }
    let error = null
    try {
      c = fnCoverage(cov, fn)
    } catch (e) {
      error = e.message
    }
    const { cov: fc, hasData } = c
    return {
      file: fn.file,
      name,
      cc: fn.cc,
      cov: fc,
      hasData,
      crap: round2(crap(fn.cc, fc)),
      error
    }
  })
}

const isStr = (v) => typeof v === 'string'
const isInt = (v) => Number.isInteger(v)
const isRow = (f) => typeof f === 'object' && f !== null && isStr(f.file) && isStr(f.name)
const isFnRow = (f) => isRow(f) && [f.start, f.end, f.cc].every(isInt)
const isAllowRow = (a) => isRow(a) && typeof a.crap === 'number' && Number.isFinite(a.crap)

/** Bad input throws (exit 2), never a stack trace. */
export function validate(fns, allow) {
  if (!Array.isArray(fns)) throw new Error('--functions must be a JSON list')
  fns.forEach((f, i) => {
    if (!isFnRow(f))
      throw new Error(`--functions[${i}] needs string file and name and integer start, end, cc`)
  })
  if (!Array.isArray(allow)) throw new Error('the allow list must be a JSON list')
  allow.forEach((a, i) => {
    if (!isAllowRow(a)) throw new Error(`allow[${i}] needs string file and name and a number crap`)
    if (a.reason !== undefined && !isStr(a.reason))
      throw new Error(`allow[${i}].reason must be a string`)
  })
}

/** The allow list only shrinks against its copy on the main branch. */
export function checkShrink(allow, base) {
  const old = new Map(base.map((a) => [key(a), a.crap]))
  const out = []
  for (const a of allow) {
    const k = key(a)
    if (!old.has(k))
      out.push(
        `GREW ${k}: new allow entry (the list only shrinks; fix the function or lower the offender)`
      )
    else if (round2(a.crap) > round2(old.get(k)) + EPS)
      out.push(`GREW ${k}: pin ${a.crap} is above the base pin ${old.get(k)}`)
  }
  return out
}

const isOver = (r, limit, ccCap) => r.crap > limit || (ccCap > 0 && r.cc > ccCap)

function nonVacuity(rows) {
  if (rows.length === 0)
    return [
      'non-vacuity: zero functions to score (empty --functions: the extractor read the wrong folder?)'
    ]
  if (!rows.some((r) => r.hasData))
    return [
      'non-vacuity: no function matched any coverage data (wrong path roots or empty report?)'
    ]
  return []
}

function indexAllow(allow, out) {
  const allowed = new Map()
  for (const a of allow) {
    if (allowed.has(key(a))) out.push(`allow list: duplicate entry ${key(a)}`)
    allowed.set(key(a), a)
  }
  return allowed
}

function newFinding(r, limit, ccCap) {
  const data = r.hasData ? '' : ' (no coverage data)'
  return `NEW  ${key(r)}: CRAP ${r.crap} (limit ${limit}), CC ${r.cc} (cap ${ccCap || 'off'}), coverage ${r.cov.toFixed(2)}${data}`
}

function pinFinding(r, pin, over) {
  const k = key(r)
  if (!over)
    return `STALE ${k}: now under both limits (CRAP ${r.crap}, CC ${r.cc}): remove it from the allow list`
  if (r.crap > pin + EPS) return `ROSE ${k}: CRAP ${r.crap} > pinned ${pin}`
  if (r.crap < pin - EPS)
    return `FELL ${k}: CRAP ${r.crap} < pinned ${pin}: lower the pin in the same commit`
  return null
}

function rowFindings(r, allowed, limit, ccCap) {
  const out = r.error ? [`AMBIGUOUS ${key(r)}: ${r.error}`] : []
  const over = isOver(r, limit, ccCap)
  const a = allowed.get(key(r))
  if (a === undefined) return over ? [...out, newFinding(r, limit, ccCap)] : out
  const f = pinFinding(r, round2(a.crap), over)
  return f === null ? out : [...out, f]
}

function allowFindings(allowed, byKey) {
  const out = []
  for (const [k, a] of allowed) {
    if (!byKey.has(k))
      out.push(`STALE ${k}: function not found any more: remove it from the allow list`)
    else if (!a.reason) out.push(`allow list: ${k} has no reason`)
  }
  return out
}

/** Every finding, as text. */
export function check(rows, allow, limit, ccCap) {
  const out = nonVacuity(rows)
  const allowed = indexAllow(allow, out)
  for (const r of rows) out.push(...rowFindings(r, allowed, limit, ccCap))
  return [...out, ...allowFindings(allowed, new Set(rows.map(key)))]
}

// ---------- command line

const OPTS = [
  '--functions',
  '--coverage',
  '--allow',
  '--limit',
  '--cc-cap',
  '--report',
  '--base-allow'
]
const USAGE =
  'usage: crap.mjs --functions fn.json --coverage lcov.info [--allow FILE] [--limit 30] [--cc-cap 10] [--exclude PREFIX]... [--base-allow FILE] [--init-allow] [--report N]'

/** argv → options, or null on a usage error. */
function parseArgs(argv) {
  const opt = { '--limit': '30', '--cc-cap': '10', exclude: [], init: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--init-allow') opt.init = true
    else if (i + 1 >= argv.length) return null
    else if (a === '--exclude') opt.exclude.push(argv[++i])
    else if (OPTS.includes(a)) opt[a] = argv[++i]
    else return null
  }
  return opt['--functions'] && opt['--coverage'] ? opt : null
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

function load(opt) {
  const limit = Number(opt['--limit'])
  const ccCap = Number(opt['--cc-cap'])
  if (!Number.isFinite(limit)) throw new Error('--limit must be a number')
  if (!isInt(ccCap) || ccCap < 0) throw new Error('--cc-cap must be an integer >= 0 (0 = off)')
  const all = readJson(opt['--functions'])
  const allowPath = opt['--allow']
  const allow = allowPath && fs.existsSync(allowPath) ? readJson(allowPath) : []
  const base = opt['--base-allow'] ? readJson(opt['--base-allow']) : null
  validate(all, allow)
  if (base !== null) validate([], base)
  const fns = all.filter((f) => !opt.exclude.some((p) => f.file.startsWith(p)))
  const rows = scoreAll(fns, parseCoverageText(fs.readFileSync(opt['--coverage'], 'utf8')))
  return { limit, ccCap, allow, base, rows }
}

function initAllow({ rows, limit, ccCap }, io) {
  const vac = nonVacuity(rows)
  if (vac.length > 0) {
    io.err(`crap: ${vac[0]}`)
    return 1
  }
  const offenders = rows
    .filter((r) => isOver(r, limit, ccCap))
    .map((r) => ({ file: r.file, name: r.name, crap: r.crap, reason: INIT_REASON }))
  io.out(JSON.stringify(offenders, null, 2))
  return 0
}

function report(rows, n, io) {
  for (const r of [...rows].sort((a, b) => b.crap - a.crap).slice(0, n))
    io.out(
      `${r.crap.toFixed(2).padStart(8)}  CC ${String(r.cc).padStart(3)}  cov ${r.cov.toFixed(2)}  ${key(r)}`
    )
}

/** The whole command; returns the exit code. `io` writes one line to stdout / stderr. */
export function main(argv, io) {
  const opt = parseArgs(argv)
  if (opt === null) {
    io.err(USAGE)
    return 2
  }
  let ctx
  try {
    ctx = load(opt)
  } catch (e) {
    io.err(`crap: bad input: ${e.message}`)
    return 2
  }
  if (opt.init) return initAllow(ctx, io)
  if (opt['--report']) report(ctx.rows, Number(opt['--report']), io)
  const findings = check(ctx.rows, ctx.allow, ctx.limit, ctx.ccCap)
  if (ctx.base !== null) findings.push(...checkShrink(ctx.allow, ctx.base))
  for (const f of findings) io.out(f)
  io.out(`crap: ${ctx.rows.length} functions, ${findings.length} finding(s)`)
  return findings.length > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n')
  })
}
