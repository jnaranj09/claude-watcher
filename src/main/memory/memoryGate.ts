// The gate every memory call from a session passes first (the memory tools, and the recall routes
// of phase 3): memory on, the store open and the session live, else null. Its scope is the
// session's workspace plus global items: no caller takes a workspace id. Pure; logs nothing.
import type { MemoryItem } from '../../shared/schemas/memory'
import type { MemoryScope, MemoryStore } from './memoryStore'
import type { MemoryGrant, MemorySessionMeta } from './memoryTools'

/** What one call works with once the gate passed. */
export interface MemoryCall {
  store: MemoryStore
  sessionId: string
  session: MemorySessionMeta
  scope: MemoryScope
}

export function createMemoryGate(deps: {
  enabled: () => boolean
  store: () => MemoryStore | null
  /** null = not a live session. */
  session: (sessionId: string) => MemorySessionMeta | null
}): (grant: MemoryGrant) => MemoryCall | null {
  return (grant) => {
    if (!deps.enabled()) return null
    const store = deps.store()
    const session = deps.session(grant.sessionId)
    if (store === null || session === null) return null
    return {
      store,
      sessionId: grant.sessionId,
      session,
      scope: { workspaceId: session.workspaceId, includeGlobal: true }
    }
  }
}

/** The metadata main stamps on an item a session saves: an empty folder or name is none. */
export function sessionItemMeta(session: MemorySessionMeta): MemoryItem['meta'] {
  return {
    folder: session.folder === '' ? null : session.folder,
    sessionName: session.sessionName === '' ? null : session.sessionName,
    tagIds: [...session.tagIds],
    templateId: session.templateId,
    goalId: session.goalId,
    taskIds: [...session.taskIds]
  }
}
