// Workspaces — the renderer PROJECTION of main's workspaces store (state.md: main is truth;
// this is a hydrated copy, replaced wholesale from every IPC result — no client merge).
// `activeId` lives HERE, not in boardStore, so a workspace switch does not invalidate every
// board subscriber.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { DEFAULT_WORKSPACE_ID } from '../../../shared/schemas/workspace'
import type { Workspace, WorkspaceSaveRequest } from '../../../shared/ipc/contract'
import { toast } from './toastStore'

export interface WorkspacesState {
  workspaces: Workspace[]
  activeId: string
  loaded: boolean
  /** Action feedback (spec 2026-09-29 §2.6) — the startup load failed; any hydrate clears it. */
  loadFailed: boolean
  hydrate: (view: { activeId: string; workspaces: Workspace[] }) => void
  markLoadFailed: () => void
}
export type WorkspacesStoreApi = StoreApi<WorkspacesState>

export function createWorkspacesViewStore(): WorkspacesStoreApi {
  return createStore<WorkspacesState>((set) => ({
    workspaces: [],
    activeId: DEFAULT_WORKSPACE_ID,
    loaded: false,
    loadFailed: false,
    hydrate: (view) => set({ ...view, loaded: true, loadFailed: false }),
    markLoadFailed: () => set({ loadFailed: true })
  }))
}

export const workspacesStore = createWorkspacesViewStore()

export function useWorkspaces<T>(selector: (state: WorkspacesState) => T): T {
  return useStore(workspacesStore, selector)
}

export const selectWorkspaces = (s: WorkspacesState): Workspace[] => s.workspaces
export const selectActiveWorkspaceId = (s: WorkspacesState): string => s.activeId
export const selectWorkspacesLoaded = (s: WorkspacesState): boolean => s.loaded
/** True only while nothing loaded AND the load failed — the dialog says so instead of "none yet". */
export const selectWorkspacesLoadFailed = (s: WorkspacesState): boolean =>
  !selectWorkspacesLoaded(s) && s.loadFailed
/** null when the persisted activeId names a workspace the list no longer has — the callers
 *  render the plain label rather than crash (never-crash past the boundary). */
export const selectActiveWorkspace = (s: WorkspacesState): Workspace | null =>
  s.workspaces.find((w) => w.id === s.activeId) ?? null

const LOG_PREFIX = '[claude-watcher][workspaces]'

/** Resolves whether it worked (the startup toast names the failures). Never rejects. */
export async function loadWorkspaces(): Promise<boolean> {
  try {
    workspacesStore.getState().hydrate(await window.workspaces.list())
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=workspaces_load_failed`)
    workspacesStore.getState().markLoadFailed()
    return false
  }
}

/** Rethrows: the Workspaces dialog maps `workspace_name_taken` etc. to copy. */
export async function saveWorkspace(req: WorkspaceSaveRequest): Promise<Workspace> {
  const result = await window.workspaces.save(req)
  workspacesStore.getState().hydrate(result)
  return result.saved
}

/** Rethrows: `workspace_has_sessions` / `workspace_default_undeletable` are operator-facing. */
export async function removeWorkspace(id: string): Promise<void> {
  workspacesStore.getState().hydrate(await window.workspaces.remove(id))
}

/** Not optimistic: main persists the pointer, so the store takes the value main confirmed.
 *  Resolves false when the invoke failed — said in a toast here (spec 2026-09-29 §2.3; it used to
 *  be swallowed). Callers still read `activeId` for the value main confirmed. */
export async function setActiveWorkspace(id: string): Promise<boolean> {
  try {
    workspacesStore.getState().hydrate(await window.workspaces.setActive(id))
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=workspaces_set_active_failed`)
    toast.error('Could not switch workspace.')
    return false
  }
}
