// Each spawn's one decision about the memory mod (memory phase 3, addendum §2): recall while the
// session runs (`--plugin-dir <watcher-memory>`), or the index it gets at launch only, and why.
// Every "not" is FAIL CLOSED to phase 1: the session launches with the launch index, never
// blocked. `memorySpawnExtras` (memory/memoryLaunch.ts) asks it only after memory's own
// all-or-nothing gate passed and the session's config file was written; the reason rides to
// Context through the activity record (`MemoryActivityLog.recallMode`).
import { compareVersions } from '../pty/claudeVersion'
import {
  MIN_MEMORY_MOD_CLAUDE_VERSION,
  type ClaudeVersion
} from '../../shared/launch/claudeVersion'
import type { MemoryRecallSkip } from '../../shared/schemas/memory'
import type { Settings } from '../../shared/schemas/settings'

export type MemoryRecallMod = { dir: string } | { skip: MemoryRecallSkip }

/** One spawn's answer, read live. Checks run setting, then install (a folder the start installed
 *  but that is gone now counts as not installed), then version. An unknown version skips and logs
 *  `[claude-watcher][memory] code=memory_mod_skipped_version`. */
export function createMemoryModChoice(deps: {
  /** The live settings; the choice reads `memoryRecallEnabled` itself (P3-C3). */
  settings: () => Pick<Settings, 'memoryRecallEnabled'>
  installedDir: () => string | null
  /** The folder is there at this spawn (a yes/no check: never throws). */
  exists: (dir: string) => boolean
  version: () => ClaudeVersion | null
  log: (line: string) => void
}): () => MemoryRecallMod {
  return () => {
    if (!deps.settings().memoryRecallEnabled) return { skip: 'setting_off' }
    const dir = deps.installedDir()
    if (dir === null || !deps.exists(dir)) return { skip: 'mod_not_installed' }
    const version = deps.version()
    if (version === null) {
      deps.log('[claude-watcher][memory] code=memory_mod_skipped_version')
      return { skip: 'claude_too_old' }
    }
    if (compareVersions(version, MIN_MEMORY_MOD_CLAUDE_VERSION) < 0) {
      return { skip: 'claude_too_old' }
    }
    return { dir }
  }
}
