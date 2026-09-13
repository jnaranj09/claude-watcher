// Session templates — the renderer PROJECTION of main's templates store (state.md: main is
// truth; this is a hydrated copy, replaced wholesale from every IPC result — no client merge).
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Template, TemplateSaveRequest } from '../../../shared/ipc/contract'

export interface TemplatesState {
  templates: Template[]
  loaded: boolean
  hydrate: (templates: Template[]) => void
}
export type TemplatesStoreApi = StoreApi<TemplatesState>

export function createTemplatesStore(): TemplatesStoreApi {
  return createStore<TemplatesState>((set) => ({
    templates: [],
    loaded: false,
    hydrate: (templates) => set({ templates, loaded: true })
  }))
}

export const selectTemplates = (state: TemplatesState): Template[] => state.templates
export const selectTemplatesLoaded = (state: TemplatesState): boolean => state.loaded

/**
 * Workspaces — the templates VISIBLE in one workspace: the global rows (`workspaceId === null`)
 * plus that workspace's own. A row naming a workspace that no longer exists is visible in NONE
 * of them — it is reachable only through the Manage dialog's `(no workspace)` group, so a
 * hand-edited file cannot silently put a stranger's template on the operator's menu. Consumed by
 * the `+ New session` popover and the shortcut matcher's mirror — NOT by the Manage dialog,
 * which shows every template regardless of scope.
 */
export const makeSelectVisibleTemplates =
  (activeId: string) =>
  (state: TemplatesState): Template[] =>
    state.templates.filter((t) => t.workspaceId === null || t.workspaceId === activeId)

export const templatesStore = createTemplatesStore()

export function useTemplates<T>(selector: (state: TemplatesState) => T): T {
  return useStore(templatesStore, selector)
}

const LOG_PREFIX = '[claude-watcher][templates]'

export async function loadTemplates(): Promise<void> {
  try {
    templatesStore.getState().hydrate(await window.templates.list())
  } catch {
    console.warn(`${LOG_PREFIX} code=templates_load_failed`)
  }
}

/** Rethrows: the Templates form maps `template_name_taken` etc. to copy. */
export async function saveTemplate(req: TemplateSaveRequest): Promise<Template> {
  const result = await window.templates.save(req)
  templatesStore.getState().hydrate(result.templates)
  return result.saved
}

/** Rethrows: `template_in_use` is operator-facing — the Templates form shows it. */
export async function removeTemplate(id: string): Promise<void> {
  templatesStore.getState().hydrate(await window.templates.remove(id))
}
