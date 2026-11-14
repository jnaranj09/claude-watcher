// The bearer tokens of the app's MCP servers (spec 2026-10-19 goals, Decisions; the goals server's
// `goals/mcp/goalTokens.ts` is built on this). Each server keeps its own store.
//
// One token per session, minted by main at spawn and kept in memory only: a restart drops every
// token, and a resumed session gets a fresh one. The token says which session calls (the grant);
// the server's endpoint (`mcpEndpoint.ts`) resolves it on every request. Only a sha256 digest is
// kept, compared with `timingSafeEqual` (as the API's bearer check does, `api/apiServer.ts`), over
// every live grant so the time does not say which one matched. Never logged.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface SessionTokens<G extends { sessionId: string }> {
  /** A fresh token for `grant.sessionId`, replacing any token that session had. */
  mint(grant: G): string
  /** The grant a token carries, or null for any token that is not live. */
  resolve(token: string): G | null
  /** `/clear` gave the session a new id: its token now calls as `newSessionId`. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: its token stops working. */
  revoke(sessionId: string): void
}

/** The token of an `Authorization: Bearer <token>` header value, or null. The MCP endpoints
 *  (`mcpEndpoint.ts`) and the memory mod's routes (`memory/modMemoryRoutes.ts`) read it here. */
export function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length)
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

export function createSessionTokens<G extends { sessionId: string }>(
  randomHex: () => string = () => randomBytes(32).toString('hex')
): SessionTokens<G> {
  const grants = new Map<string, { digest: Buffer; grant: G }>()

  return {
    mint(grant) {
      const token = randomHex()
      grants.set(grant.sessionId, { digest: sha256(token), grant })
      return token
    },
    resolve(token) {
      const digest = sha256(token)
      let found: G | null = null
      for (const entry of grants.values()) {
        if (timingSafeEqual(digest, entry.digest)) found = entry.grant
      }
      return found
    },
    rebind(oldSessionId, newSessionId) {
      if (oldSessionId === newSessionId) return
      const entry = grants.get(oldSessionId)
      if (entry === undefined) return
      grants.delete(oldSessionId)
      grants.set(newSessionId, {
        digest: entry.digest,
        grant: { ...entry.grant, sessionId: newSessionId }
      })
    },
    revoke(sessionId) {
      grants.delete(sessionId)
    }
  }
}
