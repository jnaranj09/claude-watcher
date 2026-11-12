// Memory at app start (spec 2026-11-11 memory): open the database file once, tell storage health
// about a damaged or unopened file, and build the store. No store means memory is off for this
// run: the file could not be opened (`read_failed`), or this is the smoke test (which shares the
// default userData and must not write there). index.ts only calls this and holds the result.
// An opened memory drives the `memory:changed` push (`onChange`): a store change, whoever made
// it, and an activity change (a tool's pull changes no stored item, yet Context lists it).
//
// The two calls that run where nothing can show a failure never throw: a workspace delete's
// cascade (the delete is already committed; the store reported the refused write) and the close
// on quit. Each logs a `code=` only.
import type { StorageReporter } from '../persistence/persistedBlob'
import type { MemoryActivityLog } from './memoryActivity'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryStore } from './memoryStore'

const LOG_PREFIX = '[claude-watcher][memory]'

export interface OpenedMemory {
  store: MemoryStore
  /** The workspace delete cascade: removes the workspace's items, never throws. */
  removeByWorkspace(workspaceId: string): void
  /** On quit: closes the database (a WAL file checkpoints cleanly), never throws. */
  close(): void
}

export function openMemory(deps: {
  smoke: boolean
  file: string
  now: () => number
  newId: () => string
  report: StorageReporter
  log: (line: string) => void
  activity: Pick<MemoryActivityLog, 'onChange'>
  /** The `memory:changed` push. */
  onChange: () => void
}): OpenedMemory | null {
  const { now, newId, report, log } = deps
  if (deps.smoke) return null
  const open = openMemoryDb(deps.file, { now, log })
  if (!open.ok) {
    report(open.problem)
    return null
  }
  if (open.problem !== null) report(open.problem)
  const { db } = open
  const store = createMemoryStore({ db, now, newId, report, log })
  store.onChange(deps.onChange)
  deps.activity.onChange(deps.onChange)
  return {
    store,
    removeByWorkspace(workspaceId) {
      try {
        store.removeByWorkspace(workspaceId)
      } catch {
        log(`${LOG_PREFIX} code=memory_cascade_failed`)
      }
    },
    close() {
      try {
        db.close()
      } catch {
        log(`${LOG_PREFIX} code=memory_db_close_failed`)
      }
    }
  }
}
