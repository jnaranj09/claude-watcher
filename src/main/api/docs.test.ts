// Programmatic API — the docs routes, driven through the REAL server (`startTestServer`) so the
// public-route hook's own contract is under test, not a hand-copied copy of it:
//   - `/openapi.json` and `/docs` answer WITHOUT a token (they are how a caller learns to
//     authenticate), while `/v1/*` still refuses one that is missing.
//   - `/docs/<file>` serves an ALLOW-LIST of three names. Everything else under `/docs/` is a 404,
//     and nothing is ever joined from the request path, so there is no traversal to attempt.
//   - a missing dist dir degrades `/docs` to a 503 and leaves `/openapi.json` working.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDocsRoutes, resolveSwaggerDistDir } from './docs'
import { startTestServer, call, makeFakeContext } from './testSupport'
import type { ApiServer } from './apiServer'

let server: ApiServer | null = null
afterEach(() => {
  server?.close()
  server = null
})

describe('docs routes', () => {
  it('serves /openapi.json and /docs without a token; /docs loads the three dist files', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'swagger-'))
    writeFileSync(join(dist, 'swagger-ui.css'), 'body{}')
    writeFileSync(join(dist, 'swagger-ui-bundle.js'), '/*b*/')
    writeFileSync(join(dist, 'swagger-ui-standalone-preset.js'), '/*p*/')
    const routes = createDocsRoutes({ openapi: () => ({ openapi: '3.1.0' }), swaggerDistDir: dist })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect(await call(s.url, 'GET', '/openapi.json', { token: null })).toMatchObject({
      status: 200,
      text: '{"openapi":"3.1.0"}'
    })
    const html = await call(s.url, 'GET', '/docs', { token: null })
    expect(html.status).toBe(200)
    expect(html.headers['content-type']).toContain('text/html')
    expect(html.text).toContain('/docs/swagger-ui-bundle.js')
    expect(html.text).toContain("url: '/openapi.json'")
    // SEC-4: the token is never saved in the browser's localStorage.
    expect(html.text).not.toContain('persistAuthorization')
    expect(
      (await call(s.url, 'GET', '/docs/swagger-ui.css', { token: null })).headers['content-type']
    ).toContain('text/css')
    expect((await call(s.url, 'GET', '/docs/swagger-ui-bundle.js', { token: null })).text).toBe(
      '/*b*/'
    )
    expect(
      (await call(s.url, 'GET', '/docs/swagger-ui-standalone-preset.js', { token: null })).text
    ).toBe('/*p*/')
  })

  it('serves only the allow-listed files (no traversal, no package.json)', async () => {
    const routes = createDocsRoutes({
      openapi: () => ({}),
      swaggerDistDir: resolveSwaggerDistDir()
    })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect((await call(s.url, 'GET', '/docs/package.json', { token: null })).status).toBe(404)
    // WITH the token (the helper's default). `new URL()` normalises `/docs/../package.json` to
    // `/package.json` before the server ever sees it, so it is not a docs route at all — it
    // reaches the router, matches no command, and is a plain 404. Sent WITHOUT a token it would
    // answer 401 first and prove nothing about traversal.
    expect((await call(s.url, 'GET', '/docs/../package.json')).status).toBe(404)
    expect((await call(s.url, 'GET', '/docs/swagger-ui-bundle.js', { token: null })).status).toBe(
      200
    )
  })

  it('a prototype key is not an allow-listed name — 404, and NOTHING is read', async () => {
    // `FILES` is an object, so `FILES['constructor']` is `Object.prototype.constructor` — not
    // `undefined`. A plain `=== undefined` check therefore let `/docs/constructor`,
    // `/docs/__proto__` and `/docs/toString` through to `readFileSync`, which ENOENTs and logs
    // `docs_read_failed` — on a route that needs NO token, so an unauthenticated caller could
    // fill the journal with it. The membership test must be an OWN-property one.
    const lines: string[] = []
    const routes = createDocsRoutes({
      openapi: () => ({}),
      swaggerDistDir: resolveSwaggerDistDir(),
      log: (m) => lines.push(m)
    })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect((await call(s.url, 'GET', `/docs/${name}`, { token: null })).status).toBe(404)
    }
    expect(lines).toEqual([])
  })

  it('answers nothing for a non-GET, so /docs is never a write surface', async () => {
    const routes = createDocsRoutes({
      openapi: () => ({}),
      swaggerDistDir: resolveSwaggerDistDir()
    })
    // The hook itself: a POST must fall THROUGH (null), which is what leaves the bearer check and
    // the router in charge. Asserted on the hook and then end-to-end.
    expect(routes({ method: 'POST', path: '/docs' })).toBeNull()
    expect(routes({ method: 'POST', path: '/openapi.json' })).toBeNull()
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect((await call(s.url, 'POST', '/openapi.json', { token: null })).status).toBe(401)
  })

  it('logs a CODE, not a path, when an allow-listed file cannot be read', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'swagger-empty-'))
    const lines: string[] = []
    const routes = createDocsRoutes({
      openapi: () => ({}),
      swaggerDistDir: empty,
      log: (m) => lines.push(m)
    })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect((await call(s.url, 'GET', '/docs/swagger-ui.css', { token: null })).status).toBe(404)
    expect(lines).toEqual(['[claude-watcher][api] code=docs_read_failed'])
    expect(lines.join('\n')).not.toContain(empty)
  })

  it('without the dist dir, /docs answers 503 and /openapi.json still works', async () => {
    const routes = createDocsRoutes({ openapi: () => ({}), swaggerDistDir: null })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect((await call(s.url, 'GET', '/docs', { token: null })).status).toBe(503)
    expect((await call(s.url, 'GET', '/openapi.json', { token: null })).status).toBe(200)
  })

  it('/v1 routes still need the token even with public routes installed', async () => {
    const routes = createDocsRoutes({ openapi: () => ({}), swaggerDistDir: null })
    const { ctx } = makeFakeContext()
    const s = await startTestServer([], ctx, { publicRoutes: routes })
    server = s.server
    expect((await call(s.url, 'GET', '/v1/sessions', { token: null })).status).toBe(401)
  })

  it('resolves the installed swagger-ui-dist package directory', () => {
    const dir = resolveSwaggerDistDir()
    expect(dir).not.toBeNull()
    expect(dir).toContain('swagger-ui-dist')
  })
})
