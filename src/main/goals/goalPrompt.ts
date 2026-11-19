// Pure text for a session started from goal tasks (spec 2026-10-19 goals, Claude integration).
// Main builds it from its own records on the launch path; the renderer and the API never supply
// any of these strings. Titles and names are schema-checked (goal.ts: no control characters, length
// caps), so each task stays on one line; the goal name of both first lines and every session name
// are also cleaned here (`promptSafeName`), since a memory goal's name is copied from a session
// name and a live session name is not schema-checked. Shell quoting still happens at spawn
// (claudeBin); the planner's list budget only measures lines with the same `shellQuote` (spec
// 2026-11-18 memory session goals, "Planner prompt").
import type { TaskStatus } from '../../shared/schemas/goal'
import { SESSION_NAME_MAX_LENGTH } from '../../shared/schemas/launch'
import { cutToUnits, toSafeLine } from '../../shared/textCut'
import { shellQuote } from '../pty/claudeBin'

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
      : `This session works on goal "${promptSafeName(input.goalName)}". Its tasks:`
  const lines = [head, ...input.tasks.map((t) => `- [${t.id}] ${t.title}`)]
  if (input.markDone) {
    lines.push('When you finish a task, call the mark_task_done tool with its id.')
  }
  return lines.join('\n')
}

/** The most session lines a planner prompt lists. A test keeps this export on purpose. */
export const PLANNER_SESSIONS_SHOWN = 20
/** The most task ids one session line names. A test keeps this export on purpose. */
export const PLANNER_SESSION_IDS_SHOWN = 20
/** The planner's task and session lines together, each measured quoted (`shellQuote`) plus its
 *  newline (spec Risks, Prompt size). A test keeps this export on purpose. */
export const PLANNER_LIST_BUDGET_BYTES = 16_384

/** A name as it goes into a prompt line: one clean line (`toSafeLine`), and `"`, `[` and `]`
 *  swapped for `’`, `(` and `)` so it cannot close the quotes or fake an id field (`’`, not `'`,
 *  which `shellQuote` grows to 4 bytes). */
function promptSafeName(name: string): string {
  return toSafeLine(name).replaceAll('"', '’').replaceAll('[', '(').replaceAll(']', ')')
}

/** What a line costs in the planner's list budget: its quoted UTF-8 bytes plus its newline.
 *  Quoting each line alone counts 2 bytes more than the real prompt, quoted once (a margin). */
function lineCost(line: string): number {
  return Buffer.byteLength(shellQuote(line)) + 1
}

function moreTasksLine(n: number): string {
  return `- ${n} more tasks: call list_tasks.`
}

const sum = (costs: readonly number[]): number => costs.reduce((a, b) => a + b, 0)

/** Step 1 of the budget: the task lines in array order, or, when they do not fit, the last done
 *  task dropped first (then the last open one) until the kept lines and the `more tasks` line fit.
 *  Returns the indexes kept, in array order, and the number dropped. */
function fitTaskLines(
  lines: readonly string[],
  statuses: readonly TaskStatus[]
): { kept: number[]; dropped: number } {
  const costs = lines.map(lineCost)
  const kept = new Set(lines.keys())
  const total = (): number => sum([...kept].map((i) => costs[i] ?? 0))
  if (total() <= PLANNER_LIST_BUDGET_BYTES) return { kept: [...kept], dropped: 0 }
  let dropped = 0
  for (;;) {
    const order = [...kept]
    const victim = order.findLast((i) => statuses[i] === 'done') ?? order.at(-1)
    if (victim === undefined) break
    kept.delete(victim)
    dropped++
    if (total() + lineCost(moreTasksLine(dropped)) <= PLANNER_LIST_BUDGET_BYTES) break
  }
  return { kept: [...kept], dropped }
}

/** The planner's prompt: the goal and its tasks, the sessions that worked on them, the three
 *  planning tools, and the rule that nothing starts until the operator accepts the split.
 *  `sessions` is the full list in `goalSessionOrder`'s order; this alone applies the list budget
 *  (`PLANNER_LIST_BUDGET_BYTES`) and the caps. `taskIds` are the tasks whose lines are kept, in
 *  their order: a task cut for room still reaches the memory index. */
export function buildPlannerPrompt(input: {
  goalName: string
  tasks: readonly { id: string; title: string; status: TaskStatus }[]
  sessions: readonly { name: string | null; id: string; taskIds: readonly string[] }[]
}): { text: string; taskIds: string[] } {
  const lines = [`This session plans goal "${promptSafeName(input.goalName)}".`]
  let taskIds: string[] = []
  if (input.tasks.length === 0) {
    lines.push('The goal has no tasks yet.')
  } else {
    const taskLines = input.tasks.map((t) => `- [${t.id}] ${t.title} (${t.status})`)
    const { kept, dropped } = fitTaskLines(
      taskLines,
      input.tasks.map((t) => t.status)
    )
    taskIds = kept.map((i) => input.tasks[i]?.id ?? '')
    const keptLines = kept.map((i) => taskLines[i] ?? '')
    if (dropped > 0) keptLines.push(moreTasksLine(dropped))
    lines.push('Its tasks now:', ...keptLines)
    lines.push(...sessionLines(input.sessions, new Set(taskIds), sum(keptLines.map(lineCost))))
  }
  lines.push(
    'Use list_tasks to see the tasks again when they change.',
    'Help the operator write the tasks with create_task. When the operator is ready, call propose_split with groups of task ids. One group becomes one session: group small related tasks together, and give each big task its own group.',
    'Nothing starts until the operator accepts the split.'
  )
  return { text: lines.join('\n'), taskIds }
}

/** Step 2 and 3 of the budget: one line per session in the given order, naming its first
 *  `PLANNER_SESSION_IDS_SHOWN` kept task ids; a session with none is skipped, a line that does not
 *  fit the room left is skipped, and the list stops at `PLANNER_SESSIONS_SHOWN` lines. The header
 *  comes only with at least one line. */
function sessionLines(
  sessions: readonly { name: string | null; id: string; taskIds: readonly string[] }[],
  kept: ReadonlySet<string>,
  used: number
): string[] {
  let room = PLANNER_LIST_BUDGET_BYTES - used
  const out: string[] = []
  for (const session of sessions) {
    if (out.length >= PLANNER_SESSIONS_SHOWN) break
    const ids = session.taskIds.filter((id) => kept.has(id)).slice(0, PLANNER_SESSION_IDS_SHOWN)
    if (ids.length === 0) continue
    const name = session.name === null ? '' : promptSafeName(session.name)
    const who = name === '' ? '(no longer listed)' : `"${name}"`
    const line = `- ${who} [${session.id}]: ${ids.join(', ')}`
    const cost = lineCost(line)
    if (cost > room) continue
    room -= cost
    out.push(line)
  }
  return out.length > 0 ? ['Sessions that worked on these tasks:', ...out] : []
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
