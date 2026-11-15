// Memory — where the dialog places an item (spec 2026-11-14 memory context index §8): the form's
// `Folder`, `Goal` and `Tags`. Pure, no React: what the fields offer, where a New form starts, what
// `Global` clears, and what an edit sends. A stored goal or tag the form cannot draw (gone, or not
// offered) is never sent and never dropped: an edit sends only the fields that changed, and a sent
// `tagIds` keeps every stored id the form could not draw.
import type { MemoryContextPatch, MemoryItem } from '../../../../shared/schemas/memory'
import type { SessionFilters } from '../../lib/sessionFilters'

/** The `Folder` and `Goal` Selects' first option (a sentinel WORD, design.md, never ''). */
export const NO_FOLDER = 'none'
export const NO_GOAL = 'none'

export interface ContextDraft {
  folder: string | null
  goalId: string | null
  tagIds: string[]
}

/** No repeats, in this order: the stored folder of the open item, the rail's Folder filter, the
 *  goals' folders, the workspace's default folder, the live sessions' folders, the filter's own list. */
export function offeredFolders(known: {
  stored: string | null
  filter: string | null
  goals: readonly (string | null)[]
  workspace: string | null
  sessions: readonly string[]
  listed: readonly string[]
}): string[] {
  const all = [
    known.stored,
    known.filter,
    ...known.goals,
    known.workspace,
    ...known.sessions,
    ...known.listed
  ]
  return [...new Set(all.filter((f): f is string => f !== null && f !== ''))]
}

/** A New form's start: the rail's filters when they are on, else nothing. Tags the scope cannot see are left out. */
export function draftFromFilters(
  filters: Pick<SessionFilters, 'folders' | 'goalIds' | 'tagIds'>,
  offered: { goalIds: ReadonlySet<string>; tagIds: ReadonlySet<string> }
): ContextDraft {
  const goalId = filters.goalIds[0] ?? null
  return {
    folder: filters.folders[0] ?? null,
    goalId: goalId !== null && offered.goalIds.has(goalId) ? goalId : null,
    tagIds: filters.tagIds.filter((id) => offered.tagIds.has(id))
  }
}

/** `Global` turned on: no goal, and only the tags a global item may hold. */
export function rescopeContext(
  draft: ContextDraft,
  globalTagIds: ReadonlySet<string>
): ContextDraft {
  return {
    folder: draft.folder,
    goalId: null,
    tagIds: draft.tagIds.filter((id) => globalTagIds.has(id))
  }
}

/** The same set of ids, in any order (the picker hands them back in tag-list order). */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(b)
  return a.length === b.length && a.every((id) => set.has(id))
}

/** Only the fields that differ from the item; null when none does. `tagIds` = the picked ids
 *  plus the stored ids the form could not draw. */
export function contextPatch(
  item: MemoryItem,
  draft: ContextDraft,
  drawnTagIds: ReadonlySet<string>
): MemoryContextPatch | null {
  const patch: MemoryContextPatch = {}
  if (draft.folder !== item.meta.folder) patch.folder = draft.folder
  if (draft.goalId !== item.meta.goalId) patch.goalId = draft.goalId
  const undrawn = item.meta.tagIds.filter((id) => !drawnTagIds.has(id))
  const tagIds = [...undrawn, ...draft.tagIds.filter((id) => !undrawn.includes(id))]
  if (!sameIds(tagIds, item.meta.tagIds)) patch.tagIds = tagIds
  return Object.keys(patch).length === 0 ? null : patch
}
