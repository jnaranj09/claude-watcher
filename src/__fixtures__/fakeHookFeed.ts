// Story 6.4 — the deterministic FAKE HOOK FEED (the native-engine test double).
//
// Replaces `fakeC9watchFeed.ts` (retired with the c9watch CLI). A test double for the
// Claude Code lifecycle hook POSTs the app ingests at `http://127.0.0.1:9279/`, so the
// hook boundary (`src/shared/schemas/hookEvent.ts`) and its consumers can be verified
// WITHOUT a live claude. It is GROUNDED in the observed claude 2.1.199 payload shape
// (P0 spike 2026-06-24 on 2.1.190, re-verified on 2.1.199 in the Epic-6 keystone spike):
//
//   - every event carries `session_id` (== the launch-minted `--session-id` uuid ==
//     the transcript-filename uuid) + `cwd` + `transcript_path`,
//   - `Notification` carries `notification_type` (`permission_prompt` is the needs-you
//     driver; `idle_prompt` is a ~60s debounce and is ignored — Stop owns idle),
//   - `PreToolUse` carries `tool_name` (+ a `tool_input` payload — SENSITIVE, absorbed
//     by `.passthrough()`, never validated or logged),
//   - `Stop` carries `last_assistant_message` (SENSITIVE — the trailing-'?' question
//     heuristic reads it; it must NEVER be logged),
//   - `SessionEnd` carries a `reason`.
//
// Ordered like a real session's life: prompt → structured question → permission →
// Stop-with-question → Stop-idle → SessionEnd, with exactly ONE malformed body
// interleaved BETWEEN good ones (the fail-closed replay test: one bad POST never
// poisons the stream, and its body is never logged).
//
// SCHEMA-VERSIONED from day one: `HOOK_FIXTURE_VERSION` makes a future claude payload
// drift a one-line bump, not a hunt.

/**
 * The claude version whose hook payload shape this fixture mirrors. Bump when the
 * observed wire shape drifts.
 */
export const HOOK_FIXTURE_VERSION = '2.1.199' as const

/** The one session all good bodies belong to (the launch-minted uuid). */
export const FAKE_HOOK_SESSION_ID = 'aaaaaaaa-1111-4111-8111-111111111111'

/** Common fields every observed 2.1.199 hook payload carries. */
const common = {
  session_id: FAKE_HOOK_SESSION_ID,
  transcript_path: `/home/u/.claude/projects/-home-u-projects-auth-service/${FAKE_HOOK_SESSION_ID}.jsonl`,
  cwd: '/home/u/projects/auth-service'
} as const

/**
 * The hook POST bodies as an array of RAW strings — exactly what the listener's
 * request-body reader hands to the JSON boundary, one body per POST.
 *
 * Layout (CRITICAL for the fail-closed test): the malformed body sits BETWEEN two
 * good ones, so the test proves one bad POST does not poison the good ones.
 *
 *   [0] good — UserPromptSubmit                    → Working
 *   [1] good — PreToolUse(AskUserQuestion)         → NeedsAttention (needs-you)
 *   [2] BAD  — truncated garbage (a corrupt body). Must be DROPPED + logged-by-path.
 *   [3] good — Notification(permission_prompt)     → NeedsPermission (needs-you)
 *   [4] good — Stop, message ends in '?'           → NeedsAttention (needs-you)
 *   [5] good — Stop, plain prose                   → WaitingForInput (idle)
 *   [6] good — SessionEnd                          → session.removed
 */
export const fakeHookBodies: readonly string[] = [
  // [0] the operator submitted a prompt — the session is Working.
  JSON.stringify({
    ...common,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Refactor the auth middleware to use the new token format.'
  }),
  // [1] claude is blocking on a STRUCTURED question (AskUserQuestion) → needs-you.
  JSON.stringify({
    ...common,
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {
      question: 'Which file should I edit — auth.ts or token.ts?',
      options: ['auth.ts', 'token.ts']
    }
  }),
  // [2] BAD — corrupt/truncated body (a flushed-mid-write POST). NOT valid JSON →
  // dropped + logged by path+code only; the fragment below must never leak to a log.
  '{"session_id":"bbbbbbbb-2222-4222-8222-2222',
  // [3] a permission prompt — the immediate needs-you driver (idle_prompt is ignored).
  JSON.stringify({
    ...common,
    hook_event_name: 'Notification',
    notification_type: 'permission_prompt',
    message: 'Claude needs your permission to use Bash'
  }),
  // [4] the turn ended by ASKING the operator something (trailing '?') → needs-you.
  JSON.stringify({
    ...common,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message:
      'I found two candidates. Which file should I edit — auth.ts or token.ts?'
  }),
  // [5] the turn ended in plain prose → idle (WaitingForInput).
  JSON.stringify({
    ...common,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done — edited token.ts and updated the tests.'
  }),
  // [6] the session ended → session.removed.
  JSON.stringify({
    ...common,
    hook_event_name: 'SessionEnd',
    reason: 'exit'
  })
] as const

/** Index of the single malformed body in `fakeHookBodies` (for test assertions). */
export const MALFORMED_BODY_INDEX = 2

/** Count of well-formed (parseable + schema-valid) bodies in `fakeHookBodies`. */
export const VALID_HOOK_BODY_COUNT = fakeHookBodies.length - 1

// ---------------------------------------------------------------------------------------
// Name-sync — the OBSERVED claude 2.1.243 payload shape, captured from a live probe run
// (two runs, identical). The bodies above mirror 2.1.199 and predate several fields; these
// record what the wire ACTUALLY carries now, so a schema that silently stops accepting real
// traffic gets caught here rather than in production.
//
// The values are invented; only the KEY SETS and `session_title`'s presence are real. Real
// captures carry prompts and filesystem paths — never commit those.
// ---------------------------------------------------------------------------------------

/** The claude version the name-sync bodies below were captured from. */
export const HOOK_NAME_SYNC_FIXTURE_VERSION = '2.1.243' as const

/** Observed `UserPromptSubmit` key set on 2.1.243. This is the ONLY event verified to carry
 *  `session_title` — claude's own current name for the session, the read-back half of the
 *  naming feature. `permission_mode` and `prompt_id` are also new since 2.1.199 and must ride
 *  through `.passthrough()` untouched. */
export const fakeUserPromptSubmitBody = JSON.stringify({
  session_id: FAKE_HOOK_SESSION_ID,
  transcript_path: `/home/u/.claude/projects/-home-u-projects-auth-service/${FAKE_HOOK_SESSION_ID}.jsonl`,
  cwd: '/home/u/projects/auth-service',
  hook_event_name: 'UserPromptSubmit',
  permission_mode: 'default',
  prompt_id: 'bbbbbbbb-2222-4222-8222-222222222222',
  prompt: 'a prompt — SENSITIVE, absorbed by passthrough, never logged',
  session_title: 'billing api'
})

/** Observed `Stop` key set on 2.1.243 — note it carries NO `session_title`. If the schema
 *  ever made that field required, every Stop would fail closed and the board would stop
 *  tracking idle entirely. */
export const fakeStopBodyNoTitle = JSON.stringify({
  session_id: FAKE_HOOK_SESSION_ID,
  transcript_path: `/home/u/.claude/projects/-home-u-projects-auth-service/${FAKE_HOOK_SESSION_ID}.jsonl`,
  cwd: '/home/u/projects/auth-service',
  hook_event_name: 'Stop',
  permission_mode: 'default',
  prompt_id: 'bbbbbbbb-2222-4222-8222-222222222222',
  stop_hook_active: false,
  background_tasks: [],
  session_crons: [],
  effort: 'medium',
  last_assistant_message: 'Done — edited token.ts and updated the tests.'
})
