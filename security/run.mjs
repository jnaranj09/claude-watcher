// `npm run security` — the T13 scans (docs/threat-model.md "Blocking policy", .claude/rules/security.md).
// Each scanner runs from the image `security/tools.Dockerfile` pins (`AS <tool>`), by digest.
//
//   gitleaks  whole git history + the uncommitted diff; false positives in `.gitleaksignore`
//   trivy     fs on every tracked package-lock.json, dev deps included, HIGH/CRITICAL with a fix
//   semgrep   `semgrep --test` on the repo's own rules first, then a scan of src/, offline
//   zizmor    --offline on .github/, medium and up
//
// Red (exit 1) on a finding, and on anything that means the check did not really run: docker or
// an image missing, a pull that fails, a tool error, zero commits / files / workflows scanned, a
// lockfile missing from Trivy's report. Live `security/allow.json` entries are handed to their
// tool; an expired entry is not, so its finding comes back (guard `security-allow-list` also
// fails on it). Node built-ins only: the CI job runs this without `npm ci`.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS = ['gitleaks', 'trivy', 'semgrep', 'zizmor']
const USER = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
const SRC_EXCLUDES = ['*.test.ts', '*.test.tsx', '__fixtures__']

class Red extends Error {}

/** `FROM <ref>@sha256:<64 hex> AS <tool>` per stage; every tool must have one. */
function images() {
  const text = readFileSync(join(ROOT, 'security/tools.Dockerfile'), 'utf8')
  const refs = {}
  for (const m of text.matchAll(/^FROM (\S+@sha256:[0-9a-f]{64}) AS (\S+)$/gm)) refs[m[2]] = m[1]
  for (const tool of TOOLS)
    if (refs[tool] === undefined) throw new Red(`tools.Dockerfile has no pinned stage "${tool}"`)
  return refs
}

/** Ids of `tool` whose `expires` is today or later. The shape is the guard's job. */
function liveAllowed(tool) {
  const list = JSON.parse(readFileSync(join(ROOT, 'security/allow.json'), 'utf8'))
  if (!Array.isArray(list)) throw new Red('security/allow.json is not an array')
  const today = new Date().toISOString().slice(0, 10)
  return list.filter((e) => e.tool === tool && e.expires >= today).map((e) => e.id)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.error) throw new Red(`${cmd} could not start (${r.error.code}): install it`)
  return r
}

function ensureImage(ref) {
  if (run('docker', ['image', 'inspect', ref]).status === 0) return
  const pull = run('docker', ['pull', '-q', ref])
  if (pull.status !== 0) throw new Red(`docker pull failed: ${ref}\n${pull.stderr.trim()}`)
}

function docker(ref, mounts, args, { network = false, workdir } = {}) {
  const base = ['run', '--rm', '-u', USER, '-e', 'HOME=/tmp']
  if (!network) base.push('--network', 'none')
  for (const [host, inner, mode] of mounts) base.push('-v', `${host}:${inner}:${mode}`)
  if (workdir) base.push('-w', workdir)
  return run('docker', [...base, ref, ...args])
}

function gitleaks(ref, out) {
  const ignore = '/repo/.gitleaksignore'
  const common = ['--redact', '--no-banner', '--exit-code', '0', '--gitleaks-ignore-path', ignore]
  const mounts = [
    [ROOT, '/repo', 'ro'],
    [out, '/out', 'rw']
  ]
  const hist = docker(ref, mounts, [
    'git',
    '/repo',
    ...common,
    '-f',
    'json',
    '-r',
    '/out/gl-h.json'
  ])
  if (hist.status !== 0) throw new Red(`gitleaks failed:\n${hist.stderr.trim()}`)
  const commits = Number(/(\d+) commits scanned/.exec(hist.stderr)?.[1] ?? 0)
  if (commits === 0) throw new Red('gitleaks scanned 0 commits (shallow clone? use fetch-depth: 0)')
  // Not committed yet: what is staged, and what is changed but not staged (a new file shows only
  // once it is staged or added with `git add -N`). CI sees both later as history.
  const reports = ['gl-h.json']
  for (const [flag, name] of [
    ['--staged', 'gl-s.json'],
    ['--pre-commit', 'gl-d.json']
  ]) {
    const r = docker(ref, mounts, [
      'git',
      '/repo',
      flag,
      ...common,
      '-f',
      'json',
      '-r',
      `/out/${name}`
    ])
    if (r.status !== 0) throw new Red(`gitleaks ${flag} failed:\n${r.stderr.trim()}`)
    reports.push(name)
  }
  const found = reports.flatMap((f) => JSON.parse(readFileSync(join(out, f), 'utf8')))
  return {
    scanned: `${commits} commits + the staged and unstaged changes`,
    findings: found.map((f) => `${f.RuleID} ${f.File}:${f.StartLine} (${f.Fingerprint})`)
  }
}

function trivy(ref, out) {
  const locks = run('git', ['-C', ROOT, 'ls-files', '*package-lock.json'])
    .stdout.split('\n')
    .filter(Boolean)
  if (locks.length === 0) throw new Red('trivy: no tracked package-lock.json')
  const cache = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'claude-watcher-trivy'
  )
  mkdirSync(cache, { recursive: true })
  writeFileSync(join(out, '.trivyignore'), liveAllowed('trivy').join('\n') + '\n')
  const mounts = [
    ...locks.map((l) => [join(ROOT, l), `/scan/${l}`, 'ro']),
    [cache, '/cache', 'rw'],
    [out, '/out', 'rw']
  ]
  // The vulnerability database is downloaded on each run (network on; the cache keeps it small).
  const r = docker(
    ref,
    mounts,
    [
      'fs',
      '--cache-dir',
      '/cache',
      '--scanners',
      'vuln',
      '--include-dev-deps',
      '--ignore-unfixed',
      '--severity',
      'HIGH,CRITICAL',
      '--ignorefile',
      '/out/.trivyignore',
      '--format',
      'json',
      '--output',
      '/out/trivy.json',
      '--quiet',
      '--exit-code',
      '0',
      '/scan'
    ],
    { network: true }
  )
  if (r.status !== 0) throw new Red(`trivy failed:\n${r.stderr.trim()}`)
  const results = JSON.parse(readFileSync(join(out, 'trivy.json'), 'utf8')).Results ?? []
  for (const l of locks)
    if (!results.some((x) => x.Target === l)) throw new Red(`trivy did not read ${l}`)
  return {
    scanned: locks.join(', '),
    findings: results.flatMap((x) =>
      (x.Vulnerabilities ?? []).map(
        (v) =>
          `${v.VulnerabilityID} ${v.PkgName}@${v.InstalledVersion} -> ${v.FixedVersion} (${v.Severity})`
      )
    )
  }
}

function semgrep(ref) {
  const flags = ['--metrics=off', '--disable-version-check']
  const mounts = [[ROOT, '/src', 'ro']]
  const test = docker(ref, mounts, ['semgrep', '--test', ...flags, 'security/semgrep'], {
    workdir: '/src'
  })
  if (test.status !== 0)
    throw new Red(`semgrep --test failed:\n${(test.stdout + test.stderr).trim().slice(-3000)}`)
  const excludes = SRC_EXCLUDES.flatMap((e) => ['--exclude', e])
  const scan = docker(
    ref,
    mounts,
    [
      'semgrep',
      'scan',
      ...flags,
      '--config',
      'security/semgrep',
      ...excludes,
      '--json',
      '--quiet',
      'src'
    ],
    { workdir: '/src' }
  )
  if (scan.status !== 0) throw new Red(`semgrep scan failed:\n${scan.stderr.trim()}`)
  const report = JSON.parse(scan.stdout)
  if (report.errors.length > 0)
    throw new Red(
      `semgrep could not read every file:\n${JSON.stringify(report.errors).slice(0, 2000)}`
    )
  const scanned = report.paths.scanned.length
  if (scanned === 0) throw new Red('semgrep scanned 0 files')
  const allowed = new Set(liveAllowed('semgrep'))
  return {
    scanned: `${scanned} files`,
    findings: report.results
      .map((x) => ({ id: `${x.check_id.split('.').pop()}:${x.path}`, line: x.start.line }))
      .filter((x) => !allowed.has(x.id))
      .map((x) => `${x.id}:${x.line}`)
  }
}

function zizmor(ref) {
  const r = docker(
    ref,
    [[join(ROOT, '.github'), '/repo/.github', 'ro']],
    ['--offline', '--no-progress', '--format', 'json', '--min-severity', 'medium', '.github'],
    { workdir: '/repo' }
  )
  // zizmor exits 0 when clean and 10–14 when it found something; anything else is a failure.
  if (r.status !== 0 && !(r.status >= 10 && r.status <= 14))
    throw new Red(`zizmor failed (exit ${r.status}):\n${r.stderr.trim()}`)
  const audited = (r.stderr.match(/completed \.github\//g) ?? []).length
  if (audited === 0) throw new Red('zizmor audited 0 files')
  const allowed = new Set(liveAllowed('zizmor'))
  return {
    scanned: `${audited} files`,
    findings: JSON.parse(r.stdout)
      .map((f) => {
        const key = f.locations[0]?.symbolic?.key?.Local ?? {}
        const path = key.verbatim_path ?? key.given_path ?? '?'
        return { id: `${f.ident}:${path}`, sev: f.determinations.severity }
      })
      .filter((f) => !allowed.has(f.id))
      .map((f) => `${f.id} (${f.sev})`)
  }
}

function main() {
  const only = process.argv.slice(2)
  const tools = only.length > 0 ? only : TOOLS
  let red = false
  let refs
  try {
    if (run('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0)
      throw new Red('docker is installed but its daemon does not answer')
    refs = images()
  } catch (e) {
    if (!(e instanceof Red)) throw e
    console.error(`security: RED — ${e.message}`)
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), 'cw-security-'))
  const scans = { gitleaks, trivy, semgrep, zizmor }
  try {
    for (const tool of tools) {
      const scan = scans[tool]
      if (scan === undefined) {
        console.error(`security: unknown tool "${tool}" (one of ${TOOLS.join(', ')})`)
        return 1
      }
      try {
        ensureImage(refs[tool])
        const { scanned, findings } = scan(refs[tool], out)
        if (findings.length === 0) {
          console.log(`security: ${tool} ok (${scanned})`)
        } else {
          red = true
          console.error(`security: ${tool} RED — ${findings.length} finding(s) in ${scanned}:`)
          for (const f of findings) console.error(`  ${f}`)
        }
      } catch (e) {
        if (!(e instanceof Red)) throw e
        red = true
        console.error(`security: ${tool} RED — NOT RUN: ${e.message}`)
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
  return red ? 1 : 0
}

process.exitCode = main()
