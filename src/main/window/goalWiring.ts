// The two places watchFeed.ts hands the goals wiring to code that has no Electron in it, moved out
// so a dropped argument turns a test red (maintainability rule 6b), as `cardState.ts` does for the
// card's own state.
import type { Session } from '../../shared/schemas/session'
import type { RemovalReason } from '../pty/launchRemoval'
import { applyRemovalReason, type PastSessionsWriteSeam } from '../persistence/pastSessionRecord'
import type { GoalTokens } from '../goals/mcp/goalTokens'
import type { McpEndpoint } from '../goals/mcp/mcpEndpoint'

/** The removal chokepoint's history write: an archive records whether the session had
 *  `mark_task_done` this run (`tokens.markDoneFor`), so a Resume after a restart can grant it. */
export function recordRemoval(
  deps: {
    pastSessions: PastSessionsWriteSeam | null
    tokens: Pick<GoalTokens, 'markDoneFor'>
    now: () => number
  },
  reason: RemovalReason,
  sessionId: string,
  stored: Session | undefined
): void {
  applyRemovalReason(reason, sessionId, stored, deps.pastSessions, deps.now(), (id) =>
    deps.tokens.markDoneFor(id)
  )
}

/** The `mcp` option of `createHookServer`: the goals endpoint, logging through `log`. */
export function hookServerMcp(
  endpoint: McpEndpoint,
  log: (line: string) => void
): { mcp: McpEndpoint & { log: (line: string) => void } } {
  return { mcp: { ...endpoint, log } }
}
