// What a launched card carries beside the reducer: its pending rename (pendingTitles.ts), its
// Context setup (mods/sessionSetup.ts), and for a session started from goal tasks its task links,
// MCP token and `--mcp-config` file (goals/). All of it follows the card when a `/clear` re-keys
// it. When the card is removed, the rename, the setup, the token and the file go; the task links
// stay (spec 2026-10-19 goals: a link to a gone session is hidden, not dropped). A seam moved out
// of watchFeed.ts so the pairing is tested.
import type { PendingTitles } from '../hooks/pendingTitles'
import type { SessionSetup } from '../mods/sessionSetup'
import type { GoalsStore } from '../persistence/goals'
import type { GoalTokens } from '../goals/mcp/goalTokens'
import type { McpConfigs } from '../goals/mcp/mcpConfigFile'

interface CardStateDeps {
  pendingTitles: Pick<PendingTitles, 'rebind' | 'forget'>
  sessionSetup: Pick<SessionSetup, 'rebind' | 'forget'>
  /** null before app-ready (no card exists then). */
  goals: Pick<GoalsStore, 'rebindSession'> | null
  tokens: Pick<GoalTokens, 'rebind' | 'revoke'>
  mcpConfigs: Pick<McpConfigs, 'rebind' | 'remove'>
}

export function moveCardState(deps: CardStateDeps, oldId: string, newId: string): void {
  deps.pendingTitles.rebind(oldId, newId)
  deps.sessionSetup.rebind(oldId, newId)
  // The same claude keeps its loaded MCP config: its token and file now belong to the new id, and
  // its tasks follow, so the card line and `mark_task_done` keep working.
  deps.goals?.rebindSession(oldId, newId)
  deps.tokens.rebind(oldId, newId)
  deps.mcpConfigs.rebind(oldId, newId)
}

export function dropCardState(deps: CardStateDeps, sessionId: string): void {
  deps.pendingTitles.forget(sessionId)
  deps.sessionSetup.forget(sessionId)
  deps.tokens.revoke(sessionId)
  deps.mcpConfigs.remove(sessionId)
}
