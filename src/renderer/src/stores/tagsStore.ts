// Tags — the renderer PROJECTION of main's tag catalog (state.md: main is truth; this is a hydrated
// copy, replaced wholesale from every IPC result — no client merge), plus the header tag FILTER.
// The filter is renderer view-state (spec §4.1): one tag or none, never persisted.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Tag, TagSaveRequest } from '../../../shared/ipc/contract'
import { isTagVisibleIn } from '../../../shared/tags/tagScope'
import { toast } from './toastStore'

export interface TagsState {
  /** The catalog, in TAG-LIST order (main sorts it by name). Chips render in this order. */
  tags: Tag[]
  loaded: boolean
  /** The board's tag filter (FilterBar) — a tag id, or null for no filter. */
  activeTagId: string | null
  hydrate: (tags: Tag[]) => void
  setActiveTag: (id: string | null) => void
  /** Action feedback (spec 2026-09-29 §2.3) — tag toggles sent to main and not answered yet, per
   *  session (tagId → on). VIEW-STATE that expires when main answers: both pickers read
   *  `selectedIds ⊕ pending`, so the ✓ answers the click at once. Session truth stays main's. */
  pendingBySession: ReadonlyMap<string, ReadonlyMap<string, boolean>>
  setPending: (sessionId: string, changes: ReadonlyMap<string, boolean>) => void
  /** Drop the entries a settled write carried — only those still holding its value (a later click
   *  that flipped the tag again keeps its own entry). */
  settlePending: (sessionId: string, changes: ReadonlyMap<string, boolean>) => void
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
    setActiveTag: (id) => set({ activeTagId: id }),
    pendingBySession: new Map(),
    setPending: (sessionId, changes) =>
      set((s) => {
        const next = new Map(s.pendingBySession)
        const inner = new Map(next.get(sessionId) ?? [])
        for (const [id, on] of changes) inner.set(id, on)
        next.set(sessionId, inner)
        return { pendingBySession: next }
      }),
    settlePending: (sessionId, changes) =>
      set((s) => {
        const current = s.pendingBySession.get(sessionId)
        if (current === undefined) return {}
        const inner = new Map(current)
        for (const [id, on] of changes) if (inner.get(id) === on) inner.delete(id)
        const next = new Map(s.pendingBySession)
        if (inner.size === 0) next.delete(sessionId)
        else next.set(sessionId, inner)
        return { pendingBySession: next }
      })
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

/** `base` with a session's pending toggles applied: pending-off dropped, pending-on appended. */
export function applyPendingTags(
  base: readonly string[],
  pending: ReadonlyMap<string, boolean> | undefined
): string[] {
  if (pending === undefined || pending.size === 0) return [...base]
  const out = base.filter((id) => pending.get(id) !== false)
  for (const [id, on] of pending) if (on && !out.includes(id)) out.push(id)
  return out
}

/** One write chain per session: a write starts only after the previous one settled. */
const writeChains = new Map<string, Promise<void>>()

/**
 * Replace a card's tags (spec 2026-09-29 §2.3). `next` is the picker's list after the click, built
 * from what it SHOWED (`readBase() ⊕ pending`); the difference is recorded as pending at once (the
 * ✓ answers the click) and sent through the session's write chain. Each write sends
 * `readBase() ⊕ pending` as read when it RUNS: main applies a write to its reducer and ships the
 * delta before it answers (index.ts `sessionSetTags`), so the next write builds on the last one.
 * Only catalog ids are diffed — an id the catalog does not know is never touched.
 * `readBase` reads the card's tag ids from boardStore (which imports this store — hence a getter).
 * A refusal reverts the ✓ (the pending entry goes) and says so. Never rejects.
 */
export function setSessionTags(
  sessionId: string,
  next: readonly string[],
  readBase: () => readonly string[]
): Promise<void> {
  const s = tagsStore.getState()
  const shown = new Set(applyPendingTags(readBase(), s.pendingBySession.get(sessionId)))
  const wanted = new Set(next)
  const changes = new Map<string, boolean>()
  for (const { id } of s.tags) {
    const on = wanted.has(id)
    if (on !== shown.has(id)) changes.set(id, on)
  }
  const previous = writeChains.get(sessionId) ?? Promise.resolve()
  if (changes.size === 0) return previous
  s.setPending(sessionId, changes)
  const write = previous.then(async (): Promise<void> => {
    const ids = applyPendingTags(readBase(), tagsStore.getState().pendingBySession.get(sessionId))
    try {
      await window.launch.setTags(sessionId, ids)
    } catch {
      console.warn(`${LOG_PREFIX} code=set_tags_failed`)
      toast.error('Could not update tags.')
    } finally {
      tagsStore.getState().settlePending(sessionId, changes)
    }
  })
  writeChains.set(sessionId, write)
  void write.finally(() => {
    if (writeChains.get(sessionId) === write) writeChains.delete(sessionId)
  })
  return write
}
