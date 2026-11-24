// DAST (docs/threat-model.md T-A1–T-A4, T-C10): ZAP's API scan against the REAL API of a
// throwaway e2e-profile app, driven by the app's own `/openapi.json`, signed out and signed in.
// Every alert's rule must be listed in `security/zap-rules.tsv`: FAIL fails the run, WARN is
// printed, an alert from an unlisted rule fails the run (a new kind of finding gets a decision).
//
// Safe by construction: no template is seeded and the API cannot write one (it is not a write
// path into config, api.md), so every create answers 404 `template_not_found` before any launch. ZAP runs from the image `security/tools.Dockerfile` pins
// (stage `zap`), on the host network (the API binds 127.0.0.1 only). Needs Docker.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures'
import { E2E_PROFILE } from '../../src/main/profile'
import { API_TOKEN_FILENAME } from '../../src/main/api/apiToken'

const ROOT = path.resolve(__dirname, '../..')
const API = `http://127.0.0.1:${E2E_PROFILE.apiPort}`
const TOKEN = 'd'.repeat(64)

test.use({ extraSettings: { apiEnabled: true, apiPort: E2E_PROFILE.apiPort } })
// Two scans (an active scan each) and an app start.
test.setTimeout(15 * 60 * 1000)

/** The `FROM <ref> AS zap` image, pinned by digest (guard supply-chain-pins). */
function zapImage(): string {
  const text = readFileSync(path.join(ROOT, 'security/tools.Dockerfile'), 'utf8')
  const ref = /^FROM (\S+@sha256:[0-9a-f]{64}) AS zap$/m.exec(text)?.[1]
  if (ref === undefined) throw new Error('security/tools.Dockerfile has no pinned "zap" stage')
  return ref
}

/** pluginid → FAIL | WARN | IGNORE, from `security/zap-rules.tsv` (id, level, reason). */
function zapRules(): Map<string, string> {
  const rules = new Map<string, string>()
  for (const line of readFileSync(path.join(ROOT, 'security/zap-rules.tsv'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const [id = '', level = '', reason = ''] = line.split('\t')
    if (!/^\d+$/.test(id) || !['FAIL', 'WARN', 'IGNORE'].includes(level) || reason.length < 10)
      throw new Error(`security/zap-rules.tsv: bad line "${line}"`)
    rules.set(id, level)
  }
  return rules
}

interface ZapAlert {
  pluginid: string
  name: string
  riskdesc: string
  instances: { uri: string; method: string }[]
}

/** One API scan; returns its alerts. Red when ZAP errors or imports no URL. */
function scan(name: string, auth: boolean): ZapAlert[] {
  const work = mkdtempSync(path.join(tmpdir(), `cw-zap-${name}-`))
  try {
    // ZAP runs as its own user inside the image and writes its reports here.
    chmodSync(work, 0o777)
    const env = auth
      ? ['-e', 'ZAP_AUTH_HEADER=Authorization', '-e', `ZAP_AUTH_HEADER_VALUE=Bearer ${TOKEN}`]
      : []
    const r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'host',
        '-v',
        `${work}:/zap/wrk:rw`,
        ...env,
        zapImage(),
        'zap-api-scan.py',
        '-t',
        `${API}/openapi.json`,
        '-f',
        'openapi',
        '-J',
        'report.json',
        '-I'
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
    if (r.error) throw new Error(`docker could not start (${String(r.error)}): DAST NOT RUN`)
    const out = `${r.stdout}\n${r.stderr}`
    // 0 = clean, 2 = warnings (with -I, failures too); 1 and 3 = ZAP itself failed.
    if (r.status !== 0 && r.status !== 2)
      throw new Error(`ZAP exit ${r.status}:\n${out.slice(-3000)}`)
    const urls = Number(/Number of Imported URLs: (\d+)/.exec(out)?.[1] ?? 0)
    if (urls === 0) throw new Error(`ZAP imported no URL from /openapi.json:\n${out.slice(-3000)}`)
    const report = JSON.parse(readFileSync(path.join(work, 'report.json'), 'utf8')) as {
      site: { alerts: ZapAlert[] }[]
    }
    return report.site.flatMap((s) => s.alerts)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** What to do with each alert: FAIL and unlisted rules are problems, WARN is printed. */
function classify(name: string, alerts: ZapAlert[], rules: Map<string, string>): string[] {
  const problems: string[] = []
  for (const a of alerts) {
    const level = rules.get(a.pluginid)
    const where = a.instances
      .slice(0, 3)
      .map((i) => `${i.method} ${i.uri}`)
      .join(', ')
    const line = `${name}: ${a.pluginid} ${a.name} (${a.riskdesc}) at ${where}`
    if (level === undefined) problems.push(`unlisted rule — ${line}`)
    else if (level === 'FAIL') problems.push(line)
    else if (level === 'WARN') console.log(`[dast] WARN ${line}`)
  }
  return problems
}

/** GET /v1/sessions with the token; 0 while the listener is not up yet. */
const sessions = (): Promise<number> =>
  fetch(`${API}/v1/sessions`, { headers: { authorization: `Bearer ${TOKEN}` } }).then(
    (r) => r.status,
    () => 0
  )

test('ZAP API scan, signed out and signed in: no FAIL and no unlisted alert', async ({
  page,
  appEnv
}) => {
  writeFileSync(path.join(appEnv.dataDir, API_TOKEN_FILENAME), TOKEN)
  await expect(page.getByTestId('app-menu')).toBeVisible({ timeout: 20000 })
  // A made-up caller: the token works before the scan…
  await expect.poll(sessions, { timeout: 30000 }).toBe(200)
  const rules = zapRules()
  const problems = [
    ...classify('signed-out', scan('signed-out', false), rules),
    ...classify('signed-in', scan('signed-in', true), rules)
  ]
  // …and after it: the scan did not break the session.
  expect(await sessions()).toBe(200)
  expect(problems).toEqual([])
})

test('the API docs page renders under its CSP, with no CSP violation', async ({ page }) => {
  await expect(page.getByTestId('app-menu')).toBeVisible({ timeout: 20000 })
  await expect.poll(sessions, { timeout: 30000 }).not.toBe(0)
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.goto(`${API}/docs`)
  // Swagger UI drew the spec it fetched from /openapi.json: the boot script ran (its hash matched).
  await expect(page.locator('.swagger-ui .info .title')).toContainText('claude-watcher', {
    timeout: 20000
  })
  expect(violations).toEqual([])
})
