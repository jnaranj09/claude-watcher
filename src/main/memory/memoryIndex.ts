// The memory block a launched session gets in its system prompt: fixed rules of use, the pinned
// items (up to `MEMORY_LIMITS.indexCeilingChars`), and the specifics saved for the session's
// folder, capped at `MEMORY_LIMITS.indexChars`. It states dates, not facts: memory is a record of
// what was seen. Memory text is sensitive: this module logs nothing.
import { MEMORY_LIMITS, type MemoryItem, type MemoryRow } from '../../shared/schemas/memory'
import { formatDay } from './formatDay'

/** Read by a model: change a word only on purpose. */
export const MEMORY_RULES_OF_USE = [
  '# Memory (Claude Watcher)',
  'Memory is a record of what was seen and when. It is not the current state.',
  '- Give the date with anything you take from memory.',
  '- When an item has a check and may have changed, run the check before you rely on it.',
  '- An item marked "session deleted" comes from a session the operator deleted. Say so when you use one, and suggest deleting it in Memory if it no longer applies. You can mark it stale; you cannot delete it.',
  '- Save exact values word for word (numbers, ids, versions, commands) with memory_save. Do not save preferences, or what the repository itself says.',
  '- Find items with memory_search (filters: kind, folder, session, tags, since, until, goal) and read one with memory_get.'
].join('\n')

const PINNED_HEADING = '## Pinned'
const FOLDER_HEADING = '## Specifics for this folder'

/** One index line is one line: a fact body's line breaks each become a space. */
function oneLine(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

function pinnedLine(item: MemoryItem): string {
  const [head, text] = item.kind === 'specific' ? [item.key, item.value] : [item.title, item.body]
  const check = item.check === null ? '' : ` · check: ${item.check}`
  const deleted = item.originDeletedAt === null ? '' : ' · session deleted'
  return `- ${oneLine(head)}: ${oneLine(text)} (seen ${formatDay(item.lastSeenAt)}, ${item.basis})${check}${deleted}`
}

function folderLine(row: MemoryRow): string {
  return `- ${oneLine(row.head)} (${formatDay(row.updatedAt)}) id=${row.id}`
}

/**
 * The rules of use are always sent. Pinned lines are added newest first while the whole text
 * stays within `ceilingChars` (they may pass the cap); the ones left out are counted in a last
 * `<n> more pinned` line of their section. Folder lines are added newest first while the whole
 * text (the last `<n> more` line included) stays within `capChars`, so a pinned section over the
 * cap leaves no room for them. `itemIds` lists exactly the items that got a line.
 */
export function buildMemoryIndex(
  input: {
    pinned: readonly MemoryItem[]
    specificsHere: readonly MemoryRow[]
    more: number
  },
  capChars: number = MEMORY_LIMITS.indexChars,
  ceilingChars: number = MEMORY_LIMITS.indexCeilingChars
): { text: string; itemIds: string[] } {
  const pinnedNewest = [...input.pinned].sort((a, b) => b.updatedAt - a.updatedAt)
  const pinnedLines = pinnedNewest.map(pinnedLine)
  const newestFirst = [...input.specificsHere].sort((a, b) => b.updatedAt - a.updatedAt)

  const countLine = (n: number, what: string): string[] =>
    n > 0 ? [`${n} ${what}; use memory_search`] : []
  const assemble = (pinnedCount: number, folderCount: number): string => {
    const pinned =
      pinnedNewest.length === 0
        ? []
        : [
            '',
            PINNED_HEADING,
            ...pinnedLines.slice(0, pinnedCount),
            ...countLine(pinnedNewest.length - pinnedCount, 'more pinned')
          ]
    const lines = newestFirst.slice(0, folderCount).map(folderLine)
    const folder = folderCount > 0 ? ['', FOLDER_HEADING, ...lines] : []
    const left = newestFirst.length - folderCount + input.more
    return [MEMORY_RULES_OF_USE, ...pinned, ...folder, ...countLine(left, 'more')].join('\n')
  }

  let pinnedCount = 0
  while (pinnedCount < pinnedNewest.length && assemble(pinnedCount + 1, 0).length <= ceilingChars)
    pinnedCount++
  let count = 0
  while (count < newestFirst.length && assemble(pinnedCount, count + 1).length <= capChars) count++

  return {
    text: assemble(pinnedCount, count),
    itemIds: [
      ...pinnedNewest.slice(0, pinnedCount).map((p) => p.id),
      ...newestFirst.slice(0, count).map((r) => r.id)
    ]
  }
}
