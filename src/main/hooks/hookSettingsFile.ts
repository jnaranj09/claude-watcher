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
//   - a STALE `settings.local.json` block on the same URL is DEDUPED against the flag (one
//     POST, not two), so blocks left by the retired merger are harmless. That dedupe is what
//     keeps push-once safe: two POSTs for one prompt would let the second consume an already
//     -cleared pending title.
//
// [spec-zero-footprint-hooks.md; .claude/rules/zod-boundaries.md]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'

/** The file written inside the app's OWN data dir. Never inside a project. */
export const HOOK_SETTINGS_FILENAME = 'claude-hooks.settings.json'

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
 * The hook block itself — every REGISTERED_EVENTS key pointed at HOOK_URL.
 *
 * PURE on purpose: the shape is what claude actually consumes, so it is worth asserting
 * directly in a test without touching a filesystem.
 */
export function buildHookSettings(): HookSettings {
  const hooks: Record<string, HookGroup[]> = {}
  for (const eventName of REGISTERED_EVENTS) {
    hooks[eventName] = [{ hooks: [{ type: 'http', url: HOOK_URL }] }]
  }
  return { hooks }
}

export interface EnsureHookSettingsOptions {
  /** The app's own data dir (`app.getPath('userData')`) — NEVER a project directory. */
  dir: string
  /** Diagnostics sink. Receives a `code=` string ONLY. */
  log?: (msg: string) => void
}

/**
 * Ensure the hook settings file exists and is current; return its path for `--settings`.
 *
 * Called per spawn rather than once at startup so a deleted/edited file self-heals on the
 * next launch. The write is skipped when the content already matches, so the steady state
 * is a single read.
 *
 * FAIL-SOFT (never-crash): any IO failure returns `null` and the caller omits the flag. The
 * session still spawns — it just reports no status, exactly the degradation the retired
 * merger had. A throw here would fail the launch outright.
 *
 * NEVER-LOG-THE-VALUE: the path is never logged — it leaks the operator's filesystem layout
 * (same rule that keeps the resolved claude binary path out of the logs). Code only.
 */
export function ensureHookSettingsFile(options: EnsureHookSettingsOptions): string | null {
  const { dir, log } = options
  const path = join(dir, HOOK_SETTINGS_FILENAME)
  const desired = JSON.stringify(buildHookSettings(), null, 2)

  try {
    let current: string | null = null
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      current = null // missing / unreadable — fall through to the write
    }
    if (current !== desired) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, desired, 'utf8')
    }
    return path
  } catch {
    log?.('[c9watch][hookSettings] code=hook_settings_write_failed')
    return null
  }
}

export interface HookSettingsForSpawnDeps {
  /** True only while THIS process's hook server is bound (serverHealth.hookListening). */
  listening: () => boolean
  /** The file write — `ensureHookSettingsFile` in production. */
  ensure: () => string | null
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
  if (!deps.listening()) {
    deps.log('[c9watch][hookSettings] code=hook_server_not_listening')
    return null
  }
  let path: string | null = null
  try {
    path = deps.ensure()
  } catch {
    deps.log('[c9watch][hookSettings] code=hook_settings_unavailable')
  }
  deps.written(path !== null)
  return path
}
