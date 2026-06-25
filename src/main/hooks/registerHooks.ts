// Hook-status feature — idempotent merger of the hook block into ~/.claude/settings.json.
//
// USER-scope registration: the hook is written to ~/.claude/settings.json so it covers
// ALL local Claude Code sessions (not just the per-project .claude/settings.json).
//
// Failure modes (must never clobber the user's global Claude config):
//   ENOENT → start from {}
//   Unparseable → back up (.corrupt-<epoch>.json) + SKIP (no clobber — this is a
//     user-global file, not the app's own settings; we never reset it to defaults).
//   Write failure → log + skip (best-effort; not fatal).
//
// Idempotency: dedupe by HOOK_URL. Existing hooks for any event key are preserved
// unchanged. We write ONLY if the merge produced a change (string compare).
// A one-time .bak backup is made before the first real write.
//
// [spec registerHooks.ts Code Map; .claude/rules/zod-boundaries.md persisted-file row]

import { readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { HOOK_URL, REGISTERED_EVENTS } from './hookContract'

const DEFAULT_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')

export interface RegisterHooksOptions {
  /**
   * Path to the Claude Code settings file. Defaults to `~/.claude/settings.json`.
   * Injectable so unit tests can use a temp file without touching the real config.
   */
  settingsPath?: string
  /** Log sink — code only, NEVER settings content. Defaults to console.warn. */
  log?: (message: string) => void
}

/**
 * Idempotently ensure the app's http hook block is present in the Claude Code user
 * settings file. Safe to call multiple times — dedupes by HOOK_URL.
 *
 * - ENOENT: starts from `{}` (fresh file).
 * - Unparseable: backs up + SKIPs (never clobbers the user's global Claude config).
 * - No change detected: skips the write.
 * - One-time .bak backup before the first real write.
 */
export function registerHooks(options: RegisterHooksOptions = {}): void {
  const settingsPath = options.settingsPath ?? DEFAULT_SETTINGS_PATH
  const log = options.log ?? ((msg: string): void => console.warn(msg))

  // 1. Read the current file.
  let raw: string | undefined
  try {
    raw = readFileSync(settingsPath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      raw = undefined // start from {}
    } else {
      log(`[c9watch][registerHooks] code=read_error`)
      return
    }
  }

  // 2. Parse (or start from {}).
  let parsed: Record<string, unknown>
  if (raw === undefined) {
    parsed = {}
  } else {
    try {
      const value: unknown = JSON.parse(raw)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not an object')
      }
      parsed = value as Record<string, unknown>
    } catch {
      // Unparseable: back up + SKIP (never clobber the user's global Claude config).
      try {
        const backupPath = settingsPath + `.corrupt-${Date.now()}.json`
        renameSync(settingsPath, backupPath)
        log(`[c9watch][registerHooks] code=settings_corrupt_backed_up`)
      } catch {
        log(`[c9watch][registerHooks] code=settings_backup_failed`)
      }
      // Skip — do NOT write defaults over a corrupt user-global file.
      return
    }
  }

  // 3. Idempotently merge the hook block.
  // Claude Code's hooks structure is:
  // { "hooks": { "<EventName>": [ { "hooks": [ { "type": "http", "url": "..." } ] } ] } }
  // We ensure each REGISTERED_EVENTS key has our HOOK_URL entry, deduped.
  const originalJson = JSON.stringify(parsed, null, 2)

  let hooksRoot = parsed['hooks']
  if (hooksRoot === null || typeof hooksRoot !== 'object' || Array.isArray(hooksRoot)) {
    hooksRoot = {}
  }
  const hooksMap = hooksRoot as Record<string, unknown>

  for (const eventName of REGISTERED_EVENTS) {
    let eventArr = hooksMap[eventName]
    if (!Array.isArray(eventArr)) {
      eventArr = []
    }
    const arr = eventArr as unknown[]

    // Check if our HOOK_URL is already present anywhere in this event's hook list.
    // Each element can be a hook-group object with a nested `hooks` array, or a
    // direct hook object. We look for our URL in any position to ensure deduplication.
    const alreadyPresent = arr.some((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false
      const group = entry as Record<string, unknown>
      // Check direct url field
      if (group['url'] === HOOK_URL) return true
      // Check nested hooks array
      const nested = group['hooks']
      if (Array.isArray(nested)) {
        return nested.some((h) => {
          if (h === null || typeof h !== 'object' || Array.isArray(h)) return false
          return (h as Record<string, unknown>)['url'] === HOOK_URL
        })
      }
      return false
    })

    if (!alreadyPresent) {
      // Add a new hook group for this event.
      arr.push({
        hooks: [{ type: 'http', url: HOOK_URL }]
      })
      hooksMap[eventName] = arr
    }
  }

  parsed['hooks'] = hooksMap

  const newJson = JSON.stringify(parsed, null, 2)

  // 4. Write only if the content changed.
  if (newJson === originalJson) {
    return // idempotent — nothing to write
  }

  // 5. One-time .bak backup before the first real write.
  if (raw !== undefined) {
    try {
      copyFileSync(settingsPath, settingsPath + '.bak')
    } catch {
      // Best-effort backup — do not block the write if it fails.
      log(`[c9watch][registerHooks] code=backup_failed`)
    }
  }

  // 6. Write the merged file ATOMICALLY (write a temp sibling, then rename) so a crash
  // mid-write can never corrupt the user's GLOBAL Claude config. Ensure the parent dir
  // exists first (a fresh machine may lack ~/.claude/).
  const tmpPath = settingsPath + '.tmp'
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    writeFileSync(tmpPath, newJson + '\n', 'utf8')
    renameSync(tmpPath, settingsPath)
  } catch {
    log(`[c9watch][registerHooks] code=write_failed`)
    // Best-effort cleanup of the temp file (ignore failure).
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}
