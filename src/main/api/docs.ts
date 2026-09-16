// Programmatic API — `/openapi.json` and `/docs` (Swagger UI), served through the server's
// `publicRoutes` hook so they need NO bearer token: they are how a caller learns that the rest of
// the API needs one, and a login page you must already be logged in to read is no help.
//
// Swagger UI's assets come from the `swagger-ui-dist` package, read from disk at request time.
// Nothing is imported from it (electron-vite's `externalizeDepsPlugin` keeps `dependencies` out of
// the main bundle, so the package ships unbundled in `node_modules` and `require.resolve` finds it
// in dev and in the packaged app alike).
//
// THE ALLOW-LIST IS THE WHOLE SECURITY POSTURE. Three file NAMES are servable and the path is
// never joined from the request: `/docs/package.json` is a 404, and there is no traversal to
// attempt because no attacker-controlled segment ever reaches `join()`. (`new URL()` in the server
// has already normalised `/docs/../x` to `/x`, which is not a docs route at all — it falls through
// to the token check and the router.)
//
// NEVER-LOG-THE-VALUE: an unreadable asset logs a bare CODE — no path, no errno message, no file
// name. [.claude/rules/zod-boundaries.md; src/main/api/apiServer.ts]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { ApiServerOptions, PublicRouteReply } from './apiServer'

/** The ONLY names servable under `/docs/`, each with the content type it is served as. Swagger UI
 *  needs exactly these three; the maps, the ES bundles and the package manifest stay unreachable. */
const FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'application/javascript; charset=utf-8'
}

/** Our own index page rather than the dist one: theirs points at petstore and ships an OAuth2
 *  redirect we do not serve. `persistAuthorization` keeps the operator's pasted token across a
 *  reload, so "Try it out" is usable more than once. */
const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>claude-watcher API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/docs/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/docs/swagger-ui-bundle.js"></script>
<script src="/docs/swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  persistAuthorization: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'BaseLayout'
})
</script></body></html>`

/**
 * The `swagger-ui-dist` package directory, or null when it cannot be resolved (a broken or
 * pruned install — `/docs` then answers 503 and the rest of the API is unaffected).
 *
 * `createRequire(__filename)`, not `import.meta.url`: the main bundle is CommonJS at runtime, and
 * `__filename` is what both that bundle and the Vitest module wrapper provide.
 */
export function resolveSwaggerDistDir(): string | null {
  try {
    return dirname(createRequire(__filename).resolve('swagger-ui-dist/package.json'))
  } catch {
    return null
  }
}

/**
 * The public-route hook. Returns `null` for anything it does not own — every other method, and
 * every path outside `/openapi.json`, `/docs` and the three allow-listed `/docs/<file>` names — so
 * the server's bearer check and router stay in charge of everything else.
 *
 * `NonNullable<...>`, not the bare `ApiServerOptions['publicRoutes']`: that union includes
 * `undefined`, and the option is spread conditionally, so an `undefined` would silently DISABLE
 * the docs instead of failing.
 */
export function createDocsRoutes(opts: {
  openapi: () => Record<string, unknown>
  swaggerDistDir: string | null
  log?: (message: string) => void
}): NonNullable<ApiServerOptions['publicRoutes']> {
  const log = opts.log ?? ((m: string): void => console.warn(m))
  // Read once, then held: the assets are ~1.5 MB of immutable package files and `/docs` asks for
  // all three on every load.
  const cache = new Map<string, Buffer>()
  const notFound: PublicRouteReply = { status: 404, contentType: 'text/plain', body: 'not found' }

  return ({ method, path }): PublicRouteReply | null => {
    if (method !== 'GET') return null
    if (path === '/openapi.json') {
      return {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(opts.openapi())
      }
    }
    if (path === '/docs' || path === '/docs/') {
      if (opts.swaggerDistDir === null) {
        return {
          status: 503,
          contentType: 'text/plain',
          body: 'Swagger UI files are not installed'
        }
      }
      return { status: 200, contentType: 'text/html; charset=utf-8', body: INDEX_HTML }
    }
    if (path.startsWith('/docs/')) {
      const name = path.slice('/docs/'.length)
      // `Object.hasOwn`, never a bare lookup: `FILES` is an object, so `FILES['constructor']`
      // (and `__proto__`, `toString`, …) resolves through the PROTOTYPE and is not `undefined`.
      // A `=== undefined` membership test therefore let `/docs/constructor` through to
      // `readFileSync`, which ENOENTs and logs `docs_read_failed` — on a route that needs NO
      // token, so an unauthenticated caller could fill the operator's journal with it.
      if (!Object.hasOwn(FILES, name) || opts.swaggerDistDir === null) return notFound
      const contentType = FILES[name]
      if (contentType === undefined) return notFound
      let body = cache.get(name)
      if (body === undefined) {
        try {
          // `name` is one of the three keys of FILES — a literal from THIS file, never the request
          // path — so the join has no attacker-controlled segment in it.
          body = readFileSync(join(opts.swaggerDistDir, name))
          cache.set(name, body)
        } catch {
          // CODE ONLY: the errno message quotes the absolute path, which leaks the install layout.
          log('[claude-watcher][api] code=docs_read_failed')
          return notFound
        }
      }
      return { status: 200, contentType, body }
    }
    return null
  }
}
