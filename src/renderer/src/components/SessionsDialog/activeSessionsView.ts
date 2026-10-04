// The Active sessions page's rules, pure (spec 2026-10-03 D): which live sessions a scope and a
// search show and in what order, how long each has been in its status, and what a bulk Archive /
// Delete says afterwards. Kept out of the component so each is tested without rendering.
import type { Column } from '../../../../shared/ipc/contract'
import type { ExitOutcome, ExitVerb } from '../../lib/sessionExit'
import type { BoardSession } from '../../stores/boardStore'
import type { PastScope } from '../PastSessionsDialog/pastSessionsView'
import { scopeWorkspaceId } from '../ScopeFilter/scope'

/** Needs you first: attention is rationed and needs-you stays the loudest thing. */
const COLUMN_RANK: Record<Column, number> = { 'needs-you': 0, working: 1, idle: 2 }

export function activeRows(
  sessions: readonly BoardSession[],
  scope: PastScope,
  query: string
): BoardSession[] {
  const workspaceId = scopeWorkspaceId(scope)
  const q = query.trim().toLocaleLowerCase()
  return sessions
    .filter((s) => workspaceId === null || s.workspaceId === workspaceId)
    .filter((s) => q.length === 0 || s.sessionName.toLocaleLowerCase().includes(q))
    .sort(
      (a, b) =>
        COLUMN_RANK[a.column] - COLUMN_RANK[b.column] || a.enteredColumnAt - b.enteredColumnAt
    )
}

/** Three different nothings, three sentences (design.md "Scoped lists"). */
export function activeEmptyCopy(total: number, inScope: number): string {
  if (total === 0) return 'No sessions are running.'
  if (inScope === 0) return 'No sessions are running in this workspace.'
  return 'No sessions match your search.'
}

/** Time in the current status, short — the row's `Needs you · 4m`. */
export function statusAge(enteredAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - enteredAt) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const DONE: Record<ExitVerb, string> = { archive: 'Archived', delete: 'Deleted' }

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`)
  return quoted.length <= 1
    ? (quoted[0] ?? '')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/** What a bulk (or single) Archive / Delete says in the message slot: `Archived "api".`,
 *  `Archived 3 sessions.`, `Archived 2 sessions. Could not archive "web".` */
export function exitResultCopy(
  verb: ExitVerb,
  outcomes: readonly ExitOutcome[]
): { tone: 'success' | 'error'; text: string } {
  const done = outcomes.filter((o) => o.ok)
  const failed = outcomes.filter((o) => !o.ok)
  const donePart =
    done.length === 0
      ? ''
      : done.length === 1
        ? `${DONE[verb]} "${done[0]?.name ?? ''}".`
        : `${DONE[verb]} ${done.length} sessions.`
  if (failed.length === 0) return { tone: 'success', text: donePart }
  const failedPart = `Could not ${verb} ${quotedList(failed.map((o) => o.name))}.`
  return { tone: 'error', text: donePart === '' ? failedPart : `${donePart} ${failedPart}` }
}

/** StopConfirm's consequence sentence, beside an armed Delete (the dialog cannot open StopConfirm:
 *  no modal over a dialog). */
export function deleteConsequence(count: number): string {
  return count === 1
    ? "The session is stopped and nothing is kept in Past sessions. Claude's own files are not touched."
    : "The sessions are stopped and nothing is kept in Past sessions. Claude's own files are not touched."
}
