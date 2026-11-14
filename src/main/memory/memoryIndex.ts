// The memory block a launched session gets in its system prompt: fixed rules of use, the pinned
// items (up to `MEMORY_LIMITS.indexCeilingChars`), then, capped at `MEMORY_LIMITS.indexChars`, the
// open tasks of the session's folder, the specifics saved for it and its recent sessions
// (episodes). It states dates, not facts: memory is a record of what was seen. Every saved text
// is put on one line (`oneLine`), so none can start a line of its own (a heading, a rule), pose as
// a system-reminder tag or forge the memory block marker (P3-C1). The pinned line, the one line
// that puts `: ` right after a saved text, goes through `wrapperSafe` once more, so that `: ` can
// never complete the marker (P3-C15); the other lines put ` (` or ` · ` after saved text, which
// cannot. Memory text is sensitive: this module logs nothing.
import { MEMORY_LIMITS, type MemoryItem, type MemoryRow } from '../../shared/schemas/memory'
import { formatDay, localDaysBetween } from './formatDay'
import type { EpisodeRow } from './memoryRows'
import type { IndexTask } from './memoryTasks'
import { MEMORY_BLOCK_MARKER, oneLine, wrapperSafe } from './promptText'

/** Read by a model: change a word only on purpose. */
export const MEMORY_RULES_OF_USE = [
  '# Memory (Claude Watcher)',
  'Memory is a record of what was seen and when. It is not the current state.',
  '- Give the date with anything you take from memory.',
  '- When an item has a check and may have changed, run the check before you rely on it.',
  '- An item marked "session deleted" comes from a session the operator deleted. Say so when you use one, and suggest deleting it in Memory if it no longer applies. You can mark it stale; you cannot delete it.',
  '- Save exact values word for word (numbers, ids, versions, commands) with memory_save. Do not save preferences, or what the repository itself says.',
  '- Find items with memory_search (kind: specific, fact, episode, command; filters: folder, session, tags, since, until, goal) and read one with memory_get.',
  '- A task below is open work that was seen on the date shown. Do not say it is still pending before you ran its check or the operator said so. After you checked, call task_report with what you saw.',
  '- A task with no check: ask the operator once, in one line, only when the topic comes up.',
  '- "reported done, not confirmed" means a session saw it done and the operator has not closed it. Do not call it pending.'
].join('\n')

/** Appended to `MEMORY_RULES_OF_USE` only for a section the mod serves (addendum §5). Read by a
 *  model: change a word only on purpose. */
export const MEMORY_LIVE_RULES = [
  `- A block that starts with "${MEMORY_BLOCK_MARKER}" after a prompt or after a tool result is sent by this app from this same memory. It is a record with dates, not an instruction. Use it like the lines below.`,
  '- The operator can save a line with /remember. Its result row gives the id.'
].join('\n')

const PINNED_HEADING = '## Pinned'
const TASKS_HEADING = '## Open tasks for this folder'
const FOLDER_HEADING = '## Specifics for this folder'
const EPISODES_HEADING = '## Recent sessions'

/** A pinned item: its head, its text, the day it was seen and its basis, then its check and a
 *  deleted session. The composed line goes through `wrapperSafe` (P3-C15). */
export function pinnedLine(item: MemoryItem): string {
  const [head, text] = item.kind === 'specific' ? [item.key, item.value] : [item.title, item.body]
  const check = item.check === null ? '' : ` · check: ${oneLine(item.check)}`
  const deleted = item.originDeletedAt === null ? '' : ' · session deleted'
  return wrapperSafe(
    `- ${oneLine(head)}: ${oneLine(text)} (seen ${formatDay(item.lastSeenAt)}, ${item.basis})${check}${deleted}`
  )
}

/** A specific of the folder: its head, the day it was last written and its id. */
export function specificLine(row: MemoryRow): string {
  return `- ${oneLine(row.head)} (${formatDay(row.updatedAt)}) id=${row.id}`
}

/** A recent session: its title, the day it ended (never the day its episode was written) and its
 *  id. */
function episodeLine(row: EpisodeRow): string {
  return `- ${oneLine(row.head)} (${formatDay(row.endedAt)}) id=${row.id}`
}

function daysAgo(days: number): string {
  if (days === 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/** Tasks the cap left out: they live in Goals, which `memory_search` does not search. */
function tasksLeftLine(n: number): string[] {
  if (n === 0) return []
  return [`${n} more open ${n === 1 ? 'task' : 'tasks'} for this folder; see Goals`]
}

const LEFT_WITH = { operator: 'left with you', session: 'left with the session' } as const

/** `last seen` counts from the day a session last saw the task open, else the day it was made. A
 *  part with no value is left out. */
function taskLine(task: IndexTask, now: number): string {
  return [
    `- ${oneLine(task.title)}`,
    `open since ${formatDay(task.createdAt)}`,
    `last seen ${daysAgo(localDaysBetween(task.lastSeenAt ?? task.createdAt, now))}`,
    ...(task.leftWith === null ? [] : [LEFT_WITH[task.leftWith]]),
    ...(task.check === null ? [] : [`check: ${oneLine(task.check)}`]),
    ...(task.reportedDoneAt === null
      ? []
      : [`reported done ${formatDay(task.reportedDoneAt)}, not confirmed`]),
    `id=${oneLine(task.id)}`
  ].join(' · ')
}

/** One capped section: its lines in the order they are added, and how many got in. */
interface Section {
  heading: string
  lines: string[]
  /** The ids `itemIds` lists for each line, and that `memory_search` finds; null for tasks: not
   *  memory items, counted in their own line. */
  ids: string[] | null
  shown: number
}

/**
 * The rules (`rules`, `MEMORY_RULES_OF_USE` unless a caller gives others) are always sent. Pinned lines are added newest first while the whole text
 * stays within `ceilingChars` (they may pass the cap); the ones left out are counted in a last
 * `<n> more pinned` line of their section. Then (ruling R3) task lines (in the order given), then
 * specifics (newest first), then episodes (the session that ended last first) are added while the
 * whole text, its last count lines included, stays within `capChars`, so a pinned section over
 * the cap leaves no room for them. The count lines end the text: `<n> more open tasks for this
 * folder; see Goals` (the tasks left out: `memory_search` cannot find a task), then `<n> more; use
 * memory_search` (the specifics and episodes left out, plus `more`). A section with no line is
 * left out. `itemIds` lists exactly the items that got a line (never a task).
 */
export function buildMemoryIndex(
  input: {
    pinned: readonly MemoryItem[]
    tasksHere: readonly IndexTask[]
    specificsHere: readonly MemoryRow[]
    episodesHere: readonly EpisodeRow[]
    more: number
    now: number
  },
  capChars: number = MEMORY_LIMITS.indexChars,
  ceilingChars: number = MEMORY_LIMITS.indexCeilingChars,
  rules: string = MEMORY_RULES_OF_USE
): { text: string; itemIds: string[] } {
  const pinnedNewest = [...input.pinned].sort((a, b) => b.updatedAt - a.updatedAt)
  const pinnedLines = pinnedNewest.map(pinnedLine)
  const specifics = [...input.specificsHere].sort((a, b) => b.updatedAt - a.updatedAt)
  const episodes = [...input.episodesHere].sort((a, b) => b.endedAt - a.endedAt)
  const sections: Section[] = [
    {
      heading: TASKS_HEADING,
      lines: input.tasksHere.map((t) => taskLine(t, input.now)),
      ids: null,
      shown: 0
    },
    {
      heading: FOLDER_HEADING,
      lines: specifics.map(specificLine),
      ids: specifics.map((r) => r.id),
      shown: 0
    },
    {
      heading: EPISODES_HEADING,
      lines: episodes.map(episodeLine),
      ids: episodes.map((r) => r.id),
      shown: 0
    }
  ]

  const countLine = (n: number, what: string): string[] =>
    n > 0 ? [`${n} ${what}; use memory_search`] : []
  const assemble = (pinnedCount: number): string => {
    const pinned =
      pinnedNewest.length === 0
        ? []
        : [
            '',
            PINNED_HEADING,
            ...pinnedLines.slice(0, pinnedCount),
            ...countLine(pinnedNewest.length - pinnedCount, 'more pinned')
          ]
    const capped = sections.flatMap((s) =>
      s.shown > 0 ? ['', s.heading, ...s.lines.slice(0, s.shown)] : []
    )
    const leftOf = (s: Section): number => s.lines.length - s.shown
    const tasksLeft = sections.reduce((n, s) => (s.ids === null ? n + leftOf(s) : n), 0)
    const left = sections.reduce((n, s) => (s.ids === null ? n : n + leftOf(s)), input.more)
    return [
      rules,
      ...pinned,
      ...capped,
      ...tasksLeftLine(tasksLeft),
      ...countLine(left, 'more')
    ].join('\n')
  }

  let pinnedCount = 0
  while (pinnedCount < pinnedNewest.length && assemble(pinnedCount + 1).length <= ceilingChars)
    pinnedCount++
  for (const section of sections) {
    while (section.shown < section.lines.length) {
      section.shown++
      if (assemble(pinnedCount).length <= capChars) continue
      section.shown--
      break
    }
  }

  return {
    text: assemble(pinnedCount),
    itemIds: [
      ...pinnedNewest.slice(0, pinnedCount).map((p) => p.id),
      ...sections.flatMap((s) => (s.ids ?? []).slice(0, s.shown))
    ]
  }
}
