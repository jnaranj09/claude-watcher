import type { PastSessionsFile } from '../../shared/schemas/pastSession'
import { createElectronBlobStore } from './electronBlobStore'
import type { PastSessionsBlobStore } from './pastSessions'

/** `claude-watcher-past-sessions.json` under userData — its own file, never the settings blob. */
export function createElectronPastSessionsBlobStore(): PastSessionsBlobStore {
  return createElectronBlobStore<PastSessionsFile>({
    name: 'claude-watcher-past-sessions',
    key: 'pastSessions'
  })
}
