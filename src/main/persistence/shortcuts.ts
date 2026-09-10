// Phrase shortcuts — the main-owned store (single source of truth; the renderer holds a
// projection). Own file so a corrupt shortcuts blob can never reset the operator's settings or
// templates. NEVER log a shortcut value (name, text) — codes only.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_SHORTCUTS_FILE,
  shortcutKeysId,
  SHORTCUTS_FILE_VERSION,
  ShortcutsFileSchema,
  type Shortcut,
  type ShortcutSaveRequest,
  type ShortcutsFile
} from '../../shared/schemas/shortcut'
import type { ShortcutsSaveResult } from '../../shared/ipc/contract'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore
} from './persistedBlob'

export type ShortcutsBlobStore = PersistedBlobStore<ShortcutsFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const SHORTCUT_ERROR = {
  keysTaken: 'shortcut_keys_taken',
  notFound: 'shortcut_not_found'
} as const

export interface ShortcutsStoreOptions {
  blobStore?: ShortcutsBlobStore
  log?: (message: string) => void
  newId?: () => string
}

export interface ShortcutsStore {
  /** Sorted by the canonical sequence id — the table's scan column (uniqueness is on the full
   *  chord sequence, not the name). */
  list(): Shortcut[]
  get(id: string): Shortcut | null
  /** No id ⇒ create; id ⇒ update. Throws SHORTCUT_ERROR.notFound / keysTaken. Trusts its typed
   *  input — the IPC handler (shortcutsIpc.ts) is the parse boundary. */
  save(input: ShortcutSaveRequest): ShortcutsSaveResult
  /** Unknown id is a no-op (idempotent). */
  remove(id: string): Shortcut[]
  /** Workspaces — delete every shortcut scoped to `workspaceId`. Returns how many were removed.
   *  Called ONLY by the workspaces store's cascade, after a delete was allowed. Global rows
   *  (`workspaceId === null`) are never touched. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][shortcuts]'

export function createShortcutsStore(options: ShortcutsStoreOptions = {}): ShortcutsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<ShortcutsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const newId = options.newId ?? randomUUID
  const byId = new Map<string, Shortcut>()

  const loaded = loadPersistedOrReset<ShortcutsFile>({
    blobStore,
    parse: (raw) => ShortcutsFileSchema.parse(raw),
    fallback: () => EMPTY_SHORTCUTS_FILE,
    // CODE only — the thrown ZodError stringifies the file, which carries operator phrases.
    onProblem: (code) => log(`${LOG_PREFIX} code=shortcuts_${code}`)
  })
  for (const shortcut of loaded.shortcuts) byId.set(shortcut.id, shortcut)
  persist()

  function persist(): void {
    try {
      blobStore.write({ version: SHORTCUTS_FILE_VERSION, shortcuts: list() })
    } catch {
      log(`${LOG_PREFIX} code=shortcuts_write_failed`)
    }
  }

  function list(): Shortcut[] {
    return [...byId.values()].sort(byKeys)
  }

  function get(id: string): Shortcut | null {
    return byId.get(id) ?? null
  }

  function save(input: ShortcutSaveRequest): ShortcutsSaveResult {
    if (input.id !== undefined && !byId.has(input.id)) throw new Error(SHORTCUT_ERROR.notFound)
    const id = input.id ?? newId()
    if (isKeysTaken(input.keys, id)) throw new Error(SHORTCUT_ERROR.keysTaken)
    const saved: Shortcut = {
      id,
      name: input.name,
      keys: input.keys,
      text: input.text,
      workspaceId: input.workspaceId
    }
    byId.set(id, saved)
    persist()
    return { saved, shortcuts: list() }
  }

  function remove(id: string): Shortcut[] {
    if (byId.delete(id)) persist()
    return list()
  }

  function removeByWorkspace(workspaceId: string): number {
    let removed = 0
    for (const [id, shortcut] of byId) {
      if (shortcut.workspaceId === workspaceId) {
        byId.delete(id)
        removed += 1
      }
    }
    if (removed > 0) persist()
    return removed
  }

  /** Uniqueness is on the FULL sequence. A PREFIX has a different canonical id, so a prefix and
   *  the sequence it prefixes coexist by construction — the operator's explicit requirement. */
  function isKeysTaken(keys: readonly string[], ownId: string): boolean {
    const id = shortcutKeysId(keys)
    for (const other of byId.values()) {
      if (other.id !== ownId && shortcutKeysId(other.keys) === id) return true
    }
    return false
  }

  return { list, get, save, remove, removeByWorkspace }
}

/** Sorted by the canonical sequence id — the table's scan column. A prefix sorts immediately
 *  before its extensions, which is the right reading order. */
function byKeys(a: Shortcut, b: Shortcut): number {
  return shortcutKeysId(a.keys).localeCompare(shortcutKeysId(b.keys), undefined, {
    sensitivity: 'base'
  })
}
