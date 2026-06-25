// Hook-status feature — pure event-name → HookStatusChange mapper.
//
// Maps a Claude Code lifecycle hook event name to the appropriate reducer action.
// Returns `null` for any unrecognized event name (future events pass through the
// HTTP boundary but are quietly ignored). This is the ONLY place the mapping lives.
//
// Using type-only import for HookStatusChange (consistent-type-imports enforced by
// ESLint). The reducer does NOT import this module — the hooks layer owns the
// consumer-side mapping; the reducer owns the HookStatusChange input contract.
// [.claude/rules/ipc.md; spec Code Map]

import type { HookStatusChange } from '../c9watch/reducer'

/**
 * Map a Claude Code lifecycle hook event name to a `HookStatusChange`, or `null`
 * if the event name is unrecognized / should be ignored.
 *
 * Mapping (from the I/O matrix):
 * - `UserPromptSubmit` | `PreToolUse` | `PostToolUse` | `SessionStart` → `Working`
 * - `Stop` → `WaitingForInput`
 * - `SessionEnd` → `{ kind: 'removed' }`
 * - anything else → `null` (future events ignored, never fail-closed on an unknown name)
 *
 * This is a PURE function: no side-effects, no I/O, deterministic.
 */
export function hookStatus(name: string): HookStatusChange | null {
  switch (name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'SessionStart':
      return { kind: 'status', status: 'Working' }

    case 'Stop':
      return { kind: 'status', status: 'WaitingForInput' }

    case 'SessionEnd':
      return { kind: 'removed' }

    default:
      // Unknown event: no-op. Future claude hook event names must not fail the server.
      return null
  }
}
