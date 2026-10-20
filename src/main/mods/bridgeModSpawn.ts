// The spawn's one decision about the bridge mod (spec 2026-10-18 §1.1): hand claude
// `--plugin-dir <mod folder>` plus the report URL, or say why not. Every "not" is FAIL OPEN: the
// session launches as it did before the mod existed, and hooks still own its status. The reason
// rides to Context (`sessionSetup.markUnavailable`) so it can say why it has nothing.
import { MOD_REPORT_PATH } from '../hooks/hookContract'
import { compareVersions } from '../pty/claudeVersion'
import { MIN_MOD_CLAUDE_VERSION, type ClaudeVersion } from '../../shared/launch/claudeVersion'
import type { ModSkipReason } from '../../shared/schemas/contextIpc'

export interface BridgeModSpawnInput {
  /** The last version the launch gate parsed; null when unknown. */
  version: ClaudeVersion | null
  /** THIS process holds the hook port (the same condition as `--settings`, SEC-6). */
  listening: boolean
  /** The installed mod folder, or null when the install at start failed. */
  installedDir: string | null
  hookPort: number
}

export type BridgeModSpawn =
  | { pluginDir: string; env: { CLAUDE_WATCHER_MOD_URL: string } }
  | { skip: ModSkipReason }

/** Checks run listener, then install, then version. An unknown version skips the mod (the
 *  launch itself still fails open on it) and logs a code only. */
export function bridgeModSpawn(
  input: BridgeModSpawnInput,
  log: (line: string) => void
): BridgeModSpawn {
  if (!input.listening) return { skip: 'listener_down' }
  if (input.installedDir === null) return { skip: 'mod_not_installed' }
  if (input.version === null) {
    log('[claude-watcher][mods] code=mod_skipped_version')
    return { skip: 'claude_too_old' }
  }
  if (compareVersions(input.version, MIN_MOD_CLAUDE_VERSION) < 0) return { skip: 'claude_too_old' }
  return {
    pluginDir: input.installedDir,
    env: { CLAUDE_WATCHER_MOD_URL: `http://127.0.0.1:${input.hookPort}${MOD_REPORT_PATH}` }
  }
}

/** The spawn's wiring, as one tested seam (the `hookSettingsPathIfListening` precedent): read the
 *  bind at spawn time, put the report URL in `env` only when the mod runs, tell `onSkip` why when
 *  it does not. Returns the `--plugin-dir` folder, or null. A URL sent while another process holds
 *  the port would hand it the operator's file paths (SEC-6). */
export function applyBridgeMod(deps: {
  sessionId: string
  env: Record<string, string>
  listening: () => boolean
  installedDir: () => string | null
  version: () => ClaudeVersion | null
  hookPort: number
  onSkip: (sessionId: string, reason: ModSkipReason) => void
  log: (line: string) => void
}): string | null {
  const mod = bridgeModSpawn(
    {
      version: deps.version(),
      listening: deps.listening(),
      installedDir: deps.installedDir(),
      hookPort: deps.hookPort
    },
    deps.log
  )
  if ('skip' in mod) {
    deps.onSkip(deps.sessionId, mod.skip)
    return null
  }
  deps.env.CLAUDE_WATCHER_MOD_URL = mod.env.CLAUDE_WATCHER_MOD_URL
  return mod.pluginDir
}
