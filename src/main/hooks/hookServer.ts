// Hook-status feature — the localhost HTTP listener that receives Claude Code hook POSTs.
//
// Binds to 127.0.0.1 only (never 0.0.0.0). Every inbound POST is validated at a fail-closed
// boundary: HookEventSchema, ModReportSchema on `/mod/report`, ModPromptSchema on `/mod/prompt`, or
// an MCP route's JSON-RPC schema (`/mcp/goals`). On bad input: respond 400 + log PATH + CODE
// only — NEVER log the body (payloads carry prompt/tool_input/last_assistant_message).
//
// Body-size cap (MAX_BODY_BYTES): any request exceeding the cap is rejected 400.
// A request carrying an `Origin` header (a browser) is rejected 403 before the body is read.
// 'error' handler on the server tolerates EADDRINUSE (log + skip).
// `/mod/report` carries the bridge mod's report (ModReportSchema), behind the same method, Origin
// and body-cap guards; `/mod/prompt` carries who sent each prompt (ModPromptSchema), behind the same
// guards. Each MCP route (`mcpRoutes`; the goals server at `/mcp/goals`, the memory server at `/mcp/memory`) is an app MCP endpoint
// behind the same guards plus its own bearer token (401 before the body is read;
// `mcp/mcpEndpoint.ts` parses the JSON-RPC body). A path under `/mcp/` with no route is 404. Every
// other path is a hook, as before.
// Never throws past the request handler.
// [.claude/rules/zod-boundaries.md; spec hookServer.ts Code Map]

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { HookEventSchema, type HookEvent } from '../../shared/schemas/hookEvent'
import { ModReportSchema, type ModReport } from '../../shared/schemas/modReport'
import { ModPromptSchema, type ModPrompt } from '../../shared/schemas/modPrompt'
import {
  HOST,
  PORT,
  MAX_BODY_BYTES,
  MOD_REPORT_PATH,
  MOD_PROMPT_PATH,
  MCP_PATH_PREFIX
} from './hookContract'
import { buildHookResponseBody } from './hookResponse'
import type { BoundaryErrorRecord } from '../c9watch/reducer'
import type { JsonRpcResponse, McpRoute } from '../mcp/mcpEndpoint'

export interface HookServerOptions {
  /** Called when a POST arrives with a valid, schema-parsed hook event. */
  onHookEvent: (evt: HookEvent) => void
  /** Boundary-error sink — receives PATH + CODE only, NEVER body content. */
  log?: (err: BoundaryErrorRecord) => void
  /** Override the bind port (default PORT). Tests pass 0 for an ephemeral port. */
  port?: number
  /** Override the bind host (default HOST). */
  host?: string
  /** Called once the server is listening, with the actually-bound port. */
  onListening?: (port: number) => void
  /** Called on a server-level error (a failed bind, `EADDRINUSE` included) with the errno CODE
   *  only. Main's server-health state reads it: SEC-6 withholds `--settings` and UX-05 shows a
   *  banner, so a port another process holds never fails silently. */
  onError?: (errno: string) => void
  /** Name-sync — read AND CLEAR this session's pending rename, or null when nothing is
   *  pending. Wired to `pendingTitles.take` in main. Optional: when absent the server keeps
   *  its historical always-empty-200 behaviour, so every existing test stays valid. */
  takePendingTitle?: (sessionId: string) => string | null
  /** The bridge mod's report (spec 2026-10-18 §2), schema-parsed; false when it was dropped (no
   *  live session has its id), answered 409 so the mod does not count it as sent and tries again
   *  after the next turn (a report can race a `/clear` adoption). Absent: `/mod/report` is parsed
   *  and answered 200, and nothing receives it. */
  onModReport?: (report: ModReport) => boolean
  /** Who sent a prompt (`prompt.submit`'s origin), schema-parsed; false when no live session has
   *  its id, answered 409 (the mod drops it: the next prompt sends its own). Absent: `/mod/prompt`
   *  is parsed and answered 200, and nothing receives it. */
  onModPrompt?: (prompt: ModPrompt) => boolean
  /** The app's MCP endpoints, one route per server (`mcp/mcpEndpoint.ts` `mcpRoute`; the goals
   *  server at `GOALS_MCP_PATH`, spec 2026-10-19 goals). A route's `log` gets a `code=` line only,
   *  never a header value. A path under `MCP_PATH_PREFIX` with no route is answered 404. */
  mcpRoutes?: readonly McpRoute[]
}

export interface HookServer {
  /** Shut down the listener. */
  close(): void
}

/**
 * Create and start the localhost HTTP hook listener.
 *
 * Handles POST requests to any path (Claude Code always POSTs to HOOK_URL); `/mod/report` is the
 * bridge mod's report, `/mod/prompt` its prompt origin, each `mcpRoutes` path an MCP endpoint, every other path a hook. Any
 * non-POST method is rejected with 405 before the body is read. Per the spec, the
 * handler NEVER throws past the request callback.
 *
 * Returns `{ close() }` — call to shut down cleanly (e.g. on app quit).
 */
export function createHookServer(options: HookServerOptions): HookServer {
  const { onHookEvent, takePendingTitle, onModReport, onModPrompt } = options
  const mcpRoutes = options.mcpRoutes ?? []
  const log =
    options.log ??
    ((err: BoundaryErrorRecord): void => {
      console.warn(`[c9watch][hooks] dropped hook path=${err.path} code=${err.code}`)
    })

  const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    // Only POST is accepted (Claude Code always POSTs to HOOK_URL). Reject any other
    // method with 405 BEFORE reading the body — a stray GET/health-check never reaches
    // the parser, and a non-POST carrying a valid body cannot fire onHookEvent.
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }

    // SEC-2 — a browser stamps `Origin` on every cross-origin POST, `no-cors` included, so any
    // web page the operator opens could otherwise post here. Claude's own hook POST carries no
    // `Origin` (probe 2026-09-28, claude 2.1.284: axios, no Origin/Referer). Refuse before the
    // body is read; log the CODE only — never the origin, it names the page.
    if (req.headers.origin !== undefined) {
      log({ path: '(request)', code: 'origin_rejected' })
      res.writeHead(403).end()
      return
    }

    // An MCP route: a live bearer token of THAT route's server or nothing, decided before the body
    // is read. A miss says nothing more than 401; the log carries the code only, never the header.
    const route = (req.url ?? '/').split('?')[0] ?? '/'
    const mcp = mcpRoutes.find((r) => r.path === route)
    if (mcp === undefined && route.startsWith(MCP_PATH_PREFIX)) {
      res.writeHead(404).end()
      return
    }
    if (mcp !== undefined && mcp.open(req.headers.authorization) === null) {
      mcp.log('route=mcp code=unauthorized')
      res.writeHead(401).end()
      return
    }

    // Collect the body with a size cap. We use a byte counter instead of Buffer
    // concatenation to detect oversized payloads early.
    const chunks: Buffer[] = []
    let totalBytes = 0
    let tooLarge = false

    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        tooLarge = true
        log({ path: '(body)', code: 'body_too_large' })
        res.writeHead(400).end()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (tooLarge) return // already responded

      // 1) JSON parse — value-free: a SyntaxError message can embed a window of the
      // raw body. We swallow the error and log by CODE only (never the body).
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        log({ path: '(body)', code: 'invalid_json' })
        res.writeHead(400).end()
        return
      }

      // An MCP route (authorized above): its own JSON-RPC boundary. The token is resolved AGAIN
      // now: a session removed (revoked) while the body arrived must not act, and a `/clear`
      // meanwhile means the grant now names the new id. A notification gets 202 and no body. A
      // throw costs this request only (never-crash).
      if (mcp !== undefined) {
        const live = mcp.open(req.headers.authorization)
        if (live === null) {
          mcp.log('route=mcp code=unauthorized')
          res.writeHead(401).end()
          return
        }
        let response: JsonRpcResponse | null
        try {
          response = live(parsed)
        } catch {
          mcp.log('route=mcp code=mcp_handler_error')
          res.writeHead(500).end()
          return
        }
        if (response === null) {
          res.writeHead(202).end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(response))
        return
      }

      // The bridge mod's report: its own boundary, same PATH + CODE-only log, an empty 200.
      if (route === MOD_REPORT_PATH) {
        const report = ModReportSchema.safeParse(parsed)
        if (!report.success) {
          const issue = report.error.issues[0]
          log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
          res.writeHead(400).end()
          return
        }
        let kept = true
        try {
          kept = onModReport?.(report.data) ?? true
        } catch {
          log({ path: '(mod_report)', code: 'mod_report_handler_error' })
        }
        res.writeHead(kept ? 200 : 409).end()
        return
      }

      // Who sent a prompt: its own boundary, same PATH + CODE-only log, an empty 200.
      if (route === MOD_PROMPT_PATH) {
        const prompt = ModPromptSchema.safeParse(parsed)
        if (!prompt.success) {
          const issue = prompt.error.issues[0]
          log({ path: (issue?.path ?? []).join('.') || '(root)', code: issue?.code ?? 'invalid' })
          res.writeHead(400).end()
          return
        }
        let kept = true
        try {
          kept = onModPrompt?.(prompt.data) ?? true
        } catch {
          log({ path: '(mod_prompt)', code: 'mod_prompt_handler_error' })
        }
        res.writeHead(kept ? 200 : 409).end()
        return
      }

      // 2) Zod boundary — fail-closed, PATH + CODE only, NEVER body content.
      const result = HookEventSchema.safeParse(parsed)
      if (!result.success) {
        const issue = result.error.issues[0]
        log({
          path: (issue?.path ?? []).join('.') || '(root)',
          code: issue?.code ?? 'invalid'
        })
        res.writeHead(400).end()
        return
      }

      // Valid event: invoke the consumer. Any exception from onHookEvent must not
      // crash the server — catch and log by code only (never the event content).
      try {
        onHookEvent(result.data)
      } catch {
        log({ path: '(hook)', code: 'hook_handler_error' })
      }

      // Name-sync — the one place this server writes a RESPONSE BODY. Claude reads it as
      // hook output, which is how a rename reaches a session that is already running.
      // `takePendingTitle` is read-and-clear (push once, never per prompt — see
      // pendingTitles.ts). Absent seam, or nothing pending, keeps the historical empty 200.
      //
      // NEVER-CRASH: a throw here must not cost every other session its ingest, so the
      // fallback is the same empty 200 the server has always sent. Log by CODE only — the
      // body carries an operator-typed name.
      // The title getter is passed LAZILY: `take` is read-and-clear, so only the event that
      // can actually deliver a rename may consume one. Eager consumption would let a Stop
      // swallow a pending rename that then goes nowhere (see hookResponse.ts).
      let body: string | null = null
      try {
        body = buildHookResponseBody(
          result.data.hook_event_name,
          () => takePendingTitle?.(result.data.session_id) ?? null
        )
      } catch {
        log({ path: '(response)', code: 'hook_response_error' })
        body = null
      }

      if (body !== null) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
        return
      }
      res.writeHead(200).end()
    })

    req.on('error', () => {
      // Request-level I/O error — log by code only, never throws.
      log({ path: '(request)', code: 'request_error' })
    })
  })

  // 'error' handler tolerates EADDRINUSE (log + skip, never crash).
  // A second window hit or a stale listener is non-fatal.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log({ path: '(server)', code: 'eaddrinuse' })
      // Do NOT throw — the spec says tolerate EADDRINUSE (log + skip).
    } else {
      log({ path: '(server)', code: err.code ?? 'server_error' })
    }
    options.onError?.(err.code ?? 'server_error')
  })

  // Bind to 127.0.0.1 only (never 0.0.0.0). port/host are injectable (tests bind port 0
  // for an ephemeral port); production passes neither, so it binds PORT/HOST.
  const bindPort = options.port ?? PORT
  const bindHost = options.host ?? HOST
  server.listen(bindPort, bindHost, () => {
    const addr = server.address()
    const actualPort = typeof addr === 'object' && addr !== null ? addr.port : bindPort
    options.onListening?.(actualPort)
  })

  return {
    close(): void {
      server.close()
    }
  }
}
