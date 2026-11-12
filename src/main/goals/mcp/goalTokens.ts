// The MCP bearer tokens of sessions started from goal tasks (spec 2026-10-19 goals, Decisions).
//
// Built on the app's session token store (`mcp/sessionTokens.ts`: one token per launch, memory
// only, a sha256 digest compared with `timingSafeEqual`, never logged). The grant says which
// session calls and in which mode; the goals endpoint (`mcp/mcpEndpoint.ts`) resolves it on every
// request. On top of the store it remembers, for the whole run, which sessions got
// `mark_task_done`.
import { createSessionTokens, type SessionTokens } from '../../mcp/sessionTokens'

export type Grant =
  | { sessionId: string; workspaceId: string; mode: 'worker' }
  | { sessionId: string; workspaceId: string; mode: 'planner'; goalId: string }

export interface GoalTokens extends SessionTokens<Grant> {
  /** Whether this session was given `mark_task_done` in this run, revoked or not: a resume of it
   *  in the same run gets the tool again. */
  markDoneFor(sessionId: string): boolean
}

export function createGoalTokens(randomHex?: () => string): GoalTokens {
  const tokens = createSessionTokens<Grant>(randomHex)
  // Kept for the whole run (memory only) ON PURPOSE: it outlives `revoke` so the archive and the
  // live record can still ask "could this session mark tasks done?" after the token is dropped.
  const markDone = new Set<string>()

  return {
    mint(grant) {
      const token = tokens.mint(grant)
      if (grant.mode === 'worker') markDone.add(grant.sessionId)
      return token
    },
    resolve: (token) => tokens.resolve(token),
    rebind(oldSessionId, newSessionId) {
      tokens.rebind(oldSessionId, newSessionId)
      if (oldSessionId === newSessionId) return
      if (markDone.delete(oldSessionId)) markDone.add(newSessionId)
    },
    revoke: (sessionId) => tokens.revoke(sessionId),
    markDoneFor(sessionId) {
      return markDone.has(sessionId)
    }
  }
}
