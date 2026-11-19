// Pure text for a session started from goal tasks (spec 2026-10-19 goals, Claude integration).
// Main builds it from its own records on the launch path; the renderer and the API never supply
// any of these strings. Titles and names are schema-checked (goal.ts: no control characters, length
// caps), so each task stays on one line. Shell quoting happens at spawn (claudeBin), not here.
import type { TaskStatus } from '../../shared/schemas/goal'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'
import { cutToUnits } from '../../shared/textCut'

const ELLIPSIS = '…'

/** The awareness block for a worker session: its goal, its tasks, and (optionally) how to mark
 *  them done. With no goal it opens with the tasks-only line. */
export function buildWorkerPrompt(input: {
  goalName: string | null
  tasks: readonly { id: string; title: string }[]
  markDone: boolean
}): string {
  const head =
    input.goalName === null
      ? 'This session works on these tasks:'
      : `This session works on goal "${input.goalName}". Its tasks:`
  const lines = [head, ...input.tasks.map((t) => `- [${t.id}] ${t.title}`)]
  if (input.markDone) {
    lines.push('When you finish a task, call the mark_task_done tool with its id.')
  }
  return lines.join('\n')
}

/** The planner's prompt: the goal and its tasks, the three planning tools, and the rule that
 *  nothing starts until the operator accepts the split. */
export function buildPlannerPrompt(input: {
  goalName: string
  tasks: readonly { id: string; title: string; status: TaskStatus }[]
}): string {
  const lines = [`This session plans goal "${input.goalName}".`]
  if (input.tasks.length === 0) {
    lines.push('The goal has no tasks yet.')
  } else {
    lines.push('Its tasks now:')
    lines.push(...input.tasks.map((t) => `- [${t.id}] ${t.title} (${t.status})`))
  }
  lines.push(
    'Use list_tasks to see the tasks again when they change.',
    'Help the operator write the tasks with create_task. When the operator is ready, call propose_split with groups of task ids. One group becomes one session: group small related tasks together, and give each big task its own group.',
    'Nothing starts until the operator accepts the split.'
  )
  return lines.join('\n')
}

/** The session name for a launch from tasks: the first title, plus ` +N` for the other N-1.
 *  The title is cut and ends with `…` so the whole name fits `SESSION_NAME_MAX_LENGTH`. No titles
 *  gives '', which the name check refuses. */
export function taskSessionName(titles: readonly string[]): string {
  const first = titles[0]
  if (first === undefined) return ''
  const suffix = titles.length > 1 ? ` +${titles.length - 1}` : ''
  const room = SESSION_NAME_MAX_LENGTH - suffix.length
  if (first.length <= room) return first + suffix
  // No space before the …: a cut after a word reads "foo …", not "foo…".
  return cutToUnits(first, room - ELLIPSIS.length).trimEnd() + ELLIPSIS + suffix
}

/** The non-blank parts of a system prompt, joined by a blank line; null when none is left. */
export function joinSystemPrompt(...parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => p !== null && p.trim() !== '')
  return kept.length > 0 ? kept.join('\n\n') : null
}
