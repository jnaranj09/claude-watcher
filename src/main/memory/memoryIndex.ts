// The memory block a launched session gets in its system prompt (spec 2026-11-11 memory, and
// 2026-11-14 memory context index §1): fixed rules of use, the pinned items (up to
// `MEMORY_LIMITS.indexCeilingChars`), then, capped at `MEMORY_LIMITS.indexChars`, the open tasks of
// the session's folder, its keys in eight groups (the first reason each shares with the session,
// `KEY_REASONS`, each under a heading that says why) and its recent sessions (episodes). It states
// dates, not facts: memory is a record of what was seen. Every saved text is put on one line
// (`oneLine`), so none can start a line of its own (a heading, a rule), pose as a system-reminder
// tag or forge the memory block marker (P3-C1). A key's line is `keyLine`'s (`memoryKeyLine.ts`).
// The pinned line, the one line that puts `: ` right after a saved text, goes through
// `wrapperSafe` once more, so that `: ` can never complete the marker (P3-C15); so do a group's
// heading and its count line, which hold a goal or tag name the operator typed. The other lines
// put ` (` or ` · ` after saved text, which cannot. Memory text is sensitive: this module logs
// nothing.
import {
  KEY_REASONS,
  MEMORY_LIMITS,
  type IndexReason,
  type KeyReason,
  type MemoryItem
} from '../../shared/schemas/memory'
import { formatDay, localDaysBetween } from './formatDay'
import { keyLine } from './memoryKeyLine'
import type { EpisodeRow } from './memoryRows'
import type { ContextGroup } from './memorySearch'
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
  "- The lists below hold items saved for this session's tasks, goal, folder, template and tags, and items saved for every session of this workspace. Each heading says why its items are listed.",
  '- Before you write or run an exact value (a port, path, version, command, id) that you have not read in this session, look for it in the lists below. If its value ends with "…", read the whole value with memory_get first.',
  '- A line marked "value not shown", "fact" or "check" holds more than it shows. Read that item with memory_get before you use it.',
  '- A line "<n> more" counts items that are not listed. Find them with memory_search (kind: specific, fact, episode, command; filters: folder, session, tags, since, until, goal) and read one with memory_get.',
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

/** The names a group's heading and count line print: the session's goal (null when it has none
 *  or its name cannot be read) and the names of its tags that still resolve. */
export type IndexNames = { goal: string | null; tags: readonly string[] }
/** What Context shows per group: the ids listed and how many its count line names. */
export type IndexGroupRecord = { reason: IndexReason; itemIds: string[]; more: number }
export type MemoryIndex = {
  text: string
  itemIds: string[]
  groups: IndexGroupRecord[]
  /** Every listed key whose whole value the section shows, with the change date it showed. */
  whole: { id: string; updatedAt: number }[]
}

/** The groups that take more lines in the second pass, in order: `template` and `tags` stay at
 *  their first-pass share, so a tag or template most sessions carry cannot fill the section. */
const SECOND_PASS: readonly KeyReason[] = [
  'task',
  'goal',
  'folder',
  'folder_above',
  'workspace',
  'folder_below'
]

/** A group's heading, read by a model; a name goes through `oneLine`, the heading through
 *  `wrapperSafe`. */
function groupHeading(reason: KeyReason, names: IndexNames): string {
  switch (reason) {
    case 'task':
      return "## Saved for this session's tasks"
    case 'goal':
      return names.goal === null
        ? "## Saved for this session's goal"
        : wrapperSafe(`## Saved for goal "${oneLine(names.goal)}"`)
    case 'folder':
      return '## Saved in this folder'
    case 'folder_above':
      return '## Saved in folders above'
    case 'workspace':
      return '## Saved for every session of this workspace'
    case 'template':
      return '## Saved from the same template'
    case 'tags':
      return names.tags.length === 0
        ? '## Saved with the same tags'
        : wrapperSafe(`## Saved with the same tags (${names.tags.map(oneLine).join(', ')})`)
    case 'folder_below':
      return '## Saved in folders below'
  }
}

/** The `memory_search` argument that finds a group's other items, where one filter fits it. */
function groupFilter(reason: KeyReason, names: IndexNames): Record<string, unknown> | null {
  switch (reason) {
    case 'goal':
      return names.goal === null ? null : { goal: oneLine(names.goal) }
    case 'folder':
    case 'folder_below':
      return { folder: 'here' }
    case 'tags':
      return names.tags.length === 0 ? null : { tags: names.tags.map(oneLine) }
    case 'task':
    case 'folder_above':
    case 'workspace':
    case 'template':
      return null
  }
}

/** A group with `n` rows not listed. */
function groupCountLine(n: number, filter: Record<string, unknown> | null): string {
  return filter === null
    ? `${n} more; use memory_search`
    : wrapperSafe(`${n} more: memory_search ${JSON.stringify(filter)}`)
}

/** One group as it fills: its lines (each `keyLine`), how many are listed, and whether it prints
 *  with no line (its heading and count line alone). */
interface GroupFill {
  reason: KeyReason
  heading: string
  filter: Record<string, unknown> | null
  rows: { id: string; updatedAt: number; text: string; whole: boolean }[]
  total: number
  shown: number
  bare: boolean
}

const printed = (g: GroupFill): boolean => g.shown > 0 || g.bare

/**
 * The rules (`rules`, `MEMORY_RULES_OF_USE` unless a caller gives others) are always sent. Pinned
 * lines are added newest first while the whole text stays within `ceilingChars` (they may pass the
 * cap); the ones left out are counted in a last `<n> more pinned` line of their section. Then,
 * while the whole text (its count lines included) stays within `capChars`: task lines (in the
 * order given); a first pass that gives each group, in `KEY_REASONS` order, up to
 * `MEMORY_LIMITS.indexReasonShare` lines (a group with no line still prints its heading and count
 * line when they fit); episodes (the session that ended last first); then a second pass in which
 * the groups of `SECOND_PASS` take more lines, in order. A line that does not fit ends its group's
 * turn. A group with rows left out ends with its count line; a group that prints nothing is
 * counted in the last line, `<n> more; use memory_search`: every active item in scope (`active`)
 * that is not pinned, in a printed group or a listed episode. Tasks left out are counted apart:
 * `memory_search` cannot find a task. `itemIds` lists exactly the items that got a line (never a
 * task).
 */
export function buildMemoryIndex(
  input: {
    pinned: readonly MemoryItem[]
    tasksHere: readonly IndexTask[]
    groups: readonly ContextGroup[]
    names: IndexNames
    clashes: ReadonlySet<string>
    episodesHere: readonly EpisodeRow[]
    active: number
    now: number
  },
  capChars: number = MEMORY_LIMITS.indexChars,
  ceilingChars: number = MEMORY_LIMITS.indexCeilingChars,
  rules: string = MEMORY_RULES_OF_USE
): MemoryIndex {
  const pinnedNewest = [...input.pinned].sort((a, b) => b.updatedAt - a.updatedAt)
  const pinnedLines = pinnedNewest.map(pinnedLine)
  const taskLines = input.tasksHere.map((t) => taskLine(t, input.now))
  const episodes = [...input.episodesHere].sort((a, b) => b.endedAt - a.endedAt)
  const episodeLines = episodes.map(episodeLine)
  const groups: GroupFill[] = KEY_REASONS.flatMap((reason) => {
    const group = input.groups.find((g) => g.reason === reason)
    if (group === undefined || group.total === 0) return []
    return [
      {
        reason,
        heading: groupHeading(reason, input.names),
        filter: groupFilter(reason, input.names),
        rows: group.rows.map((row) => ({
          id: row.id,
          updatedAt: row.updatedAt,
          ...keyLine(row, input.clashes)
        })),
        total: group.total,
        shown: 0,
        bare: false
      }
    ]
  })
  let pinnedCount = 0
  let tasksShown = 0
  let episodesShown = 0

  const countLine = (n: number, what: string): string[] =>
    n > 0 ? [`${n} ${what}; use memory_search`] : []
  const assemble = (): string => {
    const pinned =
      pinnedNewest.length === 0
        ? []
        : [
            '',
            PINNED_HEADING,
            ...pinnedLines.slice(0, pinnedCount),
            ...countLine(pinnedNewest.length - pinnedCount, 'more pinned')
          ]
    const tasks = tasksShown > 0 ? ['', TASKS_HEADING, ...taskLines.slice(0, tasksShown)] : []
    const keys = groups.flatMap((g) =>
      printed(g)
        ? [
            '',
            g.heading,
            ...g.rows.slice(0, g.shown).map((r) => r.text),
            ...(g.total > g.shown ? [groupCountLine(g.total - g.shown, g.filter)] : [])
          ]
        : []
    )
    const recent =
      episodesShown > 0 ? ['', EPISODES_HEADING, ...episodeLines.slice(0, episodesShown)] : []
    const counted = groups.reduce((n, g) => (printed(g) ? n + g.total : n), 0)
    return [
      rules,
      ...pinned,
      ...tasks,
      ...keys,
      ...recent,
      ...tasksLeftLine(taskLines.length - tasksShown),
      ...countLine(input.active - pinnedNewest.length - counted - episodesShown, 'more')
    ].join('\n')
  }
  const fits = (): boolean => assemble().length <= capChars
  /** Adds `group`'s next lines up to `max`; the first that does not fit ends its turn. */
  const fill = (group: GroupFill, max: number): void => {
    while (group.shown < Math.min(max, group.rows.length)) {
      group.shown++
      if (fits()) continue
      group.shown--
      return
    }
  }

  while (pinnedCount < pinnedNewest.length) {
    pinnedCount++
    if (assemble().length <= ceilingChars) continue
    pinnedCount--
    break
  }
  while (tasksShown < taskLines.length) {
    tasksShown++
    if (fits()) continue
    tasksShown--
    break
  }
  for (const group of groups) {
    fill(group, MEMORY_LIMITS.indexReasonShare)
    if (group.shown > 0) continue
    group.bare = true
    if (!fits()) group.bare = false
  }
  while (episodesShown < episodeLines.length) {
    episodesShown++
    if (fits()) continue
    episodesShown--
    break
  }
  for (const reason of SECOND_PASS) {
    const group = groups.find((g) => g.reason === reason)
    if (group !== undefined) fill(group, group.rows.length)
  }

  const listedGroups = groups.filter(printed)
  const listedRows = listedGroups.flatMap((g) => g.rows.slice(0, g.shown))
  const listedPinned = pinnedNewest.slice(0, pinnedCount).map((p) => p.id)
  const listedEpisodes = episodes.slice(0, episodesShown).map((e) => e.id)
  const records: IndexGroupRecord[] = []
  if (pinnedNewest.length > 0) {
    records.push({
      reason: 'pinned',
      itemIds: listedPinned,
      more: pinnedNewest.length - pinnedCount
    })
  }
  for (const g of listedGroups) {
    records.push({
      reason: g.reason,
      itemIds: g.rows.slice(0, g.shown).map((r) => r.id),
      more: g.total - g.shown
    })
  }
  if (listedEpisodes.length > 0) {
    records.push({ reason: 'episode', itemIds: listedEpisodes, more: 0 })
  }
  return {
    text: assemble(),
    itemIds: [...listedPinned, ...listedRows.map((r) => r.id), ...listedEpisodes],
    groups: records,
    whole: listedRows.filter((r) => r.whole).map((r) => ({ id: r.id, updatedAt: r.updatedAt }))
  }
}
