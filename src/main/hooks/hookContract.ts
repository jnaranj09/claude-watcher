// Hook-status feature — single source of truth for hook constants.
//
// Imported by hookServer.ts (the HTTP listener) and registerHooks.ts (the settings
// merger). The REDUCER receives only `HOOK_AUTHORITY_MS` from its caller — it does NOT
// import this module (the reducer must not depend on the hooks layer).
// [.claude/rules/zod-boundaries.md; spec Code Map]

/** Localhost-only bind address. NEVER 0.0.0.0. */
export const HOST = '127.0.0.1'

/** HTTP port the hook listener binds to (Ask-First decision: 9279). */
export const PORT = 9279

/** The full URL Claude Code posts hook events to. */
export const HOOK_URL = `http://${HOST}:${PORT}/`

/**
 * The Claude Code lifecycle events we register for. Every event in this list
 * carries `session_id` (verified in the P0 spike, claude v2.1.190).
 *
 * - Active events (UserPromptSubmit / PreToolUse / PostToolUse / SessionStart) → `Working`
 * - Notification → carries `notification_type`: `permission_prompt` → `NeedsPermission`
 *   (immediate, sub-second); `idle_prompt` is ignored (~60s debounce — Stop owns idle)
 * - Stop → `WaitingForInput`
 * - SessionEnd → `session.removed`
 */
export const REGISTERED_EVENTS: readonly string[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'Notification',
  'Stop',
  'SessionEnd'
]

/**
 * How long (ms) a hook-set status outranks a stale c9watch-polled status.
 * After this window expires, the next c9watch line resumes authority.
 * Ask-First decision: 10 000 ms.
 */
export const HOOK_AUTHORITY_MS = 10_000

/**
 * Maximum accepted HTTP request body size in bytes.
 * Hook payloads are compact JSON; anything larger is suspicious / misconfigured.
 */
export const MAX_BODY_BYTES = 1024 * 1024 // 1 MiB
