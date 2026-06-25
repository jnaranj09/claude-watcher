// Hook-status feature — pure plain-prose question detector (L2).
//
// Answers one question: does this assistant message end by asking the user
// something? Drives the `Stop` branch of hookStatus — a turn that ends with a
// question flips the board to `needs-you` instead of `idle`.
//
// PURE: no I/O, no logging, deterministic. The argument is
// `last_assistant_message`, which is SENSITIVE (PTY content / prompts / secrets) —
// this function MUST NEVER log it. [.claude/rules/zod-boundaries.md; plan L2 step 6]

// Wrapper chars that can legitimately follow a trailing `?` (markdown emphasis,
// code spans, closing brackets/quotes). Stripped before testing the final char.
const TRAILING_WRAPPERS = new Set(['`', '*', '_', ')', ']', '"', "'", '”', '’'])

// Belt-and-suspenders tail window: how many trailing non-whitespace chars to scan
// for a `?` (covers `?)`, `?"`, `?**` even without the global instruction).
const TAIL_WINDOW = 8

/**
 * `true` iff `message` ends with a question.
 *
 * - `undefined` / empty / whitespace-only → `false`.
 * - Trims trailing whitespace, strips a small set of trailing wrapper chars that
 *   can follow the `?`, then tests the final char `=== '?'`.
 * - Belt-and-suspenders: also `true` if a `?` appears within the last ~8
 *   non-whitespace chars (covers `?)`, `?"`, `?**`, …).
 *
 * PURE: no side-effects, no I/O, deterministic. NEVER logs `message`.
 */
export function endsWithQuestion(message: string | undefined): boolean {
  if (message === undefined) return false

  // Trim trailing whitespace (incl. newlines); whitespace-only → false.
  const trimmed = message.replace(/\s+$/, '')
  if (trimmed.length === 0) return false

  // Strip trailing wrapper chars, then test the final char.
  let end = trimmed.length
  while (end > 0 && TRAILING_WRAPPERS.has(trimmed[end - 1]!)) end--
  if (end > 0 && trimmed[end - 1] === '?') return true

  // Belt-and-suspenders: a `?` within the last TAIL_WINDOW non-whitespace chars.
  const tail = trimmed.slice(Math.max(0, trimmed.length - TAIL_WINDOW))
  return tail.includes('?')
}
