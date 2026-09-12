// Tags — the main-owned tag catalog (single source of truth; the renderer holds a projection).
// Its own file so a corrupt tags blob can never reset settings, templates, shortcuts or
// workspaces. NEVER log a tag value (the name is operator text) — codes only.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_TAGS_FILE,
  TAGS_FILE_VERSION,
  TagsFileSchema,
  type Tag,
  type TagSaveRequest,
  type TagsFile
} from '../../shared/schemas/tag'
import type { TagsSaveResult } from '../../shared/ipc/contract'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore
} from './persistedBlob'

export type TagsBlobStore = PersistedBlobStore<TagsFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const TAG_ERROR = {
  notFound: 'tag_not_found',
  nameTaken: 'tag_name_taken',
  inUse: 'tag_in_use',
  outOfScope: 'tag_out_of_scope'
} as const

/** One rule that references a tag. Only its scope matters to the integrity checks. */
export interface TagRuleRef {
  ruleWorkspaceId: string | null
}

export interface TagsStoreOptions {
  blobStore?: TagsBlobStore
  log?: (message: string) => void
  newId?: () => string
  /** The rules that reference a tag (spec T-16, §1.4). index.ts wires it to the rules store in
   *  Phase 2; the default says "no rule uses it", so this store works before rules exist. */
  ruleRefs?: (tagId: string) => TagRuleRef[]
}

export interface TagsStore {
  /** Sorted by name, case-insensitive. This order IS the tag-list order chips render in. */
  list(): Tag[]
  get(id: string): Tag | null
  /** No id ⇒ create; id ⇒ update. Throws TAG_ERROR.notFound / nameTaken / inUse. Trusts its typed
   *  input — the IPC handler (tagsIpc.ts) is the parse boundary. */
  save(input: TagSaveRequest): TagsSaveResult
  /** Unknown id is a no-op (idempotent). Throws TAG_ERROR.inUse while a rule uses the tag. */
  remove(id: string): Tag[]
  /** Workspaces — delete every tag scoped to `workspaceId`; returns how many. Called ONLY by the
   *  workspaces store's cascade, after a delete was allowed. Global tags are never touched. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][tags]'

export function createTagsStore(options: TagsStoreOptions = {}): TagsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<TagsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const newId = options.newId ?? randomUUID
  const ruleRefs = options.ruleRefs ?? ((): TagRuleRef[] => [])
  const byId = new Map<string, Tag>()

  const loaded = loadPersistedOrReset<TagsFile>({
    blobStore,
    parse: (raw) => TagsFileSchema.parse(raw),
    fallback: () => EMPTY_TAGS_FILE,
    onProblem: (code) => log(`${LOG_PREFIX} code=tags_${code}`)
  })
  for (const tag of loaded.tags) byId.set(tag.id, tag)
  persist()

  function persist(): void {
    try {
      blobStore.write({ version: TAGS_FILE_VERSION, tags: list() })
    } catch {
      log(`${LOG_PREFIX} code=tags_write_failed`)
    }
  }

  function list(): Tag[] {
    return [...byId.values()].sort(byName)
  }

  function get(id: string): Tag | null {
    return byId.get(id) ?? null
  }

  function save(input: TagSaveRequest): TagsSaveResult {
    if (input.id !== undefined && !byId.has(input.id)) throw new Error(TAG_ERROR.notFound)
    const id = input.id ?? newId()
    if (isNameTaken(input.name, input.workspaceId, id)) throw new Error(TAG_ERROR.nameTaken)
    // §1.4 — a scope change must never hide the tag from a rule that uses it (T-11).
    if (ruleRefs(id).some((ref) => !visibleToRule(input.workspaceId, ref))) {
      throw new Error(TAG_ERROR.inUse)
    }
    const saved: Tag = { id, name: input.name, color: input.color, workspaceId: input.workspaceId }
    byId.set(id, saved)
    persist()
    return { saved, tags: list() }
  }

  function remove(id: string): Tag[] {
    if (!byId.has(id)) return list()
    // T-16 — no rule is ever silently changed by a delete.
    if (ruleRefs(id).length > 0) throw new Error(TAG_ERROR.inUse)
    byId.delete(id)
    persist()
    return list()
  }

  function removeByWorkspace(workspaceId: string): number {
    let removed = 0
    for (const [id, tag] of byId) {
      if (tag.workspaceId === workspaceId) {
        byId.delete(id)
        removed += 1
      }
    }
    if (removed > 0) persist()
    return removed
  }

  /** T-24 — two tags clash when their names match (trimmed, case-insensitive) AND one picker could
   *  show both: either one is global, or both belong to the same workspace. */
  function isNameTaken(name: string, workspaceId: string | null, ownId: string): boolean {
    const key = nameKey(name)
    for (const other of byId.values()) {
      if (other.id === ownId || nameKey(other.name) !== key) continue
      if (workspaceId === null || other.workspaceId === null || other.workspaceId === workspaceId) {
        return true
      }
    }
    return false
  }

  return { list, get, save, remove, removeByWorkspace }
}

/** A rule scoped to `ref.ruleWorkspaceId` can see a tag scoped to `tagWorkspaceId` (T-11). */
function visibleToRule(tagWorkspaceId: string | null, ref: TagRuleRef): boolean {
  return tagWorkspaceId === null || tagWorkspaceId === ref.ruleWorkspaceId
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function byName(a: Tag, b: Tag): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
