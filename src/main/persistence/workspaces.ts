// Workspaces — the main-owned store (single source of truth; the renderer holds a projection).
// Its own file so a corrupt workspaces blob can never reset settings, templates or shortcuts.
// NEVER log a workspace value (name = operator text, defaultCwd = filesystem layout) — codes only.
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACES_FILE,
  WORKSPACES_FILE_VERSION,
  WorkspacesFileSchema,
  type Workspace,
  type WorkspaceSaveRequest,
  type WorkspacesFile
} from '../../shared/schemas/workspace'
import type { WorkspacesListResult, WorkspacesSaveResult } from '../../shared/ipc/contract'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore,
  reportNowhere,
  storageCodeForLoad,
  type StorageReporter
} from './persistedBlob'
import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'

export type WorkspacesBlobStore = PersistedBlobStore<WorkspacesFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const WORKSPACE_ERROR = {
  nameTaken: 'workspace_name_taken',
  notFound: 'workspace_not_found',
  defaultUndeletable: 'workspace_default_undeletable',
  hasSessions: 'workspace_has_sessions'
} as const

export interface WorkspacesStoreOptions {
  blobStore?: WorkspacesBlobStore
  log?: (message: string) => void
  /** UX-06 / UX-07 — where a load problem or a background write failure is told (storageHealth.ts). */
  report?: StorageReporter
  newId?: () => string
  /** Live-session guard (spec W-6). Injected by index.ts from the reducer snapshot; the default
   *  says "no live sessions" so a unit test and the smoke build need no reducer. */
  hasLiveSessions?: (workspaceId: string) => boolean
  /** Scoped-config cascade (spec §5). Called ONLY after a delete is allowed and committed;
   *  index.ts wires it to the templates, shortcuts and tags stores. Default is a no-op. */
  cascade?: (workspaceId: string) => void
}

export interface WorkspacesStore {
  /** Sorted by name, case-insensitive. */
  list(): Workspace[]
  get(id: string): Workspace | null
  activeId(): string
  view(): WorkspacesListResult
  /** No id ⇒ create; id ⇒ update. Throws WORKSPACE_ERROR.notFound / nameTaken. Trusts its typed
   *  input — the IPC handler (workspacesIpc.ts) is the parse boundary. */
  save(input: WorkspaceSaveRequest): WorkspacesSaveResult
  /** Throws defaultUndeletable / hasSessions / notFound. Deleting the ACTIVE workspace moves
   *  `activeId` to Default in the same write. */
  remove(id: string): WorkspacesListResult
  /** Throws notFound on an unknown id. */
  setActive(id: string): WorkspacesListResult
}

const LOG_PREFIX = '[claude-watcher][workspaces]'

export function createWorkspacesStore(options: WorkspacesStoreOptions = {}): WorkspacesStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<WorkspacesFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const report = options.report ?? reportNowhere
  const newId = options.newId ?? randomUUID
  const hasLiveSessions = options.hasLiveSessions ?? ((): boolean => false)
  const cascade = options.cascade ?? ((): void => {})
  const byId = new Map<string, Workspace>()

  const loaded = loadPersistedOrReset<WorkspacesFile>({
    blobStore,
    parse: (raw) => WorkspacesFileSchema.parse(raw),
    fallback: () => DEFAULT_WORKSPACES_FILE,
    onProblem: (code) => {
      log(`${LOG_PREFIX} code=workspaces_${code}`)
      report(storageCodeForLoad(code))
    }
  })
  for (const workspace of loaded.workspaces) byId.set(workspace.id, workspace)
  // Default must always exist — a hand-edited file that dropped it would otherwise leave a
  // session with nowhere to fall back to. Re-seed rather than fail the whole file closed.
  if (!byId.has(DEFAULT_WORKSPACE_ID)) {
    byId.set(DEFAULT_WORKSPACE_ID, {
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      color: 'slate',
      defaultCwd: null
    })
  }
  // An activeId naming a missing workspace is a bad pointer, not a corrupt list — fall back
  // rather than reset the operator's workspaces.
  let active = byId.has(loaded.activeId) ? loaded.activeId : DEFAULT_WORKSPACE_ID
  persistOrReport()

  function persist(): boolean {
    try {
      blobStore.write({
        version: WORKSPACES_FILE_VERSION,
        activeId: active,
        workspaces: list()
      })
      return true
    } catch {
      log(`${LOG_PREFIX} code=workspaces_write_failed`)
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

  function list(): Workspace[] {
    return [...byId.values()].sort(byName)
  }

  function get(id: string): Workspace | null {
    return byId.get(id) ?? null
  }

  function view(): WorkspacesListResult {
    return { activeId: active, workspaces: list() }
  }

  function save(input: WorkspaceSaveRequest): WorkspacesSaveResult {
    if (input.id !== undefined && !byId.has(input.id)) throw new Error(WORKSPACE_ERROR.notFound)
    const id = input.id ?? newId()
    if (isNameTaken(input.name, id)) throw new Error(WORKSPACE_ERROR.nameTaken)
    const saved: Workspace = {
      id,
      name: input.name,
      color: input.color,
      defaultCwd: input.defaultCwd
    }
    const previous = byId.get(id)
    byId.set(id, saved)
    commit(() => (previous === undefined ? byId.delete(id) : byId.set(id, previous)))
    return { saved, ...view() }
  }

  function remove(id: string): WorkspacesListResult {
    if (id === DEFAULT_WORKSPACE_ID) throw new Error(WORKSPACE_ERROR.defaultUndeletable)
    if (!byId.has(id)) throw new Error(WORKSPACE_ERROR.notFound)
    // The guard runs BEFORE any mutation, so a refused delete leaves the store untouched and
    // never cascades (a cascade on a refused delete would silently destroy scoped config).
    if (hasLiveSessions(id)) throw new Error(WORKSPACE_ERROR.hasSessions)
    const previous = byId.get(id)
    const previousActive = active
    byId.delete(id)
    if (active === id) active = DEFAULT_WORKSPACE_ID
    // BEFORE the cascade: a delete the disk refused must not have emptied the other stores.
    commit(() => {
      if (previous !== undefined) byId.set(id, previous)
      active = previousActive
    })
    cascade(id)
    return view()
  }

  function setActive(id: string): WorkspacesListResult {
    if (!byId.has(id)) throw new Error(WORKSPACE_ERROR.notFound)
    active = id
    // A switch is not a dialog Save: it holds for this run even on a full disk.
    persistOrReport()
    return view()
  }

  function isNameTaken(name: string, ownId: string): boolean {
    const key = nameKey(name)
    for (const other of byId.values()) {
      if (other.id !== ownId && nameKey(other.name) === key) return true
    }
    return false
  }

  return { list, get, activeId: () => active, view, save, remove, setActive }
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function byName(a: Workspace, b: Workspace): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
