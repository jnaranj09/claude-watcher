// The memory IPC handler BODIES (spec 2026-11-11 memory), kept out of index.ts so they are
// unit-testable in node; ipc/registerStoreIpc.ts binds them to CH.memory* channels. Every arg is
// UNTRUSTED cross-process input → one `.strict()` Schema.parse(raw) that throws on bad input
// (zod-boundaries.md IPC-arg row). The operator is the writer: a create is `stated` with origin
// `operator` and no session, an edit or a state change carries no reason.
//
// No scope check on get/edit/setState/setPinned/remove/restore: the operator's dialog may open any
// item it listed. `list` passes the dialog's workspace scope, and "here" (the folder filter) means
// nothing for the operator (`sessionFolder: null`).
//
// Refusals pass through unchanged: `memory_not_found`, `memory_version_not_found`,
// `memory_read_failed` and `store_write_failed` (the store already logged and reported it).
// While memory is off (the file could not be opened, the smoke test, after quit) every handler but
// `activity` throws `memory_unavailable`. `activity` reads the in-memory per-session record, which
// needs no database: a session with nothing recorded answers an empty record.
import {
  MEMORY_ERROR,
  MemoryActivityGetSchema,
  MemoryCreateSchema,
  MemoryDeleteSchema,
  MemoryEditSchema,
  MemoryGetSchema,
  MemoryListSchema,
  MemoryRestoreSchema,
  MemorySetPinnedSchema,
  MemorySetStateSchema,
  type MemoryActivity,
  type MemoryItem
} from '../../shared/schemas/memory'
import type { MemoryGetResult, MemoryListResult } from '../../shared/ipc/contract'
import type { MemoryActivityLog } from './memoryActivity'
import type { MemoryNames } from './memoryNames'
import type { MemoryStore } from './memoryStore'

const NO_META: MemoryItem['meta'] = {
  folder: null,
  sessionName: null,
  tagIds: [],
  templateId: null,
  goalId: null,
  taskIds: []
}

export interface MemoryIpcHandlers {
  list(raw: unknown): MemoryListResult
  get(raw: unknown): MemoryGetResult
  create(raw: unknown): MemoryItem
  edit(raw: unknown): MemoryItem
  setState(raw: unknown): MemoryItem
  setPinned(raw: unknown): MemoryItem
  remove(raw: unknown): void
  restore(raw: unknown): MemoryItem
  activity(raw: unknown): MemoryActivity
}

export function createMemoryIpcHandlers(deps: {
  store: () => MemoryStore | null
  names: MemoryNames
  activity: Pick<MemoryActivityLog, 'get'>
}): MemoryIpcHandlers {
  const { names, activity } = deps

  function requireStore(): MemoryStore {
    const found = deps.store()
    // Every handler but `activity` while there is no store.
    if (found === null) throw new Error(MEMORY_ERROR.unavailable)
    return found
  }

  return {
    list(raw) {
      const req = MemoryListSchema.parse(raw)
      const { workspaceId } = req
      return requireStore().search(
        { workspaceId, includeGlobal: req.includeGlobal },
        {
          kind: req.kind,
          query: req.query,
          filters: req.filters,
          offset: req.offset,
          limit: req.limit
        },
        {
          sessionFolder: null,
          tagIdsByName: (name) => names.tagIdsByName(workspaceId, name),
          goalIdsByName: (name) => names.goalIdsByName(workspaceId, name)
        }
      )
    },
    get(raw) {
      const { id } = MemoryGetSchema.parse(raw)
      const s = requireStore()
      const item = s.get(id)
      if (item === null) throw new Error(MEMORY_ERROR.notFound)
      return { item, versions: s.versions(id) }
    },
    create(raw) {
      const req = MemoryCreateSchema.parse(raw)
      return requireStore().add({
        text: req.text,
        workspaceId: req.workspaceId,
        check: req.check,
        basis: 'stated',
        origin: { by: 'operator', sessionId: null },
        meta: NO_META
      })
    },
    edit(raw) {
      const req = MemoryEditSchema.parse(raw)
      return requireStore().edit(req.id, { text: req.text, check: req.check }, 'operator', null)
    },
    setState(raw) {
      const req = MemorySetStateSchema.parse(raw)
      return requireStore().setState(req.id, req.state, 'operator', null)
    },
    setPinned(raw) {
      const req = MemorySetPinnedSchema.parse(raw)
      return requireStore().setPinned(req.id, req.pinned)
    },
    remove(raw) {
      const { id } = MemoryDeleteSchema.parse(raw)
      requireStore().remove(id)
    },
    restore(raw) {
      const req = MemoryRestoreSchema.parse(raw)
      return requireStore().restore(req.id, req.versionAt)
    },
    activity(raw) {
      const { sessionId } = MemoryActivityGetSchema.parse(raw)
      return activity.get(sessionId)
    }
  }
}
