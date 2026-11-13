import type { PastSessionsFile, PastSessionsMemoryFile } from '../../shared/schemas/pastSession'
import { createElectronBlobStore } from './electronBlobStore'
import type { PastSessionsBlobStore, PastSessionsMemoryBlobStore } from './pastSessions'

/** `claude-watcher-past-sessions.json` under userData — its own file, never the settings blob. */
export function createElectronPastSessionsBlobStore(): PastSessionsBlobStore {
  return createElectronBlobStore<PastSessionsFile>({
    name: 'claude-watcher-past-sessions',
    key: 'pastSessions'
  })
}

/** `claude-watcher-past-sessions-memory.json` under userData: each record's memory state (R50),
 *  out of the Past sessions file so an older build still reads that one. */
export function createElectronPastSessionsMemoryBlobStore(): PastSessionsMemoryBlobStore {
  return createElectronBlobStore<PastSessionsMemoryFile>({
    name: 'claude-watcher-past-sessions-memory',
    key: 'pastSessionsMemory'
  })
}
