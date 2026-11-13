// Writes what one chunk yielded (addendum "Checking and writing candidates", "Writing"; D23, D26):
// 1. the tasks, through the goals store; 2. ONE `store.batch` with the items, the episode, the
// session's own tool saves' evidence (D26), the worked commands and `state.advance`. So the memory
// side is all or nothing and a written chunk is never read again; a failed one is read again whole.
// A task written before a failed batch stays, and is in the open tasks the next check of the same
// chunk is given, which turns the same title into an update of it (D17): no twin, nothing lost.
//
// Nothing inside the batch catches a throw: the batch has no savepoint, so a caught store throw
// would commit what came before it. Memory, task and command text are SENSITIVE: logs carry a
// `code=` only.
import {
  NO_COUNTS,
  type EpisodeText,
  type MemoryCounts,
  type MemoryText
} from '../../../shared/schemas/memory'
import type { GoalsStore } from '../../persistence/goals'
import type { MemoryCommands } from '../memoryCommands'
import type { MemoryStore, StoredSource } from '../memoryStore'
import { findValue, type Checked } from './checkCandidates'
import type { ExtractRow, ExtractState } from './extractState'
import type { CleanEntry } from './sliceCleaner'

export interface ApplyDeps {
  store: Pick<
    MemoryStore,
    'batch' | 'add' | 'edit' | 'touchSeen' | 'setEvidence' | 'agentSpecificsWithoutSource' | 'get'
  >
  commands: Pick<MemoryCommands, 'record'>
  state: Pick<ExtractState, 'advance'>
  /** null before app-ready: task candidates are then not written (`code=memory_task_write_failed`). */
  goals: Pick<GoalsStore, 'view' | 'addTaskFromExtraction' | 'updateTaskFromExtraction'> | null
  now: () => number
  log: (line: string) => void
}

export interface ChunkWrite {
  row: ExtractRow
  transcriptPath: string
  kept: readonly Checked[]
  note: string | null
  commands: readonly string[]
  entries: readonly CleanEntry[]
  next: { byteOffset: number; entryCount: number; prompts: number }
}

type Saved = { itemId: string; action: 'saved' | 'updated' }
type ItemCandidate = Extract<Checked, { kind: 'item' }>
type TaskCandidate = Extract<Checked, { kind: 'task' }>
type EpisodeCandidate = Extract<Checked, { kind: 'episode' }>

const LOG_PREFIX = '[claude-watcher][memory]'
const UPDATE_REASON = 'seen in session'
const EPISODE_AGAIN_REASON = 'session ended again'

const COUNT_KEY: Record<MemoryText['kind'], 'specifics' | 'facts'> = {
  specific: 'specifics',
  fact: 'facts'
}

function stored(path: string, source: { entryId: string; quote: string }): StoredSource {
  return { path, entryId: source.entryId, quote: source.quote }
}

/** Step 1: the tasks (D23). One the goals store refuses (or no store yet) is not written and is
 *  logged as a code: the refusal is the schema's, so a re-run would refuse it again. Answers how
 *  many were written. */
function writeTasks(deps: ApplyDeps, write: ChunkWrite, at: number): number {
  let written = 0
  for (const task of write.kept) {
    if (task.kind === 'task' && writeTask(deps, write.row, task, at)) written += 1
  }
  return written
}

function writeTask(deps: ApplyDeps, row: ExtractRow, task: TaskCandidate, at: number): boolean {
  const { goals } = deps
  if (goals === null) {
    deps.log(`${LOG_PREFIX} code=memory_task_write_failed`)
    return false
  }
  try {
    if (task.action === 'update' && task.id !== null) {
      // false: the task was closed or removed since the check; nothing is written.
      return goals.updateTaskFromExtraction(task.id, {
        check: task.check,
        leftWith: task.leftWith,
        at
      })
    }
    goals.addTaskFromExtraction({
      workspaceId: row.workspaceId,
      goalId: row.meta.goalId,
      title: task.title,
      check: task.check,
      leftWith: task.leftWith,
      originSessionId: row.originSessionId,
      folder: row.meta.folder,
      at
    })
    return true
  } catch {
    deps.log(`${LOG_PREFIX} code=memory_task_write_failed`)
    return false
  }
}

/** An item candidate, inside the batch. null: nothing written (a `none`, or an update of an item
 *  that is gone or of another kind since the scope was read). */
function writeItem(deps: ApplyDeps, write: ChunkWrite, c: ItemCandidate, at: number): Saved | null {
  const { store } = deps
  const source = stored(write.transcriptPath, c.source)
  if (c.action === 'none') {
    if (c.id !== null) store.touchSeen(c.id, at)
    return null
  }
  if (c.action === 'update' && c.id !== null) {
    // The operator may have deleted it while the call ran: that is their choice, kept.
    if (store.get(c.id)?.kind !== c.text.kind) return null
    store.edit(
      c.id,
      { text: c.text, check: c.check, evidence: { basis: c.basis, source } },
      'extract',
      UPDATE_REASON
    )
    return { itemId: c.id, action: 'updated' }
  }
  const added = store.add({
    text: c.text,
    workspaceId: write.row.workspaceId,
    check: c.check,
    basis: c.basis,
    origin: { by: 'extract', sessionId: write.row.originSessionId },
    meta: write.row.meta,
    source
  })
  return { itemId: added.id, action: 'saved' }
}

/** The episode, inside the batch: a new version of the row's episode while it exists, else a new
 *  one. Its basis is always `inferred` (D15). */
function writeEpisode(deps: ApplyDeps, write: ChunkWrite, c: EpisodeCandidate, at: number): Saved {
  const { store } = deps
  const text: EpisodeText = { kind: 'episode', title: c.title, body: c.body, endedAt: at }
  const source = c.source === null ? null : stored(write.transcriptPath, c.source)
  const current = write.row.episodeId
  if (current !== null && store.get(current)?.kind === 'episode') {
    store.edit(
      current,
      { text, check: null, evidence: { basis: 'inferred', source } },
      'extract',
      EPISODE_AGAIN_REASON
    )
    return { itemId: current, action: 'updated' }
  }
  const added = store.add({
    text,
    workspaceId: write.row.workspaceId,
    check: null,
    basis: 'inferred',
    origin: { by: 'extract', sessionId: write.row.originSessionId },
    meta: write.row.meta,
    source
  })
  return { itemId: added.id, action: 'saved' }
}

/** D26: the session's own `memory_save` specifics with no source get the basis and source of
 *  where their value is in this slice. Not counted, not a save. */
function giveToolSavesEvidence(deps: ApplyDeps, write: ChunkWrite): void {
  for (const own of deps.store.agentSpecificsWithoutSource(write.row.originSessionId)) {
    const found = findValue(own.value, write.entries)
    if (found === null) continue
    deps.store.setEvidence(own.id, {
      basis: found.basis,
      source: stored(write.transcriptPath, found)
    })
  }
}

/** Addendum "Writing". Order: 1. tasks, through the goals store (D23); 2. ONE `store.batch`: items,
 *  the episode, D26 for the session's own tool saves, commands, `state.advance`. Returns what was
 *  added (an `update` counts, a `none` does not) and the items written, for the activity record.
 *  Throws STORE_WRITE_FAILED when the batch fails; tasks already written stay. */
export function applyChunk(
  deps: ApplyDeps,
  write: ChunkWrite
): {
  added: MemoryCounts
  episodeId: string | null
  saved: { itemId: string; action: 'saved' | 'updated' }[]
} {
  const at = deps.now()
  const { row } = write
  const added: MemoryCounts = { ...NO_COUNTS, tasks: writeTasks(deps, write, at) }
  return deps.store.batch(() => {
    const saved: Saved[] = []
    let episodeId: string | null = null
    for (const c of write.kept) {
      if (c.kind === 'item') {
        const out = writeItem(deps, write, c, at)
        if (out === null) continue
        added[COUNT_KEY[c.text.kind]] += 1
        saved.push(out)
      } else if (c.kind === 'episode') {
        const out = writeEpisode(deps, write, c, at)
        episodeId = out.itemId
        added.episodes += 1
        saved.push(out)
      }
    }
    giveToolSavesEvidence(deps, write)
    const folder = row.meta.folder
    if (folder !== null) {
      for (const text of write.commands) {
        deps.commands.record({
          workspaceId: row.workspaceId,
          folder,
          text,
          sessionId: row.originSessionId,
          at
        })
      }
    }
    deps.state.advance(row.sessionId, {
      ...write.next,
      note: write.note,
      added,
      episodeId,
      at
    })
    return { added, episodeId, saved }
  })
}
