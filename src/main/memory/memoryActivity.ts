// What memory did for each session, kept in memory only: the index claude got (at launch, or the
// mod's last index ask; none in the window a resume came back into, P3-C28) with what each of its
// groups listed and counted (`groups`, spec 2026-11-14 memory context index §9), how it gets memory
// (the recall mode), and every item it pulled, saved or had injected since. The
// Context dialog reads it, and lists again on the `memory:changed` push its `onChange` drives (a pull changes no stored item, so the store's own
// push would miss it). Holds ids and counts, never memory text (memory text is sensitive); logs
// only a `code=` when a listener throws.
import type { MemoryActivity, MemoryRecallMode } from '../../shared/schemas/memory'
import type { IndexGroupRecord } from './memoryIndex'

type ActivityEntry = MemoryActivity['entries'][number]

/** Newest entries kept per session. */
const MAX_ENTRIES = 200
const CHARS_PER_TOKEN = 4

export interface MemoryActivityLog {
  injected(
    sessionId: string,
    value: { chars: number; itemIds: readonly string[]; groups: readonly IndexGroupRecord[] }
  ): void
  record(sessionId: string, entry: ActivityEntry): void
  /** How the session gets memory: the mod, or the launch index with the reason. */
  recallMode(sessionId: string, mode: MemoryRecallMode): void
  get(sessionId: string): MemoryActivity
  rebind(oldSessionId: string, newSessionId: string): void
  forget(sessionId: string): void
  /** Fires after an index sent, an entry, a recall mode, a rebind that moved a record and a
   *  forget that dropped one. Returns the unsubscribe. */
  onChange(listener: () => void): () => void
}

const LOG_PREFIX = '[claude-watcher][memory]'

function copyGroups(groups: readonly IndexGroupRecord[]): IndexGroupRecord[] {
  return groups.map((g) => ({ ...g, itemIds: [...g.itemIds] }))
}

export function createMemoryActivity(
  log: (line: string) => void = (line) => console.warn(line)
): MemoryActivityLog {
  const records = new Map<string, MemoryActivity>()
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        log(`${LOG_PREFIX} code=memory_activity_listener_failed`)
      }
    }
  }

  function recordOf(sessionId: string): MemoryActivity {
    const found = records.get(sessionId)
    if (found) return found
    const fresh: MemoryActivity = { injected: null, entries: [], recall: null }
    records.set(sessionId, fresh)
    return fresh
  }

  return {
    injected(sessionId, { chars, itemIds, groups }) {
      recordOf(sessionId).injected = {
        tokens: Math.ceil(chars / CHARS_PER_TOKEN),
        itemIds: [...itemIds],
        groups: copyGroups(groups)
      }
      emit()
    },
    record(sessionId, entry) {
      const { entries } = recordOf(sessionId)
      entries.push({ ...entry })
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
      emit()
    },
    recallMode(sessionId, mode) {
      recordOf(sessionId).recall = { ...mode }
      emit()
    },
    get(sessionId) {
      const found = records.get(sessionId)
      if (!found) return { injected: null, entries: [], recall: null }
      return {
        injected: found.injected && {
          ...found.injected,
          itemIds: [...found.injected.itemIds],
          groups: copyGroups(found.injected.groups)
        },
        entries: found.entries.map((e) => ({ ...e })),
        recall: found.recall && { ...found.recall }
      }
    },
    rebind(oldSessionId, newSessionId) {
      const found = records.get(oldSessionId)
      if (!found || oldSessionId === newSessionId) return
      records.delete(oldSessionId)
      records.set(newSessionId, found)
      emit()
    },
    forget(sessionId) {
      if (records.delete(sessionId)) emit()
    },
    onChange(listener) {
      // A wrapper, so the same function subscribed twice is two subscriptions.
      const entry = (): void => listener()
      listeners.add(entry)
      return () => listeners.delete(entry)
    }
  }
}
