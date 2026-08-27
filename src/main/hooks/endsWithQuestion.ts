// Hook-status feature — pure plain-prose question detector (L2).
//
// Answers one question: does this assistant message end by asking the user
// something? Drives the `Stop` branch of hookStatus — a turn that ends with a
// question flips the board to `needs-you` instead of `idle`.
//
// This is an URGENCY heuristic only: a miss now means the message lands as
// `YourTurn` instead of `NeedsAttention` — still needs-you either way (spec
// DA-1/DA-5). False positives are cheap for the same reason.
//
// PURE: no I/O, no logging, deterministic. The argument is
// `last_assistant_message`, which is SENSITIVE (PTY content / prompts / secrets) —
// this function MUST NEVER log it. [.claude/rules/zod-boundaries.md; plan L2 step 6]
//
// Fenced code blocks: a trailing ``` … ``` block is stripped from the message
// BEFORE splitting into lines. A question followed by a code block (e.g. "Should
// I continue?\n\n```\nnpm run test\n```") would otherwise push the question
// outside a fixed line-scan window no matter how wide that window is — the code
// block can be arbitrarily long. Only COMPLETE ```…``` pairs are stripped (matched
// non-greedily, so multiple pairs strip independently); an unclosed/unbalanced
// fence is left exactly as-is and scanned like ordinary text.

// Wrapper chars that can legitimately follow a trailing `?` (markdown emphasis,
// code spans, closing brackets/quotes). Stripped before testing the final char.
const TRAILING_WRAPPERS = new Set(['`', '*', '_', ')', ']', '"', "'", '”', '’'])

// Belt-and-suspenders tail window: how many trailing non-whitespace chars to scan
// for a `?` (covers `?)`, `?"`, `?**` even without the global instruction).
const TAIL_WINDOW = 8

/** How many trailing non-empty lines are scanned for a question tail. */
const LINE_SCAN_WINDOW = 3

/** Matches complete fenced code blocks (```…```), non-greedy so consecutive
 *  fenced blocks each match their own pair rather than spanning across both. */
const FENCED_CODE_BLOCK = /```[\s\S]*?```/g

/** Ask-phrases that mark a prose question without a `?`. Lower-case; matched as
 *  substrings of the LAST 2 non-empty lines only (a phrase early in a long reply is
 *  narration, not an ask). False positives are cheap: they upgrade YourTurn →
 *  NeedsAttention, both needs-you. */
const ASK_PHRASES = [
  'let me know',
  'should i',
  'would you like',
  'do you want',
  'please confirm',
  'which of',
  'tell me if'
] as const

/** Does this single line end in a `?` (after stripping trailing wrappers)? */
function lineEndsWithQuestionMark(line: string): boolean {
  const trimmed = line.replace(/\s+$/, '')
  if (trimmed.length === 0) return false
  let end = trimmed.length
  while (end > 0 && TRAILING_WRAPPERS.has(trimmed[end - 1]!)) end--
  if (end > 0 && trimmed[end - 1] === '?') return true
  const tail = trimmed.slice(Math.max(0, trimmed.length - TAIL_WINDOW))
  return tail.includes('?')
}

/**
 * `true` iff `message` ends by asking the user something.
 *
 * - `undefined` / empty / whitespace-only → `false`.
 * - Strips complete fenced code blocks first (see module note above).
 * - Layer 1: `true` if any of the last `LINE_SCAN_WINDOW` non-empty lines ends
 *   with a `?` (after stripping trailing wrapper chars, or within the last
 *   ~8 non-whitespace chars as a belt-and-suspenders check) — covers a question
 *   followed by bullet options or a code block.
 * - Layer 2: `true` if the last 2 non-empty lines contain a known ask-phrase
 *   (prose asks with no `?`, e.g. "Let me know which one you prefer.").
 *
 * PURE: no side-effects, no I/O, deterministic. NEVER logs `message`.
 */
export function endsWithQuestion(message: string | undefined): boolean {
  if (message === undefined) return false

  const withoutFences = message.replace(FENCED_CODE_BLOCK, '')
  const lines = withoutFences
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return false

  // Layer 1 — a `?` tail on any of the last LINE_SCAN_WINDOW non-empty lines
  // (covers "question, then bullet options / code block").
  for (const line of lines.slice(-LINE_SCAN_WINDOW)) {
    if (lineEndsWithQuestionMark(line)) return true
  }

  // Layer 2 — an ask-phrase in the last 2 non-empty lines (prose asks with no `?`).
  const tailText = lines.slice(-2).join('\n').toLowerCase()
  return ASK_PHRASES.some((p) => tailText.includes(p))
}
