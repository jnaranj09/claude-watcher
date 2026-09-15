// The tags IPC handler BODIES, kept out of index.ts so they are unit-testable in node. Every arg is
// UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input (zod-boundaries.md
// IPC-arg row). index.ts only binds them to CH.* channels and routes to the owning window.
import {
  SessionSetTagsSchema,
  TagDeleteSchema,
  TagSaveSchema,
  type SessionSetTagsRequest,
  type Tag
} from '../../shared/schemas/tag'
import type { TagsSaveResult } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import { isTagVisibleIn, keepVisibleTags, sameTagSet } from '../../shared/tags/tagScope'
import { TAG_ERROR, type TagsStore } from './tags'

export interface TagsIpcHandlers {
  list(): Tag[]
  save(raw: unknown): TagsSaveResult
  remove(raw: unknown): Tag[]
}

export function createTagsIpcHandlers(store: TagsStore): TagsIpcHandlers {
  return {
    list: () => store.list(),
    save: (raw) => store.save(TagSaveSchema.parse(raw)),
    remove: (raw) => store.remove(TagDeleteSchema.parse(raw).id)
  }
}

/**
 * `session:set-tags` — parse, then prove every id exists (`tag_not_found`) and is visible to the
 * card's workspace (`tag_out_of_scope`, T-11). An UNKNOWN session is deliberately not checked here:
 * the reducer's `set_tags_unknown_id` no-op owns it (a tag write racing a stop that removed the
 * card). Neither id is logged — the throw IS the signal.
 */
export function parseSessionSetTags(
  store: TagsStore,
  raw: unknown,
  workspaceOf: (sessionId: string) => string | undefined
): SessionSetTagsRequest {
  const req = SessionSetTagsSchema.parse(raw)
  const workspaceId = workspaceOf(req.sessionId)
  for (const id of req.tagIds) {
    const tag = store.get(id)
    if (tag === null) throw new Error(TAG_ERROR.notFound)
    if (workspaceId !== undefined && !isTagVisibleIn(tag, workspaceId)) {
      throw new Error(TAG_ERROR.outOfScope)
    }
  }
  return req
}

/**
 * After the catalog changed (a tag deleted, or re-scoped away from a workspace): the cards that
 * carry a tag they can no longer see, each with the list it keeps. Cards that keep everything are
 * left out, so the caller emits no delta for them (spec §1.4).
 */
export function staleTagEdits(
  sessions: Iterable<Session>,
  lookup: (tagId: string) => Pick<Tag, 'workspaceId'> | null
): Array<{ sessionId: string; tagIds: string[] }> {
  const edits: Array<{ sessionId: string; tagIds: string[] }> = []
  for (const session of sessions) {
    const kept = keepVisibleTags(session.tagIds, session.workspaceId, lookup)
    if (!sameTagSet(kept, session.tagIds)) edits.push({ sessionId: session.id, tagIds: kept })
  }
  return edits
}
