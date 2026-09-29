// Programmatic API — the command registry. Every action is ONE object; the router (apiServer.ts)
// and the OpenAPI document (openapi.ts) are both generated from `apiCommands`, so adding an
// action is one file + one entry + one test. Handlers are declared with METHOD syntax on purpose:
// TypeScript checks methods bivariantly, which is what lets a concrete ApiCommand<{id:string},…>
// sit in a list typed AnyApiCommand.
import type { ZodType } from 'zod'
import type { ApiErrorCode } from '../../shared/schemas/api'
import type { TemplatesStore } from '../persistence/templates'
import type { WorkspacesStore } from '../persistence/workspaces'
import type { ApiSeam } from './apiSeam'

export type ApiOk<O> = { ok: true; status: 200 | 201; body: O }
export type ApiErr = {
  ok: false
  status: 400 | 401 | 404 | 405 | 409 | 500 | 503 | 504
  code: ApiErrorCode
  /** The Zod issue PATH that failed — never the value that failed it. */
  path?: string
}
export type ApiResult<O> = ApiOk<O> | ApiErr

/** The SSE side of a response, owned by the server so a command never touches the socket. */
export interface SseSink {
  start(): void
  send(event: string, data: unknown, id: number): void
  end(): void
  onClose(cb: () => void): void
}

/** Everything a command may reach. Narrow on purpose: a command gets `get`/`list` on the template
 *  store, not `save` — the API is not a second write path into the operator's own config. */
export interface ApiContext {
  seam(): ApiSeam | null
  templates: Pick<TemplatesStore, 'get' | 'list'>
  workspaces: Pick<WorkspacesStore, 'activeId' | 'get' | 'list'>
  claudeVersionAllowsLaunch(): boolean
  /** UX-11 — true iff `path` is an existing directory. Never throws; the path is never logged. */
  isDirectory(path: string): boolean
  /** SEC-6 — true only while THIS process's hook server is bound (`serverHealth.hookListening`).
   *  Without it a spawn gets no `--settings`, so a card could never move. */
  hooksListening(): boolean
  now(): number
  spawnTimeoutMs: number
  /** Code-only log sink. */
  log(message: string): void
}

export interface ApiInput<P, Q, B> {
  params: P
  query: Q
  body: B
}

export interface ApiCommand<P, Q, B, O> {
  id: string
  method: 'GET' | 'POST'
  /** `/v1/sessions/{id}/events` — `{name}` segments become `params`. */
  path: string
  summary: string
  description?: string
  params: ZodType<P>
  query: ZodType<Q>
  /** null for a GET (no body is read). */
  body: ZodType<B> | null
  /** The success body's schema, validated AT SOURCE before the write; or the SSE marker. */
  output: ZodType<O> | 'text/event-stream'
  successStatus: 200 | 201
  /** For the OpenAPI document: every error status this command can answer. */
  errorStatuses: readonly number[]
  handler?(ctx: ApiContext, input: ApiInput<P, Q, B>): Promise<ApiResult<O>>
  /** SSE: return an ApiErr BEFORE `sink.start()` to answer JSON, or null once streaming. */
  stream?(ctx: ApiContext, input: ApiInput<P, Q, B>, sink: SseSink): Promise<ApiErr | null>
}
export type AnyApiCommand = ApiCommand<unknown, unknown, unknown, unknown>

/**
 * The ONE place the command generics are erased, so the router can hold a heterogeneous list.
 * Nothing unchecked reaches a handler because of it: the router re-parses each request with that
 * command's OWN `params`/`query`/`body` schemas before calling it, and validates the result
 * against its `output` schema before writing — the cast loses the compiler's knowledge, not the
 * runtime's.
 *
 * The command LIST is deliberately NOT here — `apiCommands` lives in `commands/index.ts`, because
 * every command imports `defineCommand` from this file and a list beside it would close the cycle.
 */
export function defineCommand<P, Q, B, O>(command: ApiCommand<P, Q, B, O>): AnyApiCommand {
  return command as AnyApiCommand
}
