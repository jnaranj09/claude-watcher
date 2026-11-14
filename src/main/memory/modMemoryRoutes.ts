// The `watcher-memory` mod's four routes on the hook listener (memory phase 3 addendum §3), one per
// `MOD_MEMORY_PATHS` value, each behind the memory bearer (the same tokens as `/mcp/memory`). The
// grant comes from the token only: no body field names a session. Each body passes one fail-closed
// `.strict()` schema (`shared/schemas/modMemory.ts`); a failure answers 400 with the first issue's
// path and code, which the hook server logs. Bodies carry prompt text and answers carry memory
// text: nothing of either is logged here, only a route's name and a `code=`.
import type { z } from 'zod'
import {
  ModMemoryAtUseSchema,
  ModMemoryIndexSchema,
  ModMemoryRecallSchema,
  ModMemoryRememberSchema
} from '../../shared/schemas/modMemory'
import { MOD_MEMORY_PATHS } from '../hooks/hookContract'
import type { TokenRoute, TokenRouteAnswer } from '../hooks/hookServer'
import { bearerToken, type SessionTokens } from '../mcp/sessionTokens'
import type { MemoryRecall } from './memoryRecall'
import type { MemoryGrant } from './memoryTools'

const LOG_PREFIX = '[claude-watcher][memory]'
/** A handler that took longer than this is logged (`mod_memory_slow`): the mod waits at most
 *  250 ms for recall and at use. */
const SLOW_MS = 250

export function modMemoryRoutes(deps: {
  tokens: Pick<SessionTokens<MemoryGrant>, 'resolve'>
  recall: MemoryRecall
  now: () => number
  log: (line: string) => void
}): TokenRoute[] {
  function route<S extends z.ZodType>(
    path: string,
    name: string,
    schema: S,
    call: (grant: MemoryGrant, req: z.infer<S>) => Record<string, unknown>
  ): TokenRoute {
    return {
      path,
      open(authorization) {
        const token = bearerToken(authorization)
        const grant = token === null ? null : deps.tokens.resolve(token)
        if (grant === null) return null
        return (body): TokenRouteAnswer => {
          const started = deps.now()
          const parsed = schema.safeParse(body)
          if (!parsed.success) {
            const issue = parsed.error.issues[0]
            return {
              status: 400,
              path: (issue?.path ?? []).map(String).join('.') || '(root)',
              code: issue?.code ?? 'invalid'
            }
          }
          const answer = call(grant, parsed.data)
          if (deps.now() - started > SLOW_MS) {
            deps.log(`${LOG_PREFIX} route=mod_memory name=${name} code=mod_memory_slow`)
          }
          return { status: 200, body: answer }
        }
      },
      log: (line) => deps.log(`${LOG_PREFIX} ${line}`)
    }
  }

  const { recall } = deps
  return [
    route(MOD_MEMORY_PATHS.index, 'index', ModMemoryIndexSchema, (g, r) => recall.index(g, r)),
    route(MOD_MEMORY_PATHS.recall, 'recall', ModMemoryRecallSchema, (g, r) => recall.recall(g, r)),
    route(MOD_MEMORY_PATHS.atUse, 'at_use', ModMemoryAtUseSchema, (g, r) => recall.atUse(g, r)),
    route(MOD_MEMORY_PATHS.remember, 'remember', ModMemoryRememberSchema, (g, r) =>
      recall.remember(g, r)
    )
  ]
}
