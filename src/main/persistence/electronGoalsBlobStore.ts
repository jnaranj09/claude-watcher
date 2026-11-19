import type { GoalsFile } from '../../shared/schemas/goal'
import { createElectronBlobStore, type ElectronBlobStore } from './electronBlobStore'

/** `claude-watcher-goals.json` under userData — its own file, never the settings blob. `copy`
 *  makes the one-time memory cleanup's `claude-watcher-goals.pre-regroup-<ts>.json`. */
export function createElectronGoalsBlobStore(): ElectronBlobStore<GoalsFile> {
  return createElectronBlobStore<GoalsFile>({
    name: 'claude-watcher-goals',
    key: 'goals'
  })
}
