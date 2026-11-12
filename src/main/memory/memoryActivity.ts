// What memory did for each session, kept in memory only: the index claude got at launch, and
// every item it pulled or saved since. The Context dialog reads it. Holds ids and counts, never
// memory text, and logs nothing (memory text is sensitive).
import type { MemoryActivity } from '../../shared/schemas/memory'

type ActivityEntry = MemoryActivity['entries'][number]

/** Newest entries kept per session. */
const MAX_ENTRIES = 200
const CHARS_PER_TOKEN = 4

export interface MemoryActivityLog {
  injected(sessionId: string, value: { chars: number; itemIds: readonly string[] }): void
  record(sessionId: string, entry: ActivityEntry): void
  get(sessionId: string): MemoryActivity
  rebind(oldSessionId: string, newSessionId: string): void
  forget(sessionId: string): void
}

export function createMemoryActivity(): MemoryActivityLog {
  const records = new Map<string, MemoryActivity>()

  function recordOf(sessionId: string): MemoryActivity {
    const found = records.get(sessionId)
    if (found) return found
    const fresh: MemoryActivity = { injected: null, entries: [] }
    records.set(sessionId, fresh)
    return fresh
  }

  return {
    injected(sessionId, { chars, itemIds }) {
      recordOf(sessionId).injected = {
        tokens: Math.ceil(chars / CHARS_PER_TOKEN),
        itemIds: [...itemIds]
      }
    },
    record(sessionId, entry) {
      const { entries } = recordOf(sessionId)
      entries.push({ ...entry })
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
    },
    get(sessionId) {
      const found = records.get(sessionId)
      if (!found) return { injected: null, entries: [] }
      return {
        injected: found.injected && { ...found.injected, itemIds: [...found.injected.itemIds] },
        entries: found.entries.map((e) => ({ ...e }))
      }
    },
    rebind(oldSessionId, newSessionId) {
      const found = records.get(oldSessionId)
      if (!found || oldSessionId === newSessionId) return
      records.delete(oldSessionId)
      records.set(newSessionId, found)
    },
    forget(sessionId) {
      records.delete(sessionId)
    }
  }
}
