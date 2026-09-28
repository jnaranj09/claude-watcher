// Hook-status feature — single source of truth for hook constants.
//
// Imported by hookServer.ts (the HTTP listener) and hookSettingsFile.ts (the `--settings`
// flag file handed to each spawned claude). The reducer does NOT import this module (it must
// not depend on the hooks layer). [.claude/rules/zod-boundaries.md; spec Code Map]

import { PROFILE } from '../profile'

/** Localhost-only bind address. NEVER 0.0.0.0. */
export const HOST = '127.0.0.1'

/** HTTP port the hook listener binds to (Ask-First decision: 9279; `npm run dev` uses the dev
 *  profile's own port so it can run beside the installed app — `../profile.ts`). */
export const PORT = PROFILE.hookPort

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

// NOTE (Story 6.4): `HOOK_AUTHORITY_MS` (the hook-vs-c9watch authority window) was
// removed with the c9watch CLI — hooks are the ONLY status source now, so there is
// no competing poll to outrank.

/**
 * Maximum accepted HTTP request body size in bytes.
 * Most hook payloads are compact JSON, but a `PostToolUse` carries the tool's whole input and
 * response: a large Write/Edit went past the old 1 MiB, the event was dropped and the card kept
 * its old status (R22 in docs/reports/2026-09-23-bug-hunt). 8 MiB on a loopback listener.
 */
export const MAX_BODY_BYTES = 8 * 1024 * 1024 // 8 MiB
