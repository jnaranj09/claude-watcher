// Approval key — "did the operator just answer claude's permission prompt?" (R4, R20 in
// docs/reports/2026-09-23-bug-hunt).
//
// WHY. claude sends NO hook when a permission prompt is approved: the next event is the
// approved tool's `PostToolUse`, which for a long Bash command comes minutes later. Until then
// the card stayed gold, the badge counted it and the 2/6/14-minute reminders fired for a
// prompt the operator had already answered. And since R20 a tool event can no longer clear
// `NeedsPermission` at all (a parallel subagent's events used to), so the keystroke is now the
// main way out of it besides a prompt, a Stop or an interrupt.
//
// WHICH KEYS. Enter (the highlighted option, `1. Yes` by default), `1` and `2` (the two "yes"
// options). `3` / Escape is "no" — Escape already runs the interrupt path. EXACT match, like
// `isInterruptKey`: a paste or a typed word containing a `1` is not an answer.
//
// THE KNOWN FALSE POSITIVE. Enter on an option the operator arrowed down to (`No`) also reads
// as an approval, and the card shows Working while claude waits for their instructions. The
// operator is looking at that terminal when it happens, and their next prompt corrects it.
// Accepted by the operator (2026-09-28).
//
// PURE: never logs `data` (it is what the operator types).

import type { HookStatusChange } from '../c9watch/reducer'

const APPROVAL_KEYS: ReadonlySet<string> = new Set(['\r', '1', '2'])

/** The status change an input chunk causes on a card in `status`, or null for none. */
export function approvalStatusChange(
  status: string | undefined,
  data: string
): HookStatusChange | null {
  if (status !== 'NeedsPermission' || !APPROVAL_KEYS.has(data)) return null
  return { kind: 'status', status: 'Working' }
}
