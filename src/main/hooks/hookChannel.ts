// The hook channel: who may post hooks, a bridge mod report or a prompt origin, and for which
// session (threat model T-D13).
//
// A session id alone is no credential: it is on claude's argv (`--session-id`), so any other OS
// user can read it from /proc. So each spawn gets one random secret (64 lowercase hex), carried in
// the URL PATH claude and the bridge mod post to: hooks `http://127.0.0.1:<port>/h/<token>/` (in
// the session's private `--settings` file, `hookSettingsFile.ts`), the mod
// `CLAUDE_WATCHER_MOD_URL=http://127.0.0.1:<port>/h/<token>/mod/report` (env, never argv; the mod
// cuts `/mod/report` to reach `/mod/prompt` under the same token). Probed on claude 2.1.331: an
// http hook keeps the URL's path as written.
//
// The listener (`hookServer.ts`) answers a path that names no live token 401 before the body is
// read, and a body that names a live session other than the token's own 403 (`channelAllows`).
// The store is `mcp/sessionTokens.ts` (sha256 + `timingSafeEqual`, memory only, never logged),
// one for the app: a `/clear` moves the grant to the new id and a removed card revokes it
// (`window/cardState.ts`). Never log a token or a URL that holds one.
import { createSessionTokens, type SessionTokens } from '../mcp/sessionTokens'
import { HOST } from './hookContract'

/** Every channel path starts here: `/h/<token>` then the route. */
export const HOOK_CHANNEL_PREFIX = '/h/'

/** The session a channel token speaks for. */
export interface HookGrant {
  sessionId: string
}

export type HookChannel = SessionTokens<HookGrant>

/** The app's one channel store (hook servers are per window; a token works on any of them). */
export function createHookChannel(randomHex?: () => string): HookChannel {
  return createSessionTokens<HookGrant>(randomHex)
}

const CHANNEL_PATH = /^\/h\/([0-9a-f]{64})(\/.*)?$/

/** A request path (query already stripped) split into its token and the route after it (`/` when
 *  none), or null when it is not a channel path. */
export function parseChannelPath(path: string): { token: string; route: string } | null {
  const m = CHANNEL_PATH.exec(path)
  const token = m?.[1]
  if (token === undefined) return null
  return { token, route: m?.[2] ?? '/' }
}

/** `http://127.0.0.1:<port>/h/<token>`: hooks post to it plus `/`, the mod to it plus
 *  `MOD_REPORT_PATH`. */
export function hookChannelBase(port: number, token: string): string {
  return `http://${HOST}:${port}${HOOK_CHANNEL_PREFIX}${token}`
}

/**
 * May a request under the token granted to `grantId` act for `claimedId`? Its own id, yes; a live
 * session's that is not its own, no. An id no card holds is let through: that is how a `/clear`
 * works, since the new id's first hook arrives under the old token before the rebind, and an id
 * nobody holds reaches nothing (an unknown-id hook is a no-op, a report or origin for it is 409).
 */
export function channelAllows(
  grantId: string,
  claimedId: string,
  isLive: (sessionId: string) => boolean
): boolean {
  return claimedId === grantId || !isLive(claimedId)
}
