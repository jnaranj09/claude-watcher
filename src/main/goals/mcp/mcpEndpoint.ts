// The goals MCP endpoint (spec 2026-10-19 goals, Claude integration): MCP's Streamable HTTP
// transport, stateless and POST-only, served on the hook listener at `GOALS_MCP_PATH`
// (`hooks/hookServer.ts` owns the Origin check, the body cap and the 401). A GET is answered 405
// there, which the transport allows for a server that never streams.
//
// What claude 2.1.304 sends (probed in the drive profile): first `server/discover` (answered
// -32601, after which claude falls back), then `initialize` with protocolVersion `2025-11-25`,
// `notifications/initialized`, a GET (405), `tools/list`, then `tools/call`. Every request carries
// `Authorization: Bearer <token>` from the `--mcp-config` file's `headers`, and no `Origin`.
//
// The body passes one fail-closed Zod boundary (`-32600`); params pass the tool's own (`-32602`).
// Logs carry `route=mcp`, the rpc method when it is one we serve (else `other`), and a `code=`:
// never a token, a header value, a task id or a title.
import { z } from 'zod'
import { MCP_SERVER_NAME } from './mcpConfigFile'
import type { GoalTokens, Grant } from './goalTokens'
import type { McpTools } from './mcpTools'

/** Newest first; an unknown requested version gets the first. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
const SERVED_METHODS = ['initialize', 'ping', 'tools/list', 'tools/call'] as const

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

function answer(body: unknown, grant: Grant, tools: McpTools): Answer {
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
        serverInfo: { name: MCP_SERVER_NAME, version: '1' }
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
        // An error's text is a refusal code. A success's text can carry titles (`list_tasks`),
        // so it is never logged: `ok` stands for it.
        code: outcome.isError ? outcome.text : 'ok'
      }
    }
    case undefined:
      return fail(ERRORS.methodNotFound, 'method_not_found')
  }
}

/** One JSON-RPC message for `grant`; null for a notification (no response body). */
export function handleMcpRequest(
  body: unknown,
  grant: Grant,
  tools: McpTools
): JsonRpcResponse | null {
  return answer(body, grant, tools).response
}

export interface McpEndpoint {
  /** The grant of an `Authorization: Bearer <token>` header value, or null. */
  resolve(authorization: string | undefined): Grant | null
  handle(body: unknown, grant: Grant): JsonRpcResponse | null
}

export function createMcpEndpoint(deps: {
  tokens: Pick<GoalTokens, 'resolve'>
  tools: McpTools
  log: (line: string) => void
}): McpEndpoint {
  return {
    resolve(authorization) {
      if (authorization === undefined || !authorization.startsWith('Bearer ')) return null
      return deps.tokens.resolve(authorization.slice('Bearer '.length))
    },
    handle(body, grant) {
      const a = answer(body, grant, deps.tools)
      // Every tool call and every refusal; the handshake's successes stay quiet.
      if (a.method === 'tools/call' || a.code !== 'ok') {
        deps.log(`[claude-watcher][goals] route=mcp method=${a.method} code=${a.code}`)
      }
      return a.response
    }
  }
}
