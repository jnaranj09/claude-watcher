// Memory phase 2 "Feedback": the board toast each save from a session leaves. Main decides what is
// pushed (an end always, except a session under 2 prompts; a checkpoint or catch-up only when it
// failed; `claude_version` once per run); this file only draws what arrives. A toast holds the
// session's name and counts only, never memory text. The counts are what the saves WROTE (an
// update counts too), in the compact form of ruling R44 so the line always fits.
import { MemoryExtractResultSchema, type MemoryCounts } from '../../../shared/schemas/memory'
import { formatVersion, MIN_EXTRACT_CLAUDE_VERSION } from '../../../shared/launch/claudeVersion'
import { boardStore } from '../stores/boardStore'
import { toast } from '../stores/toastStore'
import { isModalOpen } from './modals'

/** `12 saved to memory, 3 tasks` (ruling R44): the specifics, facts and episodes written, then the
 *  tasks; a part that is 0 is left out, `1 task` in the singular. '' when nothing was written. */
export function countsCopy(counts: MemoryCounts): string {
  const saved = counts.specifics + counts.facts + counts.episodes
  const parts = [
    ...(saved > 0 ? [`${saved} saved to memory`] : []),
    ...(counts.tasks > 0 ? [`${counts.tasks} ${counts.tasks === 1 ? 'task' : 'tasks'}`] : [])
  ]
  return parts.join(', ')
}

/** `Show`: opens the Memory dialog filtered on that session; nothing while a modal is open
 *  (the single-modal rule, the same guard as every opener). */
export function openMemoryForSession(sessionName: string): void {
  if (isModalOpen()) return
  boardStore.getState().openMemoryDialog({ sessionName })
}

/** The toast for one result (addendum "Feedback", ruling R42). `raw` is what the preload hands
 *  over; it is parsed here, once (R43): a value that fails is dropped with its path and issue code,
 *  and shows no toast. Every toast keeps its title short and puts what must stay whole (the counts,
 *  the version) on the detail line, so a long session name is the only thing cut. `show` opens the
 *  Memory dialog for that session. */
export function showExtractResult(raw: unknown, show: (sessionName: string) => void): void {
  const parsed = MemoryExtractResultSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    console.warn(
      `[claude-watcher][memory] code=memory_extract_result_invalid path=${issue?.path.join('.') ?? ''} issue=${issue?.code ?? ''}`
    )
    return
  }
  const result = parsed.data
  const name = result.sessionName
  const counts = countsCopy(result.counts)
  switch (result.outcome) {
    case 'saved':
      // A save that wrote nothing is the `nothing` toast: a saved toast never has an empty line.
      if (counts === '') {
        toast.info(`Nothing new to remember from "${name}".`)
        return
      }
      toast.success(`Memory saved from "${name}".`, {
        detail: counts,
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
          ? { detail: `Needs claude ${formatVersion(MIN_EXTRACT_CLAUDE_VERSION)} or newer.` }
          : {}
      )
  }
}
