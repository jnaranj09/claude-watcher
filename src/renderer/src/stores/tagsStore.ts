// Tags — the renderer PROJECTION of main's tag catalog (state.md: main is truth; this is a hydrated
// copy, replaced wholesale from every IPC result — no client merge). The board's filters live in
// `boardStore.filtersByWorkspace`, not here.
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Tag, TagSaveRequest } from '../../../shared/ipc/contract'
import { toast } from './toastStore'

export interface TagsState {
  /** The catalog, in TAG-LIST order (main sorts it by name). Chips render in this order. */
  tags: Tag[]
  loaded: boolean
  /** Action feedback (spec 2026-09-29 §2.6) — the startup load failed; any hydrate clears it. */
  loadFailed: boolean
  hydrate: (tags: Tag[]) => void
  markLoadFailed: () => void
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
    loadFailed: false,
    hydrate: (tags) => set({ tags, loaded: true, loadFailed: false }),
    markLoadFailed: () => set({ loadFailed: true }),
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
/** True only while nothing loaded AND the load failed — the dialog says so instead of "none yet". */
export const selectTagsLoadFailed = (s: TagsState): boolean => !selectTagsLoaded(s) && s.loadFailed

/** A card's chips: the catalog rows for `ids` in TAG-LIST order, skipping ids the catalog does not
 *  know. Returns an array → wrap the selector in useShallow at the call site. */
export function tagsForIds(tags: readonly Tag[], ids: readonly string[]): Tag[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  return tags.filter((t) => wanted.has(t.id))
}

const LOG_PREFIX = '[claude-watcher][tags]'

/** Resolves whether it worked (the startup toast names the failures). Never rejects. */
export async function loadTags(): Promise<boolean> {
  try {
    tagsStore.getState().hydrate(await window.tags.list())
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=tags_load_failed`)
    tagsStore.getState().markLoadFailed()
    return false
  }
}

/** Rethrows: the Tags dialog maps `tag_name_taken` etc. to copy. */
export async function saveTag(req: TagSaveRequest): Promise<Tag> {
  const result = await window.tags.save(req)
  tagsStore.getState().hydrate(result.tags)
  return result.saved
}

/** Rethrows: `tag_in_use` is operator-facing (the Tags dialog's error toast). */
export async function removeTag(id: string): Promise<void> {
  tagsStore.getState().hydrate(await window.tags.remove(id))
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

/** How a caller swaps the card's write and refusal surface (see `setSessionTags`). */
export interface SetSessionTagsOptions {
  write?: (sessionId: string, tagIds: string[]) => Promise<unknown>
  onError?: (err: unknown) => void
}

/**
 * Replace a session's tags, a card's or a Past record's (spec 2026-09-29 §2.3). `next` is the
 * picker's list after the click, built from what it SHOWED (`readBase() ⊕ pending`); the
 * difference is recorded as pending at once (the ✓ answers the click) and sent through the session's write chain. Each write sends
 * `readBase() ⊕ pending` as read when it RUNS: main applies a write to its reducer and ships the
 * delta before it answers (index.ts `sessionSetTags`), so the next write builds on the last one.
 * Only catalog ids are diffed — an id the catalog does not know is never touched.
 * `readBase` reads the session's tag ids (a card's from boardStore, which imports this store —
 * hence a getter; a Past record's from pastSessionsStore).
 * Defaults are the card's: the write is `window.launch.setTags` and a refusal logs
 * `code=set_tags_failed` and toasts `Could not update tags.`. `options.write` replaces the writer
 * and `options.onError` the refusal's surface (the Past sessions form: `window.pastSessions.setTags`
 * and the dialog's own result toast). A refusal reverts the ✓ (the pending entry goes) and says
 * so. Never rejects.
 */
export function setSessionTags(
  sessionId: string,
  next: readonly string[],
  readBase: () => readonly string[],
  options: SetSessionTagsOptions = {}
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
      await (options.write ?? window.launch.setTags)(sessionId, ids)
    } catch (err) {
      if (options.onError !== undefined) options.onError(err)
      else {
        console.warn(`${LOG_PREFIX} code=set_tags_failed`)
        toast.error('Could not update tags.')
      }
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
