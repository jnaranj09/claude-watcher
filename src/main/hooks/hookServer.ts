// Hook-status feature — the localhost HTTP listener that receives Claude Code hook POSTs.
//
// Binds to 127.0.0.1 only (never 0.0.0.0). Every inbound POST is validated at the
// fail-closed HookEventSchema boundary. On bad input: respond 400 + log PATH + CODE
// only — NEVER log the body (payloads carry prompt/tool_input/last_assistant_message).
//
// Body-size cap (MAX_BODY_BYTES): any request exceeding the cap is rejected 400.
// 'error' handler on the server tolerates EADDRINUSE (log + skip).
// Never throws past the request handler.
// [.claude/rules/zod-boundaries.md; spec hookServer.ts Code Map]

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { HookEventSchema, type HookEvent } from '../../shared/schemas/hookEvent'
import { HOST, PORT, MAX_BODY_BYTES } from './hookContract'
import type { BoundaryErrorRecord } from '../c9watch/reducer'

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
}

export interface HookServer {
  /** Shut down the listener. */
  close(): void
}

/**
 * Create and start the localhost HTTP hook listener.
 *
 * Handles POST requests to any path (Claude Code always POSTs to HOOK_URL). Any
 * non-POST method is rejected with 405 before the body is read. Per the spec, the
 * handler NEVER throws past the request callback.
 *
 * Returns `{ close() }` — call to shut down cleanly (e.g. on app quit).
 */
export function createHookServer(options: HookServerOptions): HookServer {
  const { onHookEvent } = options
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
