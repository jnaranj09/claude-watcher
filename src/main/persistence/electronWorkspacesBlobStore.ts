import type { WorkspacesFile } from '../../shared/schemas/workspace'
import { createElectronBlobStore } from './electronBlobStore'
import type { WorkspacesBlobStore } from './workspaces'

/** `claude-watcher-workspaces.json` under userData — its own file, never the settings,
 *  templates or shortcuts blob. */
export function createElectronWorkspacesBlobStore(): WorkspacesBlobStore {
  return createElectronBlobStore<WorkspacesFile>({
    name: 'claude-watcher-workspaces',
    key: 'workspaces'
  })
}
