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
 *
 * Name-sync: `session_title` is claude's OWN current name for the session — the read-back
 * half of the naming feature (main renames the card to match it, so a collision suffix, a
 * hand-typed `/rename`, or a plan-accept retitle all reach the board). Verified live on
 * claude 2.1.243 to ride `UserPromptSubmit` ONLY — `Stop`/`SessionEnd` do NOT carry it, so
 * it MUST stay optional. It is OPERATOR CONTENT: never log the value, on any path.
 */
export const HookEventSchema = z
  .object({
    session_id: z.string().min(1), // stable UUID — the identity key; blank fails closed
    hook_event_name: z.string(), // lifecycle event name; NOT enum-locked
    cwd: z.string().optional(), // working dir (verified in P0 spike); safe to capture
    notification_type: z.string().optional(), // Notification kind (e.g. permission_prompt); NOT enum-locked
    tool_name: z.string().optional(), // PreToolUse tool name (e.g. AskUserQuestion); NOT enum-locked
    last_assistant_message: z.string().optional(), // Stop prose (SENSITIVE — never log the value)
    session_title: z.string().optional(), // claude's CURRENT name for the session (SENSITIVE — never log)
    // The session's JSONL transcript. Promoted from passthrough because the app TAILS it
    // for the two facts no hook reports: the turn was interrupted (Esc fires no hook at
    // all) and a background task finished (there is no "task done" hook). Verified present
    // on every event type, claude 2.1.248/2.1.250. SENSITIVE — the path embeds the project
    // directory, so it is never logged; the file's CONTENTS are the operator's whole
    // conversation and are never logged either. [transcriptWatcher.ts]
    transcript_path: z.string().optional(),
    // The `Stop` payload's list of background work claude still has running — the direct
    // answer to "is this turn end really the operator's turn?", verified live on claude
    // 2.1.250 through an `http` hook. Left as `unknown` rather than a shape: it is
    // claude's structure to change, and a shape drift must never fail the event closed
    // (the reader narrows it defensively instead). SENSITIVE — the entries carry the
    // operator's COMMAND LINES; never log this value. [backgroundTasks.ts]
    background_tasks: z.unknown().optional()
  })
  .passthrough() // absorbs remaining prompt/tool_input fields without validating

/**
 * The hook event type — INFERRED from the schema (one source of truth, never a
 * hand-written type beside it). [Source: architecture.md#Naming Patterns]
 */
export type HookEvent = z.infer<typeof HookEventSchema>
