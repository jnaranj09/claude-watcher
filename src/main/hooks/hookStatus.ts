// Hook-status feature — pure event-OBJECT → HookStatusChange mapper.
//
// Maps a validated Claude Code lifecycle hook EVENT to the appropriate reducer
// action. Phase 2 reads typed optional fields off the event (notification_type,
// tool_name, last_assistant_message) so hooks can express `needs-you` directly:
//   - Notification(permission_prompt) → NeedsPermission  (→ needs-you column)
//   - Elicitation / Notification(elicitation_*) → NeedsAttention (an MCP server asks — ST-6)
//   - PreToolUse(AskUserQuestion)     → NeedsAttention   (→ needs-you column)
//   - Stop ending in a prose question → NeedsAttention   (→ needs-you column)
//   - Stop w/ background_tasks running → Working (claude backgrounded a shell / armed a
//     monitor; the terminal says "1 shell still running", so the card says Working)
//   - Stop, otherwise                 → YourTurn         (→ needs-you column; the
//     deterministic your-turn floor — a turn NEVER ends idle straight from Stop)
// Returns `null` for any event we choose to ignore (idle_prompt — an interrupt, a /clear
// and the session:seen demotion own idle) or any unrecognized event name (future
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
import { STATUS_YOUR_TURN } from '../../shared/ipc/contract'
import { hasRunningBackgroundWork } from './backgroundTasks'

/**
 * `Notification` types for a dialog that waits on the operator with no hook to say it closed:
 * the same exits as a permission prompt (approval key, Stop, prompt, interrupt). Typeless dialogs
 * already arrive as `permission_prompt` (claude: `type ?? "permission_prompt"`). A teammate's
 * permission (`worker_permission_prompt`) and a blocked agent or teammate setup
 * (`agent_needs_input`) are the same kind of wait (ST-6, claude 2.1.289 trace).
 */
const DIALOG_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'permission_prompt',
  'worker_permission_prompt',
  'agent_needs_input'
])

/** `Notification` types for an MCP server's input form or link (ST-6, claude 2.1.289 trace). */
const ELICITATION_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'elicitation_dialog',
  'elicitation_url_dialog'
])

/**
 * An MCP server waits for the operator's input. NOT a permission: no tool is named and no key
 * answers it (Enter may only move between form fields); `ElicitationResult` or the MCP tool's own
 * `PostToolUse` ends it. Marked like a tool event so it never pulls a card out of an open
 * permission prompt (R20) nor drops that prompt's bookkeeping (ST-1).
 */
const ELICITATION_OPEN: HookStatusChange = {
  kind: 'status',
  status: 'NeedsAttention',
  fromTool: true
}

/** `PreCompact` / `PostCompact` `trigger` for the operator's own `/compact` (the other is
 *  `auto`, claude 2.1.289 binary). */
const MANUAL_COMPACT = 'manual'

/** The tool call an event belongs to: its `tool_use_id` and, for a subagent, its `agent_id`. */
function toolCall(evt: HookEvent): { toolUseId?: string; agentId?: string } {
  return {
    ...(evt.tool_use_id === undefined ? {} : { toolUseId: evt.tool_use_id }),
    ...(evt.agent_id === undefined ? {} : { agentId: evt.agent_id })
  }
}

/**
 * Map a validated Claude Code lifecycle hook event to a `HookStatusChange`, or
 * `null` if the event should be ignored.
 *
 * Mapping:
 * - `Notification` & `permission_prompt` | `worker_permission_prompt` | `agent_needs_input`
 *   → `NeedsPermission` (a dialog waits on the operator — ST-6)
 * - `Notification` & `elicitation_dialog` | `elicitation_url_dialog`, and `Elicitation`
 *   → `NeedsAttention` (an MCP server asks for input; never out of `NeedsPermission` — ST-6)
 * - `ElicitationResult` → `Working` (the form was answered; never out of `NeedsPermission`)
 * - `Notification` & `idle_prompt` (or any other type)          → `null` (ignore — Stop owns idle)
 * - `PermissionRequest` → `NeedsPermission`, naming the tool (a dialog just opened — ST-5);
 *   `tool_name === 'AskUserQuestion'` → `null` (its `PreToolUse` already said `NeedsAttention`)
 * - `PreToolUse` & `tool_name === 'AskUserQuestion'`            → `NeedsAttention`
 * - `PreToolUse` (other) | `UserPromptSubmit` | `PostToolUse` | `PostToolUseFailure` → `Working`;
 *   tool events carry `tool_use_id`/`agent_id`, and the finished call that opened a prompt clears
 *   it (ST-1)
 * - `Stop` → `NeedsAttention` if `last_assistant_message` ends in a question;
 *            else `Working` if the payload's `background_tasks` still lists running work;
 *            else `YourTurn` (deterministic your-turn floor — ANY other Stop,
 *            including an absent message, is the operator's turn; a turn never
 *            ends idle straight from Stop — idle comes only from an interrupt, a
 *            `/clear` or the `session:seen` demotion)
 * - `StopFailure` → `YourTurn` (an API error ended the turn; no `Stop` follows — ST-3)
 * - `PreCompact` & `trigger: "manual"` → `Working`; `PostCompact` & `trigger: "manual"` →
 *   `YourTurn` (the operator's /compact — ST-8); any other trigger (auto, mid-turn) → `null`
 * - `SessionEnd` → `{ kind: 'removed' }`
 * - anything else → `null` (future events ignored, never fail-closed on an unknown name).
 *   `SessionStart` is one: claude never sends it to an http hook (ST-7)
 *
 * This is a PURE function: no side-effects, no I/O, no logging (the event fields
 * are SENSITIVE — never log `evt` or any field), deterministic.
 */
export function hookStatus(evt: HookEvent): HookStatusChange | null {
  switch (evt.hook_event_name) {
    case 'Notification':
      // A dialog that waits on the operator drives needs-you (ST-6). idle_prompt (a ~60s
      // debounce) and any other notification type are ignored — Stop owns idle.
      if (DIALOG_NOTIFICATIONS.has(evt.notification_type ?? '')) {
        return { kind: 'status', status: 'NeedsPermission' }
      }
      return ELICITATION_NOTIFICATIONS.has(evt.notification_type ?? '') ? ELICITATION_OPEN : null

    case 'Elicitation':
      // An MCP server asks the operator for input (a form or a link), the instant it asks; its
      // Notification comes 6 s later (ST-6). Answered with an empty 200, never an action.
      return ELICITATION_OPEN

    case 'ElicitationResult':
      // The operator answered the form (accept, decline or cancel): the MCP tool runs on (ST-6).
      // Marked like a tool event: it never closes a permission prompt open beside it (R20).
      return { kind: 'status', status: 'Working', fromTool: true }

    case 'PermissionRequest':
      // claude sends this the instant a permission dialog opens, and only then (an auto-allowed
      // tool sends none); Notification(permission_prompt) follows 6 s later (ST-5). NOT a tool
      // event: it must be able to put the card INTO NeedsPermission. AskUserQuestion is left out:
      // its own PreToolUse already set NeedsAttention in the same instant.
      // It opens a prompt for the same agent's last PreToolUse; that call finishing closes it (ST-1).
      if (evt.tool_name === 'AskUserQuestion') return null
      return {
        kind: 'status',
        status: 'NeedsPermission',
        ...(evt.tool_name === undefined ? {} : { toolName: evt.tool_name }),
        ...(evt.agent_id === undefined ? {} : { agentId: evt.agent_id }),
        opensPrompt: true
      }

    case 'PreToolUse': {
      // AskUserQuestion is a deterministic "blocking on a structured question" signal, and the
      // question is a prompt its own PostToolUse closes (ST-1).
      const asks = evt.tool_name === 'AskUserQuestion'
      return {
        kind: 'status',
        status: asks ? 'NeedsAttention' : 'Working',
        ...(evt.tool_name === undefined ? {} : { toolName: evt.tool_name }),
        fromTool: true,
        ...toolCall(evt),
        ...(asks ? { opensPrompt: true } : {})
      }
    }

    case 'PostToolUse':
    case 'PostToolUseFailure':
      // The tool call is over (a failing one ends with PostToolUseFailure). If it opened the
      // prompt the card waits on, this clears it — a click or shift+tab answer sends nothing else.
      return { kind: 'status', status: 'Working', fromTool: true, ...toolCall(evt), toolDone: true }

    case 'UserPromptSubmit':
      return { kind: 'status', status: 'Working' }

    case 'Stop':
      // A turn that ends by asking flips to needs-you; ANY other Stop is deterministically
      // the operator's turn (spec DA-1: the your-turn floor — never idle straight from Stop;
      // idle is reached only via an interrupt, a /clear or the session:seen demotion).
      // A QUESTION always wins: claude asked the operator something, and a background
      // task running alongside it does not make that question wait.
      if (endsWithQuestion(evt.last_assistant_message)) {
        return { kind: 'status', status: 'NeedsAttention' }
      }
      // Claude's own `background_tasks` list says whether a shell or monitor is still
      // running: the card says Working, as the terminal does ("1 shell still running"). R5 made
      // this a quiet your-turn, and looking at the session then demoted it to Idle with the shell
      // still running (operator, 2026-09-29). Working raises nothing; Esc still drops to idle.
      if (hasRunningBackgroundWork(evt)) {
        return { kind: 'status', status: 'Working' }
      }
      return { kind: 'status', status: STATUS_YOUR_TURN }

    case 'StopFailure':
      // An API error (rate limit, overload, network, bad model) ends the turn with this event
      // and NO Stop (ST-3). claude is back at the prompt, so it is the operator's turn. Always
      // YourTurn: the message is claude's error text, not a question, and the turn is over even
      // with background work running.
      return { kind: 'status', status: STATUS_YOUR_TURN }

    case 'PreCompact':
      // The operator ran /compact: claude summarizes the conversation (~13 s in probe S11) and
      // sends no other event (ST-8). An auto compact (context full) runs inside a turn that
      // already says Working, so it is left alone: it must not touch an open prompt.
      return evt.trigger === MANUAL_COMPACT ? { kind: 'status', status: 'Working' } : null

    case 'PostCompact':
      // The manual compaction is over and claude waits at the prompt: the operator's turn, as
      // after any finished turn. A failed compact sends no PostCompact (the next prompt, Esc or
      // Ctrl+C moves the card). Auto: mid-turn, ignored (it must not end the turn early).
      return evt.trigger === MANUAL_COMPACT ? { kind: 'status', status: STATUS_YOUR_TURN } : null

    case 'SessionEnd':
      return { kind: 'removed' }

    default:
      // Unknown event: no-op. Future claude hook event names must not fail the server.
      return null
  }
}

/**
 * The status a `SessionEnd` gives the card it KEEPS (its pty is still alive, so it is an id change,
 * not an exit — sessionRebind.ts PART 1), or `null` to leave the status alone.
 *
 * `reason: "clear"` → `WaitingForInput`: the operator ran /clear and claude sits at an empty
 * prompt. It is the only /clear signal an http hook gets — claude refuses http hooks for
 * `SessionStart` (ST-7, probe claude 2.1.289). Any other reason is unprobed on a live pty and keeps
 * the status: a `SessionEnd` just before a real exit must not flash the card idle.
 *
 * Pure, like `hookStatus`; never logs a field.
 */
export function clearedSessionStatus(evt: HookEvent): HookStatusChange | null {
  if (evt.hook_event_name !== 'SessionEnd' || evt.reason !== 'clear') return null
  return { kind: 'status', status: 'WaitingForInput' }
}
