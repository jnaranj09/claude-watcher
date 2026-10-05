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
// NOT FOR AN OPEN QUESTION (ST-2). Enter on a multi-question AskUserQuestion answers question 1
// only; the next question and a "Submit answers" screen follow with no hook. So the change is
// marked `fromKey` and the reducer ignores it while an AskUserQuestion prompt is open: that
// question's own PostToolUse moves the card (ST-1). A regular permission prompt still needs the
// key: an approved long Bash command sends its PostToolUse minutes later.
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
  return { kind: 'status', status: 'Working', fromKey: true }
}

/**
 * The key seam (`watchFeed.keyLaunched`): apply the key's change and call `logAnswered` only when
 * it moved the card. The reducer returns [] for an open AskUserQuestion (ST-2): not an answer, so
 * nothing is logged. Returns the deltas to ship.
 */
export function applyApprovalKey<D>(
  status: string | undefined,
  data: string,
  apply: (change: HookStatusChange) => D[],
  logAnswered: () => void
): D[] {
  const change = approvalStatusChange(status, data)
  if (change === null) return []
  const deltas = apply(change)
  if (deltas.length > 0) logAnswered()
  return deltas
}
