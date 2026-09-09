// The workspaces IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input
// (zod-boundaries.md IPC-arg row). index.ts only binds them to CH.* channels.
import {
  WorkspaceDeleteSchema,
  WorkspaceSaveSchema,
  WorkspaceSetActiveSchema
} from '../../shared/schemas/workspace'
import type { WorkspacesListResult, WorkspacesSaveResult } from '../../shared/ipc/contract'
import type { WorkspacesStore } from './workspaces'

export interface WorkspacesIpcHandlers {
  list(): WorkspacesListResult
  save(raw: unknown): WorkspacesSaveResult
  remove(raw: unknown): WorkspacesListResult
  setActive(raw: unknown): WorkspacesListResult
}

export function createWorkspacesIpcHandlers(store: WorkspacesStore): WorkspacesIpcHandlers {
  return {
    list: () => store.view(),
    save: (raw) => store.save(WorkspaceSaveSchema.parse(raw)),
    remove: (raw) => store.remove(WorkspaceDeleteSchema.parse(raw).id),
    setActive: (raw) => store.setActive(WorkspaceSetActiveSchema.parse(raw).id)
  }
}
