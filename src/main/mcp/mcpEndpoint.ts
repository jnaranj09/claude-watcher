// An MCP endpoint of the app (spec 2026-10-19 goals, Claude integration): MCP's Streamable HTTP
// transport, stateless and POST-only, served on the hook listener at its route's path (the goals
// server at `GOALS_MCP_PATH`). `hooks/hookServer.ts` owns the Origin check, the body cap and the
// 401, through the `McpRoute` built here. A GET is answered 405 there, which the transport allows
// for a server that never streams. Each server brings its own tools, token store, server name and
// log area; the JSON-RPC handling is shared.
//
// What claude 2.1.304 sends (probed in the drive profile): first `server/discover` (answered
// -32601, after which claude falls back), then `initialize` with protocolVersion `2025-11-25`,
// `notifications/initialized`, a GET (405), `tools/list`, then `tools/call`. Every request carries
// `Authorization: Bearer <token>` from the `--mcp-config` file's `headers`, and no `Origin`.
//
// The body passes one fail-closed Zod boundary (`-32600`); params pass the tool's own (`-32602`).
// Logs carry `[claude-watcher][<area>] route=mcp`, the rpc method when it is one we serve (else
// `other`), and a `code=`: never a token, a header value, a tool's arguments or its result.
import { z } from 'zod'
import { GOALS_MCP_PATH, MEMORY_MCP_PATH } from '../hooks/hookContract'
import { bearerToken } from './sessionTokens'

/** Newest first; an unknown requested version gets the first. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
const SERVED_METHODS = ['initialize', 'ping', 'tools/list', 'tools/call'] as const
/** What an error result with no `code` logs: never its text. */
const TOOL_ERROR = 'tool_error'

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  // Absent = a notification. MCP forbids a null id.
  id: z.union([z.string().max(200), z.number().int()]).optional(),
  method: z.string().max(200),
  params: z.unknown().optional()
})

const InitializeParamsSchema = z.object({ protocolVersion: z.string().max(50) })
const ToolsCallParamsSchema = z.object({
  name: z.string().max(200),
  arguments: z.unknown().optional()
})

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpToolOutcome =
  /** `code` (errors only) is what the endpoint logs; the text is never logged. Omitted = the
   *  endpoint logs `tool_error`. */
  | { kind: 'result'; text: string; isError: boolean; code?: string }
  /** An unknown tool for this grant, or arguments that fail the schema. */
  | { kind: 'invalid_params' }

/** One server's tools: what a grant may list and call. */
export interface McpTools<G> {
  list(grant: G): readonly McpToolDef[]
  call(name: string, args: unknown, grant: G): McpToolOutcome
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number; result: Record<string, unknown> }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const ERRORS = {
  invalidRequest: { code: -32600, message: 'Invalid Request' },
  methodNotFound: { code: -32601, message: 'Method not found' },
  invalidParams: { code: -32602, message: 'Invalid params' }
} as const

/** What one request came to, for the log line. */
interface Answer {
  response: JsonRpcResponse | null
  method: string
  code: string
}

function answer<G>(body: unknown, grant: G, tools: McpTools<G>, serverName: string): Answer {
  const req = JsonRpcRequestSchema.safeParse(body)
  if (!req.success) {
    const response = { jsonrpc: '2.0' as const, id: null, error: ERRORS.invalidRequest }
    return { response, method: 'other', code: 'invalid_request' }
  }
  const { id, method, params } = req.data
  const served = SERVED_METHODS.find((m) => m === method)
  const logMethod = served ?? (method.startsWith('notifications/') ? 'notification' : 'other')
  // A notification never gets a response (the transport answers 202).
  if (id === undefined) return { response: null, method: logMethod, code: 'ok' }
  const ok = (result: Record<string, unknown>): Answer => ({
    response: { jsonrpc: '2.0', id, result },
    method: logMethod,
    code: 'ok'
  })
  const fail = (error: { code: number; message: string }, code: string): Answer => ({
    response: { jsonrpc: '2.0', id, error },
    method: logMethod,
    code
  })

  switch (served) {
    case 'initialize': {
      const p = InitializeParamsSchema.safeParse(params)
      if (!p.success) return fail(ERRORS.invalidParams, 'invalid_params')
      const version =
        SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === p.data.protocolVersion) ??
        SUPPORTED_PROTOCOL_VERSIONS[0]
      return ok({
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: '1' }
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: tools.list(grant) })
    case 'tools/call': {
      const p = ToolsCallParamsSchema.safeParse(params)
      if (!p.success) return fail(ERRORS.invalidParams, 'invalid_params')
      const outcome = tools.call(p.data.name, p.data.arguments, grant)
      if (outcome.kind === 'invalid_params') return fail(ERRORS.invalidParams, 'invalid_params')
      const result = { content: [{ type: 'text', text: outcome.text }] }
      return {
        response: {
          jsonrpc: '2.0',
          id,
          result: outcome.isError ? { ...result, isError: true } : result
        },
        method: logMethod,
        // An error logs its `code`, or `tool_error` when it has none. A result's text is never
        // logged, error or not: it can carry operator or memory text, or model input echoed
        // back (an id), with line breaks that would forge log lines. `ok` stands for a success.
        code: outcome.isError ? (outcome.code ?? TOOL_ERROR) : 'ok'
      }
    }
    case undefined:
      return fail(ERRORS.methodNotFound, 'method_not_found')
  }
}

/** One JSON-RPC message for `grant`; null for a notification (no response body). */
export function handleMcpRequest<G>(
  body: unknown,
  grant: G,
  tools: McpTools<G>,
  serverName: string
): JsonRpcResponse | null {
  return answer(body, grant, tools, serverName).response
}

export interface McpEndpoint<G> {
  /** The log area its lines carry (`[claude-watcher][<area>]`); its route's lines carry it too. */
  readonly area: string
  /** The grant of an `Authorization: Bearer <token>` header value, or null. */
  resolve(authorization: string | undefined): G | null
  handle(body: unknown, grant: G): JsonRpcResponse | null
}

export function createMcpEndpoint<G>(deps: {
  tokens: { resolve(token: string): G | null }
  tools: McpTools<G>
  /** `serverInfo.name`: the server key of its `--mcp-config` file. */
  serverName: string
  /** The log prefix: `[claude-watcher][<area>]`. */
  area: string
  log: (line: string) => void
}): McpEndpoint<G> {
  return {
    area: deps.area,
    resolve(authorization) {
      const token = bearerToken(authorization)
      return token === null ? null : deps.tokens.resolve(token)
    },
    handle(body, grant) {
      const a = answer(body, grant, deps.tools, deps.serverName)
      // Every tool call and every refusal; the handshake's successes stay quiet.
      if (a.method === 'tools/call' || a.code !== 'ok') {
        deps.log(`[claude-watcher][${deps.area}] route=mcp method=${a.method} code=${a.code}`)
      }
      return a.response
    }
  }
}

/** What the hook server needs, with the grant type hidden. `open` is null on a bearer miss. */
export interface McpRoute {
  path: string
  /** The bearer's handler, or null when it is not a live token of this route's server. The hook
   *  server opens it before the body is read, and again when the body has ended. */
  open(authorization: string | undefined): ((body: unknown) => JsonRpcResponse | null) | null
  /** A `route=mcp code=<code>` line; the route adds its server's `[claude-watcher][<area>]`. */
  log(line: string): void
}

/** The hook server's route for `endpoint` at `path`, logging through `log`. The app builds its
 *  routes through `appMcpRoutes`; the export is kept for this function's own tests. */
export function mcpRoute<G>(
  path: string,
  endpoint: McpEndpoint<G>,
  log: (line: string) => void
): McpRoute {
  return {
    path,
    open(authorization) {
      const grant = endpoint.resolve(authorization)
      if (grant === null) return null
      return (body) => endpoint.handle(body, grant)
    },
    log: (line) => log(`[claude-watcher][${endpoint.area}] ${line}`)
  }
}

/** Every MCP route the hook listener serves: the goals server, then the memory server, each behind
 *  its own bearer tokens (a bearer of one never opens the other). */
export function appMcpRoutes<G, M>(
  endpoints: { goals: McpEndpoint<G>; memory: McpEndpoint<M> },
  log: (line: string) => void
): McpRoute[] {
  return [
    mcpRoute(GOALS_MCP_PATH, endpoints.goals, log),
    mcpRoute(MEMORY_MCP_PATH, endpoints.memory, log)
  ]
}
