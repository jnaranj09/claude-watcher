// Name-sync — the pure hook-RESPONSE builder.
//
// Until this feature the hook server was write-only from claude's side: every valid POST got
// an empty 200. Claude's `type: "http"` hook actually READS the response body as hook output
// (verified in 2.1.243: `post(url, …, {responseType:"text"}) → {ok, statusCode, body}`), which
// is the one supported way to rename a session that is already running.
//
// This module owns WHAT to reply and nothing else — no I/O, no server, no clock — so the
// decision is unit-testable without binding a port.
//
// ONLY `UserPromptSubmit` gets a body. Two reasons, both load-bearing:
//   - it is the only event verified to accept `sessionTitle` in its output AND to carry
//     `session_title` on its input, so it is the one event where the name round-trips;
//   - `SessionStart` is deliberately NOT used: it was never observed firing under `claude -p`
//     so its behaviour is unverified, and it is pointless here anyway — the app always spawns
//     with `-n <name>` already correct, and a mid-session rename can never reach it.
//
// [spec-claude-session-name-sync.md; .claude/rules/zod-boundaries.md]

/** The hook event whose response can carry a session rename. NOT exported as an enum-ish
 *  union anywhere else — the server compares the incoming free-string event name to this. */
const RENAMEABLE_EVENT = 'UserPromptSubmit'

/**
 * Build the JSON response body for a validated hook event, or `null` to keep today's
 * empty 200.
 *
 * `takeTitle` is LAZY on purpose, and that laziness is load-bearing. The store's `take` is
 * read-AND-CLEAR, so calling it eagerly would let ANY event consume a pending rename: a
 * `Stop` or `PostToolUse` arriving before the operator's next prompt would swallow the name,
 * the builder would discard it (wrong event), and the rename would vanish without ever
 * reaching claude. Pulling the title only AFTER the event check means exactly one event can
 * consume it — the one that can actually deliver it.
 *
 * The returned string is a serialized `hookSpecificOutput` block. It is NEVER logged: it
 * carries an operator-typed session name.
 */
export function buildHookResponseBody(
  eventName: string,
  takeTitle: () => string | null
): string | null {
  if (eventName !== RENAMEABLE_EVENT) return null // do NOT consume — see above

  const title = takeTitle()
  if (title === null || title.length === 0) return null

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: RENAMEABLE_EVENT,
      sessionTitle: title
    }
  })
}
