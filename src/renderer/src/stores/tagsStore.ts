// Tags — the renderer PROJECTION of main's tag catalog (state.md: main is truth; this is a hydrated
// copy, replaced wholesale from every IPC result — no client merge), plus the header tag FILTER.
// The filter is renderer view-state (spec §4.1): one tag or none, never persisted.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Tag, TagSaveRequest } from '../../../shared/ipc/contract'
import { isTagVisibleIn } from '../../../shared/tags/tagScope'

export interface TagsState {
  /** The catalog, in TAG-LIST order (main sorts it by name). Chips render in this order. */
  tags: Tag[]
  loaded: boolean
  /** The header filter — a tag id, or null for "All tags". */
  activeTagId: string | null
  hydrate: (tags: Tag[]) => void
  setActiveTag: (id: string | null) => void
}
export type TagsStoreApi = StoreApi<TagsState>

export function createTagsViewStore(): TagsStoreApi {
  return createStore<TagsState>((set) => ({
    tags: [],
    loaded: false,
    activeTagId: null,
    // A filter on a tag that was just deleted would sit on a value the filter no longer offers.
    hydrate: (tags) =>
      set((s) => ({
        tags,
        loaded: true,
        activeTagId:
          s.activeTagId !== null && tags.some((t) => t.id === s.activeTagId) ? s.activeTagId : null
      })),
    setActiveTag: (id) => set({ activeTagId: id })
  }))
}

export const tagsStore = createTagsViewStore()

export function useTags<T>(selector: (state: TagsState) => T): T {
  return useStore(tagsStore, selector)
}

export const selectTags = (s: TagsState): Tag[] => s.tags
export const selectTagsLoaded = (s: TagsState): boolean => s.loaded

/** The tag the board and the rail filter on in `workspaceId`: the chosen one when that workspace
 *  can see it, else null. A primitive — safe without useShallow. */
export function effectiveTagFilter(s: TagsState, workspaceId: string): string | null {
  const id = s.activeTagId
  if (id === null) return null
  const tag = s.tags.find((t) => t.id === id)
  return tag !== undefined && isTagVisibleIn(tag, workspaceId) ? id : null
}

/** A card's chips: the catalog rows for `ids` in TAG-LIST order, skipping ids the catalog does not
 *  know. Returns an array → wrap the selector in useShallow at the call site. */
export function tagsForIds(tags: readonly Tag[], ids: readonly string[]): Tag[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  return tags.filter((t) => wanted.has(t.id))
}

const LOG_PREFIX = '[claude-watcher][tags]'

export async function loadTags(): Promise<void> {
  try {
    tagsStore.getState().hydrate(await window.tags.list())
  } catch {
    console.warn(`${LOG_PREFIX} code=tags_load_failed`)
  }
}

/** Rethrows: the Tags dialog maps `tag_name_taken` etc. to copy. */
export async function saveTag(req: TagSaveRequest): Promise<Tag> {
  const result = await window.tags.save(req)
  tagsStore.getState().hydrate(result.tags)
  return result.saved
}

/** Rethrows: `tag_in_use` is operator-facing (the Tags dialog error line). */
export async function removeTag(id: string): Promise<void> {
  tagsStore.getState().hydrate(await window.tags.remove(id))
}

export function setTagFilter(id: string | null): void {
  tagsStore.getState().setActiveTag(id)
}

/** Spec §4.1 — switching to a workspace that cannot see the chosen tag CLEARS the filter (not just
 *  hides it), so switching back does not bring back a filter nobody chose there. */
export function resetTagFilterIfHidden(workspaceId: string): void {
  const s = tagsStore.getState()
  if (s.activeTagId !== null && effectiveTagFilter(s, workspaceId) === null) s.setActiveTag(null)
}

/** Replace a card's tags. Never optimistic: the tagged card arrives as a `session.updated` delta.
 *  A refused write (an out-of-scope tag after a race) leaves the card as it is, which is what the
 *  operator sees — so it is logged, not surfaced. */
export async function setSessionTags(sessionId: string, tagIds: string[]): Promise<void> {
  try {
    await window.launch.setTags(sessionId, tagIds)
  } catch {
    console.warn(`${LOG_PREFIX} code=set_tags_failed`)
  }
}
