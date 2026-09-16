// Programmatic API — the localhost HTTP listener. Mirrors `hooks/hookServer.ts`: 127.0.0.1 only,
// a hard body cap, fail-closed Zod at the boundary, PATH + CODE only in logs, and it never throws
// past the request handler. The router and the command list are the SAME registry `openapi.ts`
// documents, so a route cannot exist without a documented command behind it.
//
// Two deliberate departures from the hook server:
//   - EVERY `/v1/*` request carries a bearer token, compared in constant time against a token read
//     through a GETTER on each request (a regenerate takes effect without a restart).
//   - a bind failure is LOGGED with a code rather than silently tolerated. The hook ingest may
//     quietly lose to a second instance; an API that binds nothing while the operator believes it
//     is up is a support call, so `code=listen_failed` always reaches the log.
//
// NEVER-LOG-THE-VALUE: nothing here logs a request body, a header, a query value or the token —
// only the METHOD, the route ID, and the Zod issue PATH + CODE.
// [.claude/rules/zod-boundaries.md; src/main/hooks/hookServer.ts (the :9279 precedent)]
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { ApiErrorCode } from '../../shared/schemas/api'
import {
  API_DEFAULT_PORT,
  API_HOST,
  API_MAX_BODY_BYTES,
  API_SSE_MAX_STREAMS,
  API_SSE_PING_MS
} from './apiContract'
import type { AnyApiCommand, ApiContext, ApiErr, SseSink } from './registry'

/** What a public (token-free) route hands back: docs and the OpenAPI document (Task 14). */
export interface PublicRouteReply {
  status: number
  contentType: string
  body: string | Buffer
}

export interface ApiServerOptions {
  commands: readonly AnyApiCommand[]
  context: ApiContext
  /** Read on EVERY request, never captured: a regenerated token takes effect immediately. */
  token(): string
  /** Extra GET routes that need no token: `/openapi.json`, `/docs`, `/docs/<file>` (Task 14). */
  publicRoutes?: (req: { method: string; path: string }) => PublicRouteReply | null
  port?: number
  host?: string
  onListening?: (port: number) => void
  log?: (message: string) => void
  maxStreams?: number
  pingMs?: number
}

export interface ApiServer {
  close(): void
  /** Open SSE streams (tests + diagnostics). */
  streams(): number
}

/** `/v1/sessions/{id}/events` vs a request path. Segment-exact; `{name}` binds one decoded
 *  segment. Null on any mismatch (a trailing slash is a mismatch). */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    const pat = p[i] ?? ''
    const seg = s[i] ?? ''
    if (pat.startsWith('{') && pat.endsWith('}')) {
      if (seg.length === 0) return null
      try {
        params[pat.slice(1, -1)] = decodeURIComponent(seg)
      } catch {
        return null
      }
    } else if (pat !== seg) {
      return null
    }
  }
  return params
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

/** Constant-time compare after hashing — `timingSafeEqual` needs equal lengths, and hashing gives
 *  them that without leaking the real token's length through a fast reject. */
function bearerOk(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false
  return timingSafeEqual(sha256(header.slice('Bearer '.length)), sha256(token))
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const log = options.log ?? ((m: string): void => console.warn(m))
  const maxStreams = options.maxStreams ?? API_SSE_MAX_STREAMS
  const pingMs = options.pingMs ?? API_SSE_PING_MS
  const openSinks = new Set<{ end(): void }>()

  function writeError(
    res: ServerResponse,
    status: number,
    code: ApiErrorCode,
    path?: string
  ): void {
    // A LITERAL, never `ApiErrorBodySchema.parse(...)`. This is the error path: it runs from
    // OUTSIDE the try (the 401) and from inside dispatch's own `.catch`, so a throw here becomes
    // an unhandled rejection instead of a 500. `code` is already an ApiErrorCode by type, so
    // there is nothing to validate; the schema's job is validating RESPONSES, in the tests.
    const body: { error: { code: ApiErrorCode; path?: string } } = {
      error: { code, ...(path !== undefined ? { path } : {}) }
    }
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  function writeErr(res: ServerResponse, err: ApiErr): void {
    writeError(res, err.status, err.code, err.path)
  }

  function readBody(
    req: IncomingMessage
  ): Promise<{ ok: true; text: string } | { ok: false; code: 'body_too_large' }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let total = 0
      let tooLarge = false
      req.on('data', (chunk: Buffer) => {
        if (tooLarge) return
        total += chunk.length
        // Refused WITHOUT being buffered further: past the cap the chunks stop accumulating.
        if (total > API_MAX_BODY_BYTES) {
          tooLarge = true
          resolve({ ok: false, code: 'body_too_large' })
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (!tooLarge) resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') })
      })
      req.on('error', () => resolve({ ok: false, code: 'body_too_large' }))
    })
  }

  function makeSink(res: ServerResponse): SseSink {
    let started = false
    let ended = false
    let ping: NodeJS.Timeout | null = null
    const closeCbs: Array<() => void> = []
    const sink: SseSink = {
      start() {
        if (started) return
        started = true
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        res.flushHeaders()
        ping = setInterval(() => {
          if (!ended) res.write(': ping\n\n')
        }, pingMs)
        openSinks.add(sink)
      },
      send(event, data, id) {
        if (!started || ended) return
        res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      },
      end() {
        if (ended) return
        ended = true
        if (ping !== null) clearInterval(ping)
        openSinks.delete(sink)
        for (const cb of closeCbs) {
          try {
            cb()
          } catch {
            log('[claude-watcher][api] code=stream_close_threw')
          }
        }
        closeCbs.length = 0
        res.end()
      },
      onClose(cb) {
        // ALREADY ended — the client disconnected before the command registered its cleanup.
        // `end()` drains closeCbs and clears it, so pushing now would park the callback on a
        // dead array and the hub would keep the subscription for the window's lifetime (and
        // `send` on a dead sink is a silent no-op, so nothing would ever show it). Run it now.
        if (ended) {
          try {
            cb()
          } catch {
            log('[claude-watcher][api] code=stream_close_threw')
          }
          return
        }
        closeCbs.push(cb)
      }
    }
    res.on('close', () => sink.end())
    return sink
  }

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'
    const pathname = url.pathname

    // Public routes are consulted BEFORE the bearer check — the docs and the OpenAPI document
    // are how a caller learns to authenticate, so they cannot require a token themselves.
    const pub = options.publicRoutes?.({ method, path: pathname }) ?? null
    if (pub !== null) {
      res.writeHead(pub.status, { 'Content-Type': pub.contentType })
      res.end(pub.body)
      return
    }

    if (!bearerOk(req.headers.authorization, options.token())) {
      // No path, no method, no route: an unauthenticated caller learns only that it is refused.
      writeError(res, 401, 'unauthorized')
      return
    }

    let command: AnyApiCommand | null = null
    let params: Record<string, string> = {}
    let pathKnown = false
    for (const c of options.commands) {
      const m = matchPath(c.path, pathname)
      if (m === null) continue
      pathKnown = true
      if (c.method === method) {
        command = c
        params = m
        break
      }
    }
    if (command === null) {
      writeError(res, pathKnown ? 405 : 404, pathKnown ? 'method_not_allowed' : 'not_found')
      return
    }
    // The request line: method + route id only — never the URL (path params) or the body.
    log(`[claude-watcher][api] method=${method} route=${command.id}`)

    let bodyRaw: unknown = undefined
    if (command.body !== null) {
      const read = await readBody(req)
      if (!read.ok) {
        writeError(res, 400, read.code)
        return
      }
      try {
        bodyRaw = read.text.length === 0 ? {} : JSON.parse(read.text)
      } catch {
        // Value-free: a SyntaxError message embeds a window of the raw body.
        writeError(res, 400, 'invalid_json')
        return
      }
    } else {
      req.resume()
    }

    const query: Record<string, string> = {}
    for (const [k, v] of url.searchParams) query[k] = v

    // The ONE boundary for this request: params, query and body are each parsed by the command's
    // OWN schemas, and the first failure answers 400 with the issue PATH — never the value.
    const parsedParams = command.params.safeParse(params)
    const parsedQuery = command.query.safeParse(query)
    const parsedBody =
      command.body === null
        ? { success: true as const, data: undefined }
        : command.body.safeParse(bodyRaw)
    const miss = !parsedParams.success
      ? parsedParams.error
      : !parsedQuery.success
        ? parsedQuery.error
        : !parsedBody.success
          ? parsedBody.error
          : null
    if (miss !== null) {
      const issue = miss.issues[0]
      const path = (issue?.path ?? []).map(String).join('.') || '(root)'
      log(`[claude-watcher][api] code=invalid_request route=${command.id} path=${path}`)
      writeError(res, 400, 'invalid_request', path)
      return
    }
    const input = { params: parsedParams.data, query: parsedQuery.data, body: parsedBody.data }

    try {
      // DISPATCH POLICY, stated once so an oddly-shaped command has exactly one answer:
      //   - `stream` WINS whenever it is present. A command declaring BOTH is served as SSE.
      //   - a command with NEITHER is a programming error, not a caller error: 500 `internal` +
      //     `code=command_misconfigured`. So is a `handler` whose `output` is the SSE marker —
      //     there would be no schema to validate its body against.
      if (command.stream !== undefined) {
        // The cap counts STARTED sinks, so a command that awaits before `sink.start()` leaves a
        // window where two requests both pass this check. Start first, then subscribe.
        if (openSinks.size >= maxStreams) {
          writeError(res, 503, 'too_many_streams')
          return
        }
        const sink = makeSink(res)
        const err = await command.stream(options.context, input, sink)
        if (err !== null) writeErr(res, err)
        return
      }
      if (command.handler === undefined || command.output === 'text/event-stream') {
        log(`[claude-watcher][api] code=command_misconfigured route=${command.id}`)
        writeError(res, 500, 'internal')
        return
      }
      const result = await command.handler(options.context, input)
      if (!result.ok) {
        writeErr(res, result)
        return
      }
      // Validate AT SOURCE: a response that does not match its documented schema is never
      // written. The projection is `.strict()`, so this is also what keeps content off the wire.
      const out = command.output.safeParse(result.body)
      if (!out.success) {
        const issue = out.error.issues[0]
        const path = (issue?.path ?? []).map(String).join('.') || '(root)'
        log(`[claude-watcher][api] code=invalid_output route=${command.id} path=${path}`)
        writeError(res, 500, 'internal')
        return
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out.data))
    } catch {
      // The thrown value is DROPPED, never logged: an Error from a handler can carry a session
      // name, a path, or whatever the seam put in its message.
      log(`[claude-watcher][api] code=handler_threw route=${command.id}`)
      if (!res.writableEnded) writeError(res, 500, 'internal')
    }
  }

  const server = createServer((req, res) => {
    dispatch(req, res).catch(() => {
      log('[claude-watcher][api] code=dispatch_failed')
      if (!res.writableEnded) writeError(res, 500, 'internal')
    })
  })
  // A bind failure is LOGGED, never swallowed (the one place this diverges from the hook
  // server's silent EADDRINUSE tolerance): an API that bound nothing while the operator was
  // told it was listening is unsupportable. `err.code` is an errno string, not a value.
  server.on('error', (err: NodeJS.ErrnoException) => {
    log(`[claude-watcher][api] code=listen_failed errno=${err.code ?? 'unknown'}`)
  })
  server.listen(options.port ?? API_DEFAULT_PORT, options.host ?? API_HOST, () => {
    const addr = server.address()
    options.onListening?.(
      typeof addr === 'object' && addr !== null ? addr.port : (options.port ?? API_DEFAULT_PORT)
    )
  })

  return {
    close() {
      // End every open stream FIRST: `server.close()` waits for live connections, and an SSE
      // socket never finishes on its own — the process would not exit.
      for (const s of [...openSinks]) s.end()
      server.close()
      server.closeAllConnections()
    },
    streams: () => openSinks.size
  }
}
