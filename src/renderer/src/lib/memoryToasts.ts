// Memory phase 2 "Feedback": the board toast each save from a session leaves. Main decides what is
// pushed (an end always, except a session under 2 prompts; a checkpoint or catch-up only when it
// failed; `claude_version` once per run); this file only draws what arrives. A toast holds the
// session's name and counts only, never memory text. The counts are what the saves WROTE (an
// update counts too), in the addendum's words.
import type { MemoryCounts, MemoryExtractResult } from '../../../shared/schemas/memory'
import { formatVersion, MIN_EXTRACT_CLAUDE_VERSION } from '../../../shared/launch/claudeVersion'
import { boardStore } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { isModalOpen } from './modals'

/** Each kind's words, singular then plural, in the order the line names them. */
const PARTS: readonly [keyof MemoryCounts, string, string][] = [
  ['specifics', 'specific', 'specifics'],
  ['facts', 'fact', 'facts'],
  ['tasks', 'task', 'tasks'],
  ['episodes', 'episode', 'episodes']
]

/** `4 specifics, 1 fact, 2 tasks, 1 episode`: parts with 0 left out, singular for 1. */
export function countsCopy(counts: MemoryCounts): string {
  return PARTS.filter(([kind]) => counts[kind] > 0)
    .map(([kind, one, many]) => `${counts[kind]} ${counts[kind] === 1 ? one : many}`)
    .join(', ')
}

/** `Show`: opens the Memory dialog filtered on that session; nothing while a modal is open
 *  (the single-modal rule, the same guard as every opener). */
export function openMemoryForSession(sessionName: string): void {
  if (isModalOpen()) return
  boardStore.getState().openMemoryDialog({ sessionName })
}

/** The toast for one result (addendum "Feedback"). `show` opens the Memory dialog for that session. */
export function showExtractResult(
  result: MemoryExtractResult,
  show: (sessionName: string) => void
): void {
  const name = result.sessionName
  switch (result.outcome) {
    case 'saved':
      toast.success(`Memory saved from "${name}": ${countsCopy(result.counts)}.`, {
        action: { label: 'Show', icon: 'open', run: () => show(name) }
      })
      return
    case 'nothing':
      toast.info(`Nothing new to remember from "${name}".`)
      return
    case 'failed':
      toast.error(
        `Could not save memory from "${name}".`,
        result.reason === 'claude_version'
          ? {
              detail: `Update claude to ${formatVersion(MIN_EXTRACT_CLAUDE_VERSION)} or newer to save memory.`
            }
          : {}
      )
  }
}
