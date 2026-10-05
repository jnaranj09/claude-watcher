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
 * - Active events (UserPromptSubmit / PreToolUse / PostToolUse) → `Working`
 * - Notification → carries `notification_type`: `permission_prompt` → `NeedsPermission`
 *   (immediate, sub-second); `idle_prompt` is ignored (~60s debounce — Stop owns idle)
 * - PermissionRequest → `NeedsPermission` the instant a permission dialog opens; the
 *   `Notification(permission_prompt)` for it comes 6 s later (ST-5, probe claude 2.1.289).
 *   It is answered with an empty 200, never a decision: the app never allows or denies a tool
 * - PostToolUseFailure → like PostToolUse: an approved tool that fails ends with this instead,
 *   and it is the only event that can clear a prompt answered by click (ST-1)
 * - Stop → `WaitingForInput`
 * - StopFailure → `YourTurn`: an API error (rate limit, overload, network, bad model) ends the
 *   turn with this and NO `Stop` (ST-3, probe claude 2.1.289)
 * - Elicitation → `NeedsAttention` the instant an MCP server asks the operator for input (its
 *   `Notification(elicitation_dialog)` comes 6 s later); ElicitationResult → `Working` once the
 *   form is answered (ST-6, claude 2.1.289 trace). Both answered with an empty 200, never an
 *   action: a body could accept or decline the form for the operator
 * - PreCompact / PostCompact → `Working` / `YourTurn` for a manual `/compact`, the only events
 *   it sends (ST-8, probe claude 2.1.289); an auto compact is ignored. Answered with an empty
 *   200: a body could block the compaction
 * - SessionEnd → `session.removed`; on a live pty it is an id change (`/clear`), and
 *   `reason: "clear"` puts the kept card at idle (ST-7)
 *
 * NOT `SessionStart` or `Setup`: claude drops an http hook for those two before running it
 * ("HTTP hooks are not supported for SessionStart", claude 2.1.289 — ST-7), so registering one
 * only pretends. `/clear` is seen through `SessionEnd`; a fresh spawn stays `Connecting` (the
 * idle column) until its first prompt.
 */
export const REGISTERED_EVENTS: readonly string[] = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'Stop',
  'StopFailure',
  'Elicitation',
  'ElicitationResult',
  'PreCompact',
  'PostCompact',
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
