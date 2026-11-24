// Zero-footprint hook delivery — the app's hook block as a STANDALONE settings file that is
// handed to claude with `--settings <path>`, instead of being merged into the launched
// project's `.claude/settings.local.json`.
//
// WHY THIS REPLACED registerHooks.ts (the project-file merger):
// writing into the operator's project meant the app left a permanent footprint in every
// directory it was ever launched in. Those blocks outlived the app: a plain `claude` started
// by hand in the same folder kept POSTing to :9279 forever (harmless — unknown ids are a
// no-op — but it is the operator's file, and the app had no business still being in it).
// The flag scopes the hooks to EXACTLY the sessions the app spawns, and touches nothing else.
//
// ESTABLISHED BY LIVE PROBE against claude 2.1.245 (scratchpad/probe3.mjs + probe4.mjs):
//   - hooks handed via `--settings <file>` FIRE (POST reaches the listener);
//   - a plain `claude` in the same folder fires NOTHING — zero leakage, the whole point;
//   - the name-sync RESPONSE (`hookSpecificOutput.sessionTitle`) still renames the session
//     when the hook came from the flag (`custom-title.json` -> the pushed title);
//   - `--settings` MERGES with the project's own settings, it does NOT replace them: a
//     command hook in the project's `.claude/settings.json` still fired alongside ours.
//     Load-bearing — an operator's own hooks/permissions must survive our flag;
//   - a STALE `settings.local.json` block on the same URL was DEDUPED against the flag (one POST,
//     not two). The flag's URL is now per session (`/h/<token>/`, `hookChannel.ts`), so a block
//     the retired merger left posts to the bare URL, which the listener answers 401: it reaches
//     nothing, and push-once stays safe (one POST per prompt can consume a pending title).
//
// ONE FILE PER SESSION (T-D13): the hook URL carries the session's channel token, so the file is
// private (`<userData>/hooks/<random>.json`, folder 0700, file 0600, `sessionFiles.ts`), follows
// the card on `/clear` and goes with it (`window/cardState.ts`); a start clears what the last run
// left, and the old shared `claude-hooks.settings.json` (`removeLegacyHookSettings`).
//
// [spec-zero-footprint-hooks.md; .claude/rules/zod-boundaries.md]
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { PORT, REGISTERED_EVENTS } from './hookContract'
import { hookChannelBase } from './hookChannel'
import { createSessionFiles, type SessionFiles } from '../sessionFiles'

/** The one shared settings file earlier builds wrote into userData, before each session got its
 *  own. Deleted at start; nothing writes it any more. */
const LEGACY_HOOK_SETTINGS_FILENAME = 'claude-hooks.settings.json'

/** One Claude Code hook entry — our loopback listener. */
interface HookEntry {
  type: 'http'
  url: string
}
interface HookGroup {
  hooks: HookEntry[]
}
export interface HookSettings {
  hooks: Record<string, HookGroup[]>
}

/**
 * The hook block itself — every REGISTERED_EVENTS key pointed at `hookUrl` (the session's channel
 * URL, `http://127.0.0.1:<port>/h/<token>/`).
 *
 * PURE on purpose: the shape is what claude actually consumes, so it is worth asserting
 * directly in a test without touching a filesystem.
 */
export function buildHookSettings(hookUrl: string): HookSettings {
  const hooks: Record<string, HookGroup[]> = {}
  for (const eventName of REGISTERED_EVENTS) {
    hooks[eventName] = [{ hooks: [{ type: 'http', url: hookUrl }] }]
  }
  return { hooks }
}

export interface HookSettingsFiles {
  /** Write the session's settings file for its channel `token`; its path, or null when the disk
   *  refused (logged by code). */
  write(sessionId: string, token: string): string | null
  /** `/clear` gave the session a new id; claude keeps the file it loaded. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: delete its file. */
  remove(sessionId: string): void
  /** At start: delete every file a previous run left (each token in it died with that run). */
  clearStale(): void
}

/**
 * The per-session hook settings files, in the app's OWN data dir (never a project).
 *
 * NEVER-LOG-THE-VALUE: neither the path (it leaks the operator's filesystem layout) nor the
 * content (its URLs hold the token) is ever logged. Code only.
 */
export function createHookSettingsFiles(options: {
  /** `app.getPath('userData')`, read when a file is written. */
  dir: () => string
  log: (line: string) => void
  /** The port the URLs name (default: the profile's hook port). */
  port?: number
}): HookSettingsFiles {
  const port = options.port ?? PORT
  const files: SessionFiles = createSessionFiles({
    dir: options.dir,
    dirname: 'hooks',
    prefix: '[claude-watcher][hooks]',
    code: 'hook_settings',
    log: options.log
  })
  return {
    write: (sessionId, token) =>
      files.write(
        sessionId,
        JSON.stringify(buildHookSettings(`${hookChannelBase(port, token)}/`), null, 2)
      ),
    rebind: files.rebind,
    remove: files.remove,
    clearStale: files.clearStale
  }
}

/** At start: delete the shared settings file an earlier build left in `dir`; gone already is fine. */
export function removeLegacyHookSettings(dir: string, log: (line: string) => void): void {
  try {
    rmSync(join(dir, LEGACY_HOOK_SETTINGS_FILENAME), { force: true })
  } catch {
    log('[claude-watcher][hooks] code=hook_settings_remove_failed')
  }
}

export interface HookSettingsForSpawnDeps {
  /** The spawn's hook channel token; null when the hook port was not ours when it was minted. */
  token: string | null
  /** True only while THIS process's hook server is bound (serverHealth.hookListening). */
  listening: () => boolean
  /** The file write — `HookSettingsFiles.write` for the spawn's session in production. */
  write: (token: string) => string | null
  /** Told whether the write worked, so the banner can say so (UX-05). */
  written: (ok: boolean) => void
  log: (msg: string) => void
}

/**
 * The path to pass as `--settings`, or null to spawn WITHOUT hooks.
 *
 * SEC-6 — the hook URL is a fixed loopback port. If THIS process did not bind it, whoever did
 * (another app, another local user) would receive every prompt, `last_assistant_message` and
 * tool input of the session. So no bind, no `--settings`: the session runs without status, and
 * the server-health banner says why. Code only in the log, never the path.
 */
export function hookSettingsPathIfListening(deps: HookSettingsForSpawnDeps): string | null {
  const token = deps.token
  if (token === null || !deps.listening()) {
    deps.log('[c9watch][hookSettings] code=hook_server_not_listening')
    return null
  }
  let path: string | null = null
  try {
    path = deps.write(token)
  } catch {
    deps.log('[c9watch][hookSettings] code=hook_settings_unavailable')
  }
  deps.written(path !== null)
  return path
}
