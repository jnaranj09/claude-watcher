// The past-sessions IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input.
// The `open` handler lives in pty/pastSessionOpen.ts (it needs the launch service and the
// reducer); index.ts only binds channels.
import { PastSessionForgetSchema, type PastSession } from '../../shared/schemas/pastSession'
import type { PastSessionsStore } from './pastSessions'

export interface PastSessionsIpcHandlers {
  list(): PastSession[]
  forget(raw: unknown): PastSession[]
}

export function createPastSessionsIpcHandlers(store: PastSessionsStore): PastSessionsIpcHandlers {
  return {
    list: () => store.list(),
    forget: (raw) => store.remove(PastSessionForgetSchema.parse(raw).id)
  }
}
