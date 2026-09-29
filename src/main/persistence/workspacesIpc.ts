// The workspaces IPC handler BODIES, kept out of index.ts so they are unit-testable in node.
// Every arg is UNTRUSTED cross-process input → Schema.parse(raw) throws typed on bad input
// (zod-boundaries.md IPC-arg row). index.ts only binds them to CH.* channels.
import {
  WorkspaceDeleteSchema,
  WorkspaceSaveSchema,
  WorkspaceSetActiveSchema
} from '../../shared/schemas/workspace'
import {
  SessionPickDirectorySchema,
  SessionSetWorkspaceSchema,
  type SessionSetWorkspaceRequest
} from '../../shared/schemas/launch'
import type { WorkspacesListResult, WorkspacesSaveResult } from '../../shared/ipc/contract'
import { WORKSPACE_ERROR, type WorkspacesStore } from './workspaces'

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

/**
 * `session:set-workspace` — the parse + existence half of that handler's body, here for the
 * same reason as the four above: index.ts is not unit-testable in node, this is.
 *
 * Two fail-closed gates, in order. The ARG is UNTRUSTED cross-process input, so a blank or
 * missing id throws at the schema (zod-boundaries.md IPC-arg row; NEITHER id is logged — the
 * throw IS the signal). Then the target WORKSPACE is proved to exist against main's own store:
 * moving a card into a workspace that does not exist would strand it where no view can show it
 * (every board/rail selector filters on the active workspace), so an unknown workspace throws
 * `workspace_not_found` instead of being applied.
 *
 * An unknown SESSION id is deliberately NOT checked here — that is the reducer's
 * `set_workspace_unknown_id` no-op (a move racing a stop that already removed the card).
 *
 * Returns the validated move; index.ts routes it to the SENDER's board seam, because session
 * truth is per-window and a move must never broadcast to every window.
 */
export function parseSessionWorkspaceMove(
  store: WorkspacesStore,
  raw: unknown
): SessionSetWorkspaceRequest {
  const move = SessionSetWorkspaceSchema.parse(raw)
  if (store.get(move.workspaceId) === null) throw new Error(WORKSPACE_ERROR.notFound)
  return move
}

/**
 * R26 — where the folder picker opens: the named workspace's default folder, else the ACTIVE
 * workspace's (no arg — a new workspace, a plain `+ New session` — or an id that is gone), else
 * null (the OS default). The arg is UNTRUSTED and parse-and-throws; the answer is read from main's
 * own store, so the renderer can steer the picker only between folders the operator saved.
 * NEVER logged — it is a path.
 */
export function pickDirectoryDefaultPath(store: WorkspacesStore, raw: unknown): string | null {
  const req = SessionPickDirectorySchema.parse(raw)
  const named = req === undefined ? null : store.get(req.workspaceId)
  const workspace = named ?? store.get(store.activeId())
  return workspace?.defaultCwd ?? null
}
