// Programmatic API — the test doubles every command + server test builds its world from.
//
// NOT a `.test.ts` on purpose: a test file is not importable from another test file, and these
// doubles are shared by the command tests (Task 11), the server tests (Task 12) and the SSE tests
// (Task 13). It sits in the main tree so it typechecks under the same strict program as the code
// it doubles, and nothing in `src/main` imports it — the bundler's graph starts at `index.ts`, so
// it never reaches a build. (`src/__fixtures__/` is a separate top-level tree for the hook feed;
// it is not the precedent for a main-side double.)
//
// The fakes are DUMB on purpose: they hold arrays and hand them back. A command test that has to
// teach its double how to behave is testing the double.
import { request as httpRequest } from 'node:http'
import type { ApiSession } from '../../shared/schemas/api'
import type { Template } from '../../shared/schemas/template'
import type { Workspace } from '../../shared/schemas/workspace'
import type { LaunchRequest } from '../pty/launchSession'
import type { AnyApiCommand, ApiContext } from './registry'
import { createApiEventHub, type ApiSeam, type ApiSessionEvent } from './apiSeam'
import { createApiServer, type ApiServer, type ApiServerOptions } from './apiServer'

export interface FakeSeam extends ApiSeam {
  sessions: ApiSession[]
  launches: LaunchRequest[]
  emit(event: ApiSessionEvent): void
  /** The session id awaitSessionId resolves with; null ⇒ reject spawn_timeout. */
  nextSessionId: string | null
  /** Live `onEvent` subscriptions. An SSE stream that drops its unsubscribe leaks HERE and
   *  nowhere else (a send on a dead sink is a silent no-op), so Task 13 asserts on it. */
  subscriberCount(): number
}

export function makeFakeSeam(sessions: ApiSession[] = []): FakeSeam {
  const hub = createApiEventHub(() => {})
  let subscribers = 0
  const seam: FakeSeam = {
    sessions,
    launches: [],
    nextSessionId: 'sess-1',
    emit: (e) => hub.emit(e),
    listSessions: () => [...seam.sessions],
    getSession: (id) => seam.sessions.find((s) => s.id === id) ?? null,
    subscriberCount: () => subscribers,
    onEvent: (cb) => {
      subscribers++
      const off = hub.onEvent(cb)
      // Idempotent: a double-unsubscribe must not drive the count negative, or a leak test
      // could be "passed" by unsubscribing twice.
      let done = false
      return () => {
        if (done) return
        done = true
        subscribers--
        off()
      }
    },
    requestLaunch: (req) => {
      seam.launches.push(req)
      return { terminalId: 'term-1', workspaceId: req.workspaceId ?? 'default' }
    },
    awaitSessionId: () =>
      seam.nextSessionId === null
        ? Promise.reject(new Error('spawn_timeout'))
        : Promise.resolve(seam.nextSessionId)
  }
  return seam
}

export interface FakeContextSeed {
  /** `null` ⇒ no window: `ctx.seam()` returns null and every command answers 503 `no_window`. */
  seam: FakeSeam | null
  templates: Template[]
  workspaces: Workspace[]
  activeWorkspaceId: string
  claudeOk: boolean
  /** What `ctx.isDirectory` answers for every path (UX-11). Default true. */
  folderExists: boolean
}

export function makeFakeContext(over: Partial<FakeContextSeed> = {}): {
  ctx: ApiContext
  seam: FakeSeam | null
  log: string[]
} {
  // `?? makeFakeSeam()` would be wrong here: an EXPLICIT `seam: null` is the no-window case a
  // test is asking for, not an omission to be defaulted away.
  const seam = over.seam === undefined ? makeFakeSeam() : over.seam
  const templates = over.templates ?? []
  const workspaces = over.workspaces ?? []
  const log: string[] = []
  const ctx: ApiContext = {
    seam: () => seam,
    templates: {
      get: (id) => templates.find((t) => t.id === id) ?? null,
      list: () => [...templates]
    },
    workspaces: {
      activeId: () => over.activeWorkspaceId ?? 'default',
      get: (id) => workspaces.find((w) => w.id === id) ?? null,
      list: () => [...workspaces]
    },
    claudeVersionAllowsLaunch: () => over.claudeOk ?? true,
    isDirectory: () => over.folderExists ?? true,
    now: () => 1000,
    spawnTimeoutMs: 50,
    log: (m) => log.push(m)
  }
  return { ctx, seam, log }
}

/** The bearer every test sends. 64 hex-ish chars, the shape `apiToken.ts` mints. */
export const TEST_TOKEN = 'a'.repeat(64)

export interface TestServerOverrides {
  token?: string
  log?: (m: string) => void
  maxStreams?: number
  pingMs?: number
  publicRoutes?: ApiServerOptions['publicRoutes']
}

/**
 * Start the REAL `createApiServer` on an ephemeral port (127.0.0.1), resolving once it is
 * listening. Every server test drives the production listener — not a hand-copied handler — so
 * reverting a guard in `apiServer.ts` turns a test red.
 */
export function startTestServer(
  commands: readonly AnyApiCommand[],
  ctx: ApiContext,
  over: TestServerOverrides = {}
): Promise<{ server: ApiServer; url: string }> {
  return new Promise((resolve) => {
    const server = createApiServer({
      commands,
      context: ctx,
      // A GETTER, like production: a regenerate between two requests must be picked up by the
      // second one without restarting the server.
      token: () => over.token ?? TEST_TOKEN,
      port: 0,
      host: '127.0.0.1',
      log: over.log ?? ((): void => {}),
      ...(over.maxStreams !== undefined ? { maxStreams: over.maxStreams } : {}),
      ...(over.pingMs !== undefined ? { pingMs: over.pingMs } : {}),
      ...(over.publicRoutes !== undefined ? { publicRoutes: over.publicRoutes } : {}),
      onListening: (port) => resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

export interface Reply {
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}

export interface CallOptions {
  body?: string
  /** `undefined` ⇒ TEST_TOKEN; `null` ⇒ send no Authorization header at all. */
  token?: string | null
  rawBody?: Buffer
  /** Sets `Authorization` VERBATIM, overriding the bearer built from `token`. The only way to
   *  send another SCHEME — which is a branch of `bearerOk` a wrong token never reaches. */
  rawAuthorization?: string
}

/** One request, resolved once the response has ENDED. Never use it on an SSE route: a stream
 *  does not end (the SSE tests read the socket directly). */
export function call(
  url: string,
  method: string,
  path: string,
  opts: CallOptions = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const headers: Record<string, string | number> = { 'content-type': 'application/json' }
    const token = opts.token === undefined ? TEST_TOKEN : opts.token
    if (token !== null) headers['authorization'] = `Bearer ${token}`
    if (opts.rawAuthorization !== undefined) headers['authorization'] = opts.rawAuthorization
    const payload = opts.rawBody ?? (opts.body !== undefined ? Buffer.from(opts.body) : undefined)
    if (payload !== undefined) headers['content-length'] = payload.length
    const req = httpRequest(
      { hostname: u.hostname, port: Number(u.port), path, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8')
          })
        )
      }
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}
