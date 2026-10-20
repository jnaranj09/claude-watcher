import type { GoalsFile } from '../../shared/schemas/goal'
import { createElectronBlobStore } from './electronBlobStore'
import type { GoalsBlobStore } from './goals'

/** `claude-watcher-goals.json` under userData — its own file, never the settings blob. */
export function createElectronGoalsBlobStore(): GoalsBlobStore {
  return createElectronBlobStore<GoalsFile>({
    name: 'claude-watcher-goals',
    key: 'goals'
  })
}
