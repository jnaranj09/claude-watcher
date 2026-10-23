// Pure detector for the `Needs you:` marker: claude is told (QUESTION_FORMAT_PROMPT) to end a
// turn that is blocked on the user with a last line starting with this token, in English even
// when it replies in another language. Read from the Stop hook's `last_assistant_message`.
//
// PURE: no I/O, no logging, deterministic. The argument is SENSITIVE (assistant text) — this
// module MUST NEVER log it. [.claude/rules/zod-boundaries.md]

import { FENCED_CODE_BLOCK } from './endsWithQuestion'

/** The token claude writes to say a turn is blocked on the user. One owner: the prompt
 *  sentence in `pty/claudeBin.ts` and this detector both read it. */
export const NEEDS_YOU_MARKER = 'Needs you:'

/** How many trailing non-empty lines are scanned for the marker. */
const LINE_SCAN_WINDOW = 3

/** Markdown wrappers that may precede the marker: quote, list bullet, emphasis, whitespace. */
const LEADING_WRAPPERS = /^[>\-*_\s]+/

/**
 * `true` iff one of the last `LINE_SCAN_WINDOW` non-empty lines (complete fenced code blocks
 * stripped first) starts with `NEEDS_YOU_MARKER`, after leading markdown wrappers.
 * `**Needs you:** x` passes because the colon sits inside the emphasis.
 * `undefined` / empty / whitespace-only → `false`. NEVER logs `message`.
 */
export function endsWithNeedsYou(message: string | undefined): boolean {
  if (message === undefined) return false
  const lines = message
    .replace(FENCED_CODE_BLOCK, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  return lines
    .slice(-LINE_SCAN_WINDOW)
    .some((line) => line.replace(LEADING_WRAPPERS, '').startsWith(NEEDS_YOU_MARKER))
}
