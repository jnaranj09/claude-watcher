// Phrase shortcuts — the main-owned store (single source of truth; the renderer holds a
// projection). Own file so a corrupt shortcuts blob can never reset the operator's settings or
// templates. NEVER log a shortcut value (name, text) — codes only.
import { randomUUID } from 'node:crypto'
import {
  EMPTY_SHORTCUTS_FILE,
  parseShortcutsFile,
  SHORTCUTS_FILE_VERSION,
  type Shortcut,
  type ShortcutSaveRequest,
  type ShortcutsFile
} from '../../shared/schemas/shortcut'
import type { ShortcutsSaveResult } from '../../shared/ipc/contract'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore,
  reportNowhere,
  storageCodeForLoad,
  type StorageReporter
} from './persistedBlob'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'

export type ShortcutsBlobStore = PersistedBlobStore<ShortcutsFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const SHORTCUT_ERROR = {
  aliasTaken: 'shortcut_alias_taken',
  notFound: 'shortcut_not_found'
} as const

export interface ShortcutsStoreOptions {
  blobStore?: ShortcutsBlobStore
  log?: (message: string) => void
  /** UX-06 / UX-07 — where a load problem or a background write failure is told (storageHealth.ts). */
  report?: StorageReporter
  newId?: () => string
}

export interface ShortcutsStore {
  /** Sorted by alias — the box's match column (uniqueness is on the alias, not the name). */
  list(): Shortcut[]
  get(id: string): Shortcut | null
  /** No id ⇒ create; id ⇒ update. Throws SHORTCUT_ERROR.notFound / aliasTaken. Trusts its typed
   *  input — the IPC handler (shortcutsIpc.ts) is the parse boundary. */
  save(input: ShortcutSaveRequest): ShortcutsSaveResult
  /** Unknown id is a no-op (idempotent). */
  remove(id: string): Shortcut[]
  /** Favorites — star or unstar one row. Throws SHORTCUT_ERROR.notFound; a refused write is
   *  undone and throws STORE_WRITE_FAILED (commit). Trusts its typed input (shortcutsIpc.ts). */
  setFavorite(id: string, favorite: boolean): Shortcut[]
  /** Workspaces — delete every shortcut scoped to `workspaceId`. Returns how many were removed.
   *  Called ONLY by the workspaces store's cascade, after a delete was allowed. Global rows
   *  (`workspaceId === null`) are never touched. */
  removeByWorkspace(workspaceId: string): number
}

const LOG_PREFIX = '[claude-watcher][shortcuts]'

export function createShortcutsStore(options: ShortcutsStoreOptions = {}): ShortcutsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<ShortcutsFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const report = options.report ?? reportNowhere
  const newId = options.newId ?? randomUUID
  const byId = new Map<string, Shortcut>()

  const loaded = loadPersistedOrReset<ShortcutsFile>({
    blobStore,
    // v3 as is; a v2 file is migrated in memory and rewritten as v3 by the persist() below.
    parse: parseShortcutsFile,
    fallback: () => EMPTY_SHORTCUTS_FILE,
    // CODE only — the thrown ZodError stringifies the file, which carries operator phrases.
    onProblem: (code) => {
      log(`${LOG_PREFIX} code=shortcuts_${code}`)
      report(storageCodeForLoad(code))
    }
  })
  for (const shortcut of loaded.shortcuts) byId.set(shortcut.id, shortcut)
  persistOrReport()

  function persist(): boolean {
    try {
      blobStore.write({ version: SHORTCUTS_FILE_VERSION, shortcuts: list() })
      return true
    } catch {
      log(`${LOG_PREFIX} code=shortcuts_write_failed`)
      return false
    }
  }

  /** A dialog's Save / Delete (UX-06): undo the change and throw when the file write fails, so
   *  the dialog never says "saved" about a row the next start will not have. */
  function commit(undo: () => void): void {
    if (persist()) return
    undo()
    throw new Error(STORE_WRITE_FAILED)
  }

  /** Every other write: the change holds for this run, and storage health says it was not kept. */
  function persistOrReport(): void {
    if (!persist()) report('write_failed')
  }

  function list(): Shortcut[] {
    return [...byId.values()].sort(byAlias)
  }

  function get(id: string): Shortcut | null {
    return byId.get(id) ?? null
  }

  function save(input: ShortcutSaveRequest): ShortcutsSaveResult {
    if (input.id !== undefined && !byId.has(input.id)) throw new Error(SHORTCUT_ERROR.notFound)
    const id = input.id ?? newId()
    if (isAliasTaken(input.alias, id)) throw new Error(SHORTCUT_ERROR.aliasTaken)
    const previous = byId.get(id)
    const saved: Shortcut = {
      id,
      name: input.name,
      alias: input.alias,
      text: input.text,
      workspaceId: input.workspaceId,
      // Not in the save arg: a form Save keeps the star; only setFavorite changes it.
      favorite: previous?.favorite ?? false
    }
    byId.set(id, saved)
    commit(() => (previous === undefined ? byId.delete(id) : byId.set(id, previous)))
    return { saved, shortcuts: list() }
  }

  function remove(id: string): Shortcut[] {
    const previous = byId.get(id)
    if (previous !== undefined && byId.delete(id)) commit(() => byId.set(id, previous))
    return list()
  }

  function setFavorite(id: string, favorite: boolean): Shortcut[] {
    const previous = byId.get(id)
    if (previous === undefined) throw new Error(SHORTCUT_ERROR.notFound)
    byId.set(id, { ...previous, favorite })
    commit(() => byId.set(id, previous))
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
    if (removed > 0) persistOrReport()
    return removed
  }

  /** Uniqueness is file-wide, the same scope the chord sequences had: the box lists global +
   *  active-workspace rows together, and two rows answering to one word would be a coin toss. */
  function isAliasTaken(alias: string, ownId: string): boolean {
    for (const other of byId.values()) {
      if (other.id !== ownId && other.alias === alias) return true
    }
    return false
  }

  return { list, get, save, setFavorite, remove, removeByWorkspace }
}

/** Sorted by alias — the column the operator scans in the box and the table. */
function byAlias(a: Shortcut, b: Shortcut): number {
  return a.alias.localeCompare(b.alias, undefined, { sensitivity: 'base' })
}
