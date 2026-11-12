// What a launched card carries beside the reducer: its pending rename (pendingTitles.ts), its
// Context setup (mods/sessionSetup.ts), and for a session started from goal tasks its task links,
// MCP token and `--mcp-config` file (goals/), and for a planner its proposal (goals/proposals.ts),
// and with memory on its memory token, config file and activity record, and the origin of the
// items it saved (memory/). All of it follows the card when a `/clear` re-keys it. When the card is
// removed, the rename, the setup, the tokens, the proposal, the files and the activity go; the
// task links and the memory items stay (spec 2026-10-19 goals: a link to a gone session is hidden,
// not dropped; spec 2026-11-11 memory: an item outlives its session). A seam moved out of
// watchFeed.ts so the pairing is tested.
import type { PendingTitles } from '../hooks/pendingTitles'
import type { SessionSetup } from '../mods/sessionSetup'
import type { GoalsStore } from '../persistence/goals'
import type { GoalTokens } from '../goals/mcp/goalTokens'
import type { McpConfigs } from '../goals/mcp/mcpConfigFile'
import type { Proposals } from '../goals/proposals'
import type { SessionTokens } from '../mcp/sessionTokens'
import type { MemoryActivityLog } from '../memory/memoryActivity'
import { memoryStep } from '../memory/memoryLaunch'
import type { MemoryStore } from '../memory/memoryStore'
import type { MemoryGrant } from '../memory/memoryTools'

interface CardStateDeps {
  pendingTitles: Pick<PendingTitles, 'rebind' | 'forget'>
  sessionSetup: Pick<SessionSetup, 'rebind' | 'forget'>
  /** null before app-ready (no card exists then). */
  goals: Pick<GoalsStore, 'rebindSession'> | null
  tokens: Pick<GoalTokens, 'rebind' | 'revoke'>
  proposals: Pick<Proposals, 'rebind' | 'clear'>
  mcpConfigs: Pick<McpConfigs, 'rebind' | 'remove'>
  memoryTokens: Pick<SessionTokens<MemoryGrant>, 'rebind' | 'revoke'>
  memoryConfigs: Pick<McpConfigs, 'rebind' | 'remove'>
  memoryActivity: Pick<MemoryActivityLog, 'rebind' | 'forget'>
  /** null while memory is off (database not open, SMOKE, quitting). */
  memoryStore: Pick<MemoryStore, 'rebindSession'> | null
  /** Code-only log sink (a memory failure here never stops the card's own step). */
  log: (line: string) => void
}

export function moveCardState(deps: CardStateDeps, oldId: string, newId: string): void {
  deps.pendingTitles.rebind(oldId, newId)
  deps.sessionSetup.rebind(oldId, newId)
  // The same claude keeps its loaded MCP configs: its tokens and files now belong to the new id,
  // and its tasks follow, so the card line, `mark_task_done` and the memory tools keep working.
  deps.goals?.rebindSession(oldId, newId)
  deps.tokens.rebind(oldId, newId)
  // A planner's proposal waits in the sheet under the planner's id: it follows too.
  deps.proposals.rebind(oldId, newId)
  deps.mcpConfigs.rebind(oldId, newId)
  deps.memoryTokens.rebind(oldId, newId)
  deps.memoryConfigs.rebind(oldId, newId)
  deps.memoryActivity.rebind(oldId, newId)
  // The items it saved name the new id. Last, and guarded: a database write that fails is logged
  // (and reported by the store), and the card has already moved.
  const store = deps.memoryStore
  memoryStep(deps.log, 'memory_rebind_failed', () => store?.rebindSession(oldId, newId))
}

export function dropCardState(deps: CardStateDeps, sessionId: string): void {
  deps.pendingTitles.forget(sessionId)
  deps.sessionSetup.forget(sessionId)
  deps.tokens.revoke(sessionId)
  // Proposals live while the planner card lives (spec, Model).
  deps.proposals.clear(sessionId)
  deps.mcpConfigs.remove(sessionId)
  deps.memoryTokens.revoke(sessionId)
  deps.memoryConfigs.remove(sessionId)
  deps.memoryActivity.forget(sessionId)
}
