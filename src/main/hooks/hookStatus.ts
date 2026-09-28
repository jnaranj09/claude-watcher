// Hook-status feature — pure event-OBJECT → HookStatusChange mapper.
//
// Maps a validated Claude Code lifecycle hook EVENT to the appropriate reducer
// action. Phase 2 reads typed optional fields off the event (notification_type,
// tool_name, last_assistant_message) so hooks can express `needs-you` directly:
//   - Notification(permission_prompt) → NeedsPermission  (→ needs-you column)
//   - PreToolUse(AskUserQuestion)     → NeedsAttention   (→ needs-you column)
//   - Stop ending in a prose question → NeedsAttention   (→ needs-you column)
//   - Stop w/ background_tasks running → YourTurnBackground (→ needs-you column, QUIETLY:
//     claude backgrounded a shell / armed a monitor and may wake itself; no alert — R5)
//   - Stop, otherwise                 → YourTurn         (→ needs-you column; the
//     deterministic your-turn floor — a turn NEVER ends idle straight from Stop)
// Returns `null` for any event we choose to ignore (idle_prompt — SessionStart +
// the session:seen demotion own idle) or any unrecognized event name (future
// events pass the HTTP boundary but are quietly ignored — never fail-closed on an
// unknown name). This is the ONLY place the mapping lives.
//
// Using type-only imports (consistent-type-imports enforced by ESLint). The reducer
// does NOT import this module — the hooks layer owns the consumer-side mapping; the
// reducer owns the HookStatusChange input contract.
// [.claude/rules/ipc.md; .claude/rules/zod-boundaries.md; spec Code Map]

import type { HookStatusChange } from '../c9watch/reducer'
import type { HookEvent } from '../../shared/schemas/hookEvent'
import { endsWithQuestion } from './endsWithQuestion'
import { STATUS_YOUR_TURN, STATUS_YOUR_TURN_BACKGROUND } from '../../shared/ipc/contract'
import { hasRunningBackgroundWork } from './backgroundTasks'

/**
 * Map a validated Claude Code lifecycle hook event to a `HookStatusChange`, or
 * `null` if the event should be ignored.
 *
 * Mapping:
 * - `Notification` & `notification_type === 'permission_prompt'` → `NeedsPermission`
 * - `Notification` & `idle_prompt` (or any other type)          → `null` (ignore — Stop owns idle)
 * - `PreToolUse` & `tool_name === 'AskUserQuestion'`            → `NeedsAttention`
 * - `PreToolUse` (other) | `UserPromptSubmit` | `PostToolUse` → `Working`
 * - `SessionStart` → `WaitingForInput`, except `source === 'compact'` → `null` (mid-turn, R19)
 * - `Stop` → `NeedsAttention` if `last_assistant_message` ends in a question;
 *            else `YourTurnBackground` if the payload's `background_tasks` still lists
 *            running work (the operator's turn, but quiet: claude may wake itself — R5);
 *            else `YourTurn` (deterministic your-turn floor — ANY other Stop,
 *            including an absent message, is the operator's turn; a turn never
 *            ends idle straight from Stop — idle comes only from `SessionStart`
 *            or the `session:seen` demotion)
 * - `SessionEnd` → `{ kind: 'removed' }`
 * - anything else → `null` (future events ignored, never fail-closed on an unknown name)
 *
 * This is a PURE function: no side-effects, no I/O, no logging (the event fields
 * are SENSITIVE — never log `evt` or any field), deterministic.
 */
export function hookStatus(evt: HookEvent): HookStatusChange | null {
  switch (evt.hook_event_name) {
    case 'Notification':
      // Only an immediate permission_prompt drives needs-you. idle_prompt (a ~60s
      // debounce) and any other notification type are ignored — Stop owns idle.
      return evt.notification_type === 'permission_prompt'
        ? { kind: 'status', status: 'NeedsPermission' }
        : null

    case 'PreToolUse': {
      // AskUserQuestion is a deterministic "blocking on a structured question" signal.
      const status = evt.tool_name === 'AskUserQuestion' ? 'NeedsAttention' : 'Working'
      return evt.tool_name === undefined
        ? { kind: 'status', status, fromTool: true }
        : { kind: 'status', status, toolName: evt.tool_name, fromTool: true }
    }

    case 'PostToolUse':
      return { kind: 'status', status: 'Working', fromTool: true }

    case 'UserPromptSubmit':
      return { kind: 'status', status: 'Working' }

    case 'SessionStart':
      // An auto-compact fires SessionStart in the MIDDLE of a turn: claude keeps working after
      // it. Mapping it to idle dropped a working card to idle for a moment and fired the
      // operator's idle rules (R19). The turn's own later events keep the status right.
      if (evt.source === 'compact') return null
      // Claude BOOTING (or resuming) is not claude's turn — after startup it sits at
      // the prompt waiting for the operator. Idle-by-truth; UserPromptSubmit is the
      // edge that flips a session to Working.
      return { kind: 'status', status: 'WaitingForInput' }

    case 'Stop':
      // A turn that ends by asking flips to needs-you; ANY other Stop is deterministically
      // the operator's turn (spec DA-1: the your-turn floor — never idle straight from Stop;
      // idle is reached only via SessionStart or the session:seen demotion).
      // A QUESTION always wins: claude asked the operator something, and a background
      // task running alongside it does not make that question wait.
      if (endsWithQuestion(evt.last_assistant_message)) {
        return { kind: 'status', status: 'NeedsAttention' }
      }
      // Claude's own `background_tasks` list says whether a shell or monitor is still
      // running. The turn is the operator's all the same, but claude may wake ITSELF when the
      // task finishes, so it is a QUIET your-turn: no popup, no sound (a monitor loop would
      // otherwise be a notification storm). It was `Working`, which a task that never ends —
      // a dev server — held forever (R5).
      if (hasRunningBackgroundWork(evt)) {
        return { kind: 'status', status: STATUS_YOUR_TURN_BACKGROUND }
      }
      return { kind: 'status', status: STATUS_YOUR_TURN }

    case 'SessionEnd':
      return { kind: 'removed' }

    default:
      // Unknown event: no-op. Future claude hook event names must not fail the server.
      return null
  }
}
