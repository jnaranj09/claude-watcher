// The MCP bearer tokens of sessions started from goal tasks (spec 2026-10-19 goals, Decisions).
//
// One token per launch, minted by main at spawn and kept in memory only: a restart drops every
// token, and a resumed session gets a fresh one. The token says which session calls and in which
// mode; the MCP endpoint (`mcpEndpoint.ts`) resolves it on every request. Only a sha256 digest is
// kept, compared with `timingSafeEqual` (as the API's bearer check does, `api/apiServer.ts`), over
// every live grant so the time does not say which one matched. Never logged.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type Grant =
  | { sessionId: string; workspaceId: string; mode: 'worker' }
  | { sessionId: string; workspaceId: string; mode: 'planner'; goalId: string }

export interface GoalTokens {
  /** A fresh token for `grant.sessionId`, replacing any token that session had. */
  mint(grant: Grant): string
  /** The grant a token carries, or null for any token that is not live. */
  resolve(token: string): Grant | null
  /** `/clear` gave the session a new id: its token now calls as `newSessionId`. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: its token stops working. */
  revoke(sessionId: string): void
  /** Whether this session was given `mark_task_done` in this run, revoked or not: a resume of it
   *  in the same run gets the tool again. */
  markDoneFor(sessionId: string): boolean
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

export function createGoalTokens(
  randomHex: () => string = () => randomBytes(32).toString('hex')
): GoalTokens {
  const grants = new Map<string, { digest: Buffer; grant: Grant }>()
  const markDone = new Set<string>()

  return {
    mint(grant) {
      const token = randomHex()
      grants.set(grant.sessionId, { digest: sha256(token), grant })
      if (grant.mode === 'worker') markDone.add(grant.sessionId)
      return token
    },
    resolve(token) {
      const digest = sha256(token)
      let found: Grant | null = null
      for (const entry of grants.values()) {
        if (timingSafeEqual(digest, entry.digest)) found = entry.grant
      }
      return found
    },
    rebind(oldSessionId, newSessionId) {
      if (oldSessionId === newSessionId) return
      const entry = grants.get(oldSessionId)
      if (entry !== undefined) {
        grants.delete(oldSessionId)
        grants.set(newSessionId, {
          digest: entry.digest,
          grant: { ...entry.grant, sessionId: newSessionId }
        })
      }
      if (markDone.delete(oldSessionId)) markDone.add(newSessionId)
    },
    revoke(sessionId) {
      grants.delete(sessionId)
    },
    markDoneFor(sessionId) {
      return markDone.has(sessionId)
    }
  }
}
