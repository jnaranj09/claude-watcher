// Programmatic API — the security headers (docs/threat-model.md T-A4). EVERY kind of response the
// listener writes carries `nosniff`, `no-referrer`, `same-origin` CORP and a CSP that frames nothing: JSON, an error
// before the token check (401), a router miss (404), a stream, the docs page (its own CSP, with the
// boot script's hash) and a static docs file. Driven through the REAL server, so a `writeHead`
// that skips `apiHeaders` turns one red.
import { describe, it, expect, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { get as httpGet, type IncomingHttpHeaders } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineCommand } from './registry'
import { EmptySchema } from '../../shared/schemas/api'
import { API_DEFAULT_CSP, type ApiServer } from './apiServer'
import { DOCS_CSP, createDocsRoutes } from './docs'
import { startTestServer, call, makeFakeContext, TEST_TOKEN } from './testSupport'

const ok = defineCommand({
  id: 'test.ok',
  method: 'GET',
  path: '/v1/ok',
  summary: 'ok',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: z.object({ ok: z.boolean() }).strict(),
  successStatus: 200,
  errorStatuses: [],
  async handler() {
    return { ok: true, status: 200, body: { ok: true } }
  }
})

const stream = defineCommand({
  id: 'test.stream',
  method: 'GET',
  path: '/v1/stream',
  summary: 's',
  params: EmptySchema,
  query: EmptySchema,
  body: null,
  output: 'text/event-stream',
  successStatus: 200,
  errorStatuses: [],
  async stream(_ctx, _input, sink) {
    sink.start()
    return null
  }
})

let server: ApiServer | null = null
const tempDirs: string[] = []
afterEach(() => {
  server?.close()
  server = null
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function start(): Promise<string> {
  const dist = mkdtempSync(join(tmpdir(), 'swagger-'))
  tempDirs.push(dist)
  writeFileSync(join(dist, 'swagger-ui.css'), 'body{}')
  writeFileSync(join(dist, 'swagger-ui-bundle.js'), '/*b*/')
  writeFileSync(join(dist, 'swagger-ui-standalone-preset.js'), '/*p*/')
  const routes = createDocsRoutes({ openapi: () => ({ openapi: '3.1.0' }), swaggerDistDir: dist })
  const { ctx } = makeFakeContext()
  const s = await startTestServer([ok, stream], ctx, { publicRoutes: routes })
  server = s.server
  return s.url
}

/** The headers of a stream: read them, then hang up (the stream never ends by itself). */
function streamHeaders(url: string, path: string): Promise<IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      `${url}${path}`,
      { headers: { authorization: `Bearer ${TEST_TOKEN}` } },
      (res) => {
        resolve(res.headers)
        req.destroy()
      }
    )
    req.on('error', reject)
  })
}

function expectSecurityHeaders(headers: IncomingHttpHeaders, csp: string): void {
  expect({
    nosniff: headers['x-content-type-options'],
    referrer: headers['referrer-policy'],
    corp: headers['cross-origin-resource-policy'],
    csp: headers['content-security-policy']
  }).toEqual({ nosniff: 'nosniff', referrer: 'no-referrer', corp: 'same-origin', csp })
}

describe('API security headers', () => {
  it('a JSON answer, a 401 and a router 404 carry nosniff, no-referrer and the frame-nothing CSP', async () => {
    const url = await start()
    const replies = await Promise.all([
      call(url, 'GET', '/v1/ok'),
      call(url, 'GET', '/v1/ok', { token: null }),
      call(url, 'GET', '/v1/nowhere')
    ])
    expect(replies.map((r) => r.status)).toEqual([200, 401, 404])
    for (const r of replies) expectSecurityHeaders(r.headers, API_DEFAULT_CSP)
    expect(replies.map((r) => r.headers['cache-control'])).toEqual([
      'no-store',
      'no-store',
      'no-store'
    ])
    expect(API_DEFAULT_CSP).toContain("frame-ancestors 'none'")
  })

  it('an event stream carries them too', async () => {
    const url = await start()
    const headers = await streamHeaders(url, '/v1/stream')
    expect(headers['content-type']).toBe('text/event-stream')
    expect(headers['cache-control']).toBe('no-cache')
    expectSecurityHeaders(headers, API_DEFAULT_CSP)
  })

  it('a static docs file and /openapi.json carry the default CSP', async () => {
    const url = await start()
    for (const path of ['/docs/swagger-ui-bundle.js', '/openapi.json', '/docs/nope'])
      expectSecurityHeaders(
        (await call(url, 'GET', path, { token: null })).headers,
        API_DEFAULT_CSP
      )
  })

  it('the docs page runs only its own files and its one inline script, by hash', async () => {
    const url = await start()
    const page = await call(url, 'GET', '/docs', { token: null })
    expectSecurityHeaders(page.headers, DOCS_CSP)
    const inline = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
    expect(inline).toHaveLength(1)
    const hash = createHash('sha256')
      .update(inline[0] ?? '')
      .digest('base64')
    const scriptSrc = DOCS_CSP.split('; ').find((d) => d.startsWith('script-src '))
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${hash}'`)
    expect(DOCS_CSP).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'/)
  })
})
