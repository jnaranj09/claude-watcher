// Hook-status feature — the Zod identity adapter for the Claude Code lifecycle hook boundary.
//
// This is the fail-closed Zod boundary for inbound HTTP hook POSTs (sibling to
// src/shared/schemas/session.ts). Every hook body is validated at THIS single boundary.
// On bad input: drop + log PATH + CODE only — NEVER the body (payloads carry
// `prompt`/`tool_input`/`last_assistant_message` = secrets). [.claude/rules/zod-boundaries.md]
//
// Phase 1: working/idle status only. No timestamp field (no IsoToEpochMillis needed here).
// `.passthrough()` so additional claude hook fields pass through without failing.

import { z } from 'zod'

/**
 * The Claude Code lifecycle hook event shape (compact + safe-optional extras).
 *
 * `session_id` is the stable UUID that matches the c9watch `id` (verified in the P0
 * spike: every event carries session_id == transcript-filename UUID == c9watch identity).
 * Blank session_id fails closed (same min(1) discipline as SessionSchema's `id`).
 *
 * `hook_event_name` is the lifecycle event name string — NOT enum-locked (a new event
 * must pass through, not fail closed, so the hookStatus mapper returns null for unknown
 * events). `.passthrough()` so additional payload fields (cwd, last_assistant_message,
 * prompt, tool_input) are absorbed without being validated or logged.
 *
 * IMPORTANT: `.passthrough()` only absorbs UNKNOWN keys. The declared keys are still
 * strictly validated — blank session_id or missing hook_event_name will fail closed.
 *
 * Phase 2: `notification_type`, `tool_name`, and `last_assistant_message` are promoted
 * from passthrough extras to TYPED OPTIONALS so hookStatus can read them to drive
 * `needs-you`. They stay free strings (NOT enum-locked) — a new/unknown value must pass,
 * not fail closed. Absent is fine (optional); a present field of the WRONG TYPE still
 * fails closed (same min/strict discipline as the other declared keys).
 */
export const HookEventSchema = z
  .object({
    session_id: z.string().min(1), // stable UUID — the identity key; blank fails closed
    hook_event_name: z.string(), // lifecycle event name; NOT enum-locked
    cwd: z.string().optional(), // working dir (verified in P0 spike); safe to capture
    notification_type: z.string().optional(), // Notification kind (e.g. permission_prompt); NOT enum-locked
    tool_name: z.string().optional(), // PreToolUse tool name (e.g. AskUserQuestion); NOT enum-locked
    last_assistant_message: z.string().optional() // Stop prose (SENSITIVE — never log the value)
  })
  .passthrough() // absorbs remaining prompt/tool_input fields without validating

/**
 * The hook event type — INFERRED from the schema (one source of truth, never a
 * hand-written type beside it). [Source: architecture.md#Naming Patterns]
 */
export type HookEvent = z.infer<typeof HookEventSchema>
