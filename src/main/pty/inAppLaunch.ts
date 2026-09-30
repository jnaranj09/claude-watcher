// Action feedback (spec 2026-09-29 §2.4) — an IN-APP launch's refusals, as CODES.
//
// Main used to explain a too-old claude and a missing folder with `dialog.showErrorBox`, because
// the renderer swallowed a rejected launch invoke. The name prompt now stays open while the invoke
// runs and maps these codes to copy on its own error line (§2.2), so a box would say it twice. The
// API path keeps its own refusals (sessionsCreate.ts: 503 `claude_version`, 409 `folder_missing`).
// Past sessions → Open and the dead pane's Resume use `requireClaudeVersion` for the same reason.
import { isFolderMissing } from './launchSession'

/** The code an in-app launch rejects with when claude is below MIN_CLAUDE_VERSION. */
export const LAUNCH_CLAUDE_VERSION = 'claude_version'

/** Throw `claude_version` when the gate refuses (it fails OPEN on an unreadable version). */
export function requireClaudeVersion(allowsLaunch: () => boolean): void {
  if (!allowsLaunch()) throw new Error(LAUNCH_CLAUDE_VERSION)
}

export interface InAppLaunchDeps {
  /** `claudeVersionGate.allowsInteractiveLaunch` — re-probes a refusal, caches only ok. */
  allowsLaunch: () => boolean
  /** Code-only log sink. */
  log: (message: string) => void
}

/** Run an in-app launch: the version first, then `run`. A `folder_missing` refusal (UX-11) is
 *  logged as a code and rethrown as it is — the code IS the message. Any other failure passes
 *  through untouched. Never logs the cwd or the name. */
export function runInAppLaunch<T>(deps: InAppLaunchDeps, run: () => T): T {
  requireClaudeVersion(deps.allowsLaunch)
  try {
    return run()
  } catch (err) {
    if (isFolderMissing(err)) deps.log('[claude-watcher][launch] code=folder_missing')
    throw err
  }
}
