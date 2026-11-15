// The `watcher-memory` mod's side of the memory server (memory phase 3, ruling P3-C20): the recall
// service over the live gate, and the four `/mod/memory/*` routes each window's hook listener
// serves from it. `createMemoryMcp` (memoryLaunch.ts) builds it with the memory server's OWN token
// store, so a goals bearer never opens these routes, and no caller can hand it another store: the
// watch feed reads `memoryMcp.modRoutes` and `memoryMcp.recall`. The gate reads Memory, the store
// and the live session on every request, so `Memory` off answers the next request. `Memory
// recall` is not read here: it decides at spawn whether a session gets the mod at all (P3-C19).
import { OPERATOR_ORIGINS } from '../c9watch/reducer'
import type { TokenRoute } from '../hooks/hookServer'
import type { SessionTokens } from '../mcp/sessionTokens'
import type { GoalsStore } from '../persistence/goals'
import type { MemoryActivityLog } from './memoryActivity'
import { createMemoryGate } from './memoryGate'
import type { MemoryNames } from './memoryNames'
import { createMemoryRecall, type MemoryRecall } from './memoryRecall'
import type { MemoryStore } from './memoryStore'
import type { MemoryGrant, MemorySessionMeta } from './memoryTools'
import { modMemoryRoutes } from './modMemoryRoutes'

export interface ModMemory {
  /** What each session's conversation window was told; follows a card (window/cardState.ts). */
  recall: MemoryRecall
  /** The `/mod/memory/*` routes each window's hook listener serves (`tokenRoutes`). */
  modRoutes: readonly TokenRoute[]
}

export function createModMemory(deps: {
  /** The memory server's tokens: the same ones `/mcp/memory` reads. */
  tokens: Pick<SessionTokens<MemoryGrant>, 'resolve'>
  /** The `Memory` setting, read live. */
  enabled: () => boolean
  store: () => MemoryStore | null
  /** null = not a live session. */
  session: (sessionId: string) => MemorySessionMeta | null
  tasks: () => Pick<GoalsStore, 'view'> | null
  /** The goal and tag names the section's headings print. */
  names: Pick<MemoryNames, 'goalName' | 'tagName'>
  activity: Pick<MemoryActivityLog, 'injected' | 'record'>
  now: () => number
  log: (line: string) => void
}): ModMemory {
  const recall = createMemoryRecall({
    gate: createMemoryGate({ enabled: deps.enabled, store: deps.store, session: deps.session }),
    tasks: () => deps.tasks()?.view() ?? null,
    names: deps.names,
    activity: deps.activity,
    operatorOrigins: OPERATOR_ORIGINS,
    now: deps.now,
    log: deps.log
  })
  return {
    recall,
    modRoutes: modMemoryRoutes({ tokens: deps.tokens, recall, now: deps.now, log: deps.log })
  }
}
