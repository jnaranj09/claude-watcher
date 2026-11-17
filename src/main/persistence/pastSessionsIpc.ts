// The past-sessions IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input.
// The `open` handler lives in pty/pastSessionOpen.ts (it needs the launch service and the
// reducer); index.ts only binds channels.
import {
  PastSessionForgetSchema,
  PastSessionSetTagsSchema,
  type PastSession
} from '../../shared/schemas/pastSession'
import type { PastSessionsStore } from './pastSessions'
import type { TagsStore } from './tags'
import { parseSessionSetTags } from './tagsIpc'

export interface PastSessionsIpcHandlers {
  list(): PastSession[]
  forget(raw: unknown): PastSession[]
  /** Refuses `not_found` (no listed record), `tag_not_found`, `tag_out_of_scope` (a tag the
   *  record's workspace cannot see) and `store_write_failed`. */
  setTags(raw: unknown): PastSession[]
}

export function createPastSessionsIpcHandlers(
  store: PastSessionsStore,
  tags: TagsStore
): PastSessionsIpcHandlers {
  return {
    list: () => store.list(),
    forget: (raw) => store.remove(PastSessionForgetSchema.parse(raw).id),
    setTags: (raw) => {
      const { id, tagIds } = PastSessionSetTagsSchema.parse(raw)
      const record = store.get(id)
      if (record === null || record.live === true) throw new Error('not_found')
      const req = parseSessionSetTags(tags, { sessionId: id, tagIds }, () => record.workspaceId)
      return store.setTags(id, req.tagIds)
    }
  }
}
