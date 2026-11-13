// Memory at app start (spec 2026-11-11 memory): open the database file once, tell storage health
// about a damaged or unopened file, and build the store. No store means memory is off for this
// run: the file could not be opened (`read_failed`), or this is the smoke test (which shares the
// default userData and must not write there). index.ts only calls this and holds the result.
// An opened memory drives the `memory:changed` push (`onChange`): a store change, whoever made
// it, and an activity change (a tool's pull changes no stored item, yet Context lists it).
//
// The same database holds the shell commands that worked (`memoryCommands.ts`) and each
// session's save state (`extract/extractState.ts`, phase 2), built here beside the store.
//
// The two calls that run where nothing can show a failure never throw: a workspace delete's
// cascade (the delete is already committed; the store reported the refused write) and the close
// on quit. Each logs a `code=` only.
import type { StorageReporter } from '../persistence/persistedBlob'
import { createExtractState, type ExtractState } from './extract/extractState'
import type { MemoryActivityLog } from './memoryActivity'
import { createMemoryCommands, type MemoryCommands } from './memoryCommands'
import { openMemoryDb } from './memoryDb'
import { createMemoryStore, type MemoryStore } from './memoryStore'

const LOG_PREFIX = '[claude-watcher][memory]'

export interface OpenedMemory {
  store: MemoryStore
  commands: MemoryCommands
  /** Each session's save state; logs through main's logger. */
  extractState: ExtractState
  /** The workspace delete cascade: removes the workspace's items, commands and save state (each
   *  its own step, so one refused delete does not keep the others), never throws. */
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
  const commands = createMemoryCommands({ db, newId })
  const extractState = createExtractState({ db, log })
  store.onChange(deps.onChange)
  deps.activity.onChange(deps.onChange)
  const cascadeStep = (step: () => void): void => {
    try {
      step()
    } catch {
      log(`${LOG_PREFIX} code=memory_cascade_failed`)
    }
  }
  return {
    store,
    commands,
    extractState,
    removeByWorkspace(workspaceId) {
      cascadeStep(() => store.removeByWorkspace(workspaceId))
      cascadeStep(() => commands.removeByWorkspace(workspaceId))
      cascadeStep(() => extractState.removeByWorkspace(workspaceId))
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
