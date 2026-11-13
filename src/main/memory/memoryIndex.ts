// The memory block a launched session gets in its system prompt: fixed rules of use, the pinned
// items (up to `MEMORY_LIMITS.indexCeilingChars`), then, capped at `MEMORY_LIMITS.indexChars`, the
// open tasks of the session's folder, the specifics saved for it and its recent sessions
// (episodes). It states dates, not facts: memory is a record of what was seen. Every saved text
// is put on one line, so none can start a line of its own (a heading, a rule). Memory text is
// sensitive: this module logs nothing.
import { MEMORY_LIMITS, type MemoryItem, type MemoryRow } from '../../shared/schemas/memory'
import { formatDay, localDaysBetween } from './formatDay'
import type { IndexTask } from './memoryTasks'

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

const PINNED_HEADING = '## Pinned'
const TASKS_HEADING = '## Open tasks for this folder'
const FOLDER_HEADING = '## Specifics for this folder'
const EPISODES_HEADING = '## Recent sessions'

/** One index line is one line: every line break (a fact body's `\n`, and the Unicode line and
 *  paragraph separators) becomes a space. */
export function oneLine(text: string): string {
  return text.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ')
}

function pinnedLine(item: MemoryItem): string {
  const [head, text] = item.kind === 'specific' ? [item.key, item.value] : [item.title, item.body]
  const check = item.check === null ? '' : ` · check: ${oneLine(item.check)}`
  const deleted = item.originDeletedAt === null ? '' : ' · session deleted'
  return `- ${oneLine(head)}: ${oneLine(text)} (seen ${formatDay(item.lastSeenAt)}, ${item.basis})${check}${deleted}`
}

/** A specific of the folder, or a recent session: its head, its day and its id. */
function rowLine(row: MemoryRow): string {
  return `- ${oneLine(row.head)} (${formatDay(row.updatedAt)}) id=${row.id}`
}

function daysAgo(days: number): string {
  if (days === 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
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
  /** The ids `itemIds` lists for each line (none for a task: it is not a memory item). */
  ids: string[] | null
  shown: number
}

const newestFirst = (rows: readonly MemoryRow[]): MemoryRow[] =>
  [...rows].sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * The rules of use are always sent. Pinned lines are added newest first while the whole text
 * stays within `ceilingChars` (they may pass the cap); the ones left out are counted in a last
 * `<n> more pinned` line of their section. Then (ruling R3) task lines (in the order given), then
 * specifics, then episodes (each newest first) are added while the whole text, the last `<n> more`
 * line included, stays within `capChars`, so a pinned section over the cap leaves no room for
 * them. That line counts every task, specific and episode left out, plus `more`. A section with no
 * line is left out. `itemIds` lists exactly the items that got a line (never a task).
 */
export function buildMemoryIndex(
  input: {
    pinned: readonly MemoryItem[]
    tasksHere: readonly IndexTask[]
    specificsHere: readonly MemoryRow[]
    episodesHere: readonly MemoryRow[]
    more: number
    now: number
  },
  capChars: number = MEMORY_LIMITS.indexChars,
  ceilingChars: number = MEMORY_LIMITS.indexCeilingChars
): { text: string; itemIds: string[] } {
  const pinnedNewest = [...input.pinned].sort((a, b) => b.updatedAt - a.updatedAt)
  const pinnedLines = pinnedNewest.map(pinnedLine)
  const specifics = newestFirst(input.specificsHere)
  const episodes = newestFirst(input.episodesHere)
  const sections: Section[] = [
    {
      heading: TASKS_HEADING,
      lines: input.tasksHere.map((t) => taskLine(t, input.now)),
      ids: null,
      shown: 0
    },
    {
      heading: FOLDER_HEADING,
      lines: specifics.map(rowLine),
      ids: specifics.map((r) => r.id),
      shown: 0
    },
    {
      heading: EPISODES_HEADING,
      lines: episodes.map(rowLine),
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
    const left = sections.reduce((n, s) => n + s.lines.length - s.shown, input.more)
    return [MEMORY_RULES_OF_USE, ...pinned, ...capped, ...countLine(left, 'more')].join('\n')
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
