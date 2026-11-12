// The place watchFeed.ts hands the goals wiring to code that has no Electron in it, moved out so a
// dropped argument turns a test red (maintainability rule 6b), as `cardState.ts` does for the
// card's own state. (The hook server's goals route is `mcpRoute`, `mcp/mcpEndpoint.ts`.)
import type { Session } from '../../shared/schemas/session'
import type { RemovalReason } from '../pty/launchRemoval'
import { applyRemovalReason, type PastSessionsWriteSeam } from '../persistence/pastSessionRecord'
import type { GoalTokens } from '../goals/mcp/goalTokens'

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
