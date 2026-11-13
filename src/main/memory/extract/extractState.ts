// How far each session's transcript was read for memory (memory phase 2): one `extract_state` row
// per transcript, keyed by the transcript's own id (`session_id`, never changes), holding the
// card's id now (`origin_session_id`, follows `/clear`), the offsets read so far, the progress
// notes, the phase and what was saved. No method opens its own transaction: a save calls them
// inside `store.batch`, so the row and the items it wrote commit together. Notes are SENSITIVE
// like memory text: nothing here logs. Every row goes through Zod, its JSON columns included.
import { z } from 'zod'
import {
  MemoryCountsSchema,
  NO_COUNTS,
  type MemoryCounts,
  type MemoryItem
} from '../../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../../shared/schemas/memoryExtract'
import type { MemoryDb } from '../memoryDb'
import { ItemMetaSchema, jsonColumn } from '../memoryRows'

const EXTRACT_PHASES = ['live', 'ending', 'done'] as const
export type ExtractPhase = (typeof EXTRACT_PHASES)[number]
export type ExtractRow = {
  sessionId: string
  originSessionId: string
  workspaceId: string
  meta: MemoryItem['meta']
  byteOffset: number
  entryCount: number
  prompts: number
  notes: string[]
  phase: ExtractPhase
  attempts: number
  counts: MemoryCounts
  episodeId: string | null
  updatedAt: number
}

export interface ExtractState {
  get(sessionId: string): ExtractRow | null
  /** Makes the row (offset 0, no notes, zero counts) or refreshes `originSessionId`, `workspaceId`,
   *  `meta` and `phase` of the one that is there. Its offsets, notes and counts are never reset. */
  track(input: {
    sessionId: string
    originSessionId: string
    workspaceId: string
    meta: MemoryItem['meta']
    phase: 'live' | 'ending'
    at: number
  }): ExtractRow
  /** One chunk written (a session with no row throws `extract_state_not_found`): new offsets, `attempts = 0`, `added` summed into `counts`, `note` appended
   *  (newest EXTRACT_LIMITS.notesKept kept), `episodeId` kept when the step gives null. */
  advance(
    sessionId: string,
    step: {
      byteOffset: number
      entryCount: number
      prompts: number
      note: string | null
      added: MemoryCounts
      episodeId: string | null
      at: number
    }
  ): void
  /** attempts + 1; returns the new value. */
  failed(sessionId: string, at: number): number
  /** A session with no row (one that ran with Memory off was never tracked): nothing, no throw,
   *  no row made. `advance` and `failed` on such a session throw `extract_state_not_found`. */
  setPhase(sessionId: string, phase: ExtractPhase, at: number): void
  /** Rows in phase 'live' or 'ending', oldest `updated_at` first. */
  pending(): ExtractRow[]
  /** Rows whose `session_id` OR `origin_session_id` is `sessionId`; returns their `session_id`s. */
  remove(sessionId: string): string[]
  removeByWorkspace(workspaceId: string): string[]
  rebindOrigin(oldId: string, newId: string): void
}

/** `advance` and `failed` on a session with no row: a bug in the caller (it tracks first),
 *  thrown so the batch around it rolls back. `setPhase` there does nothing. */
const NO_ROW = 'extract_state_not_found'

const COLUMNS = `session_id, origin_session_id, workspace_id, meta, byte_offset, entry_count,
  prompts, notes, phase, attempts, counts, episode_id, updated_at`

const StateRow = z
  .object({
    session_id: z.string(),
    origin_session_id: z.string(),
    workspace_id: z.string(),
    meta: jsonColumn(ItemMetaSchema),
    byte_offset: z.number(),
    entry_count: z.number(),
    prompts: z.number(),
    notes: jsonColumn(z.array(z.string())),
    phase: z.enum(EXTRACT_PHASES),
    attempts: z.number(),
    counts: jsonColumn(MemoryCountsSchema),
    episode_id: z.string().nullable(),
    updated_at: z.number()
  })
  .transform(
    (r): ExtractRow => ({
      sessionId: r.session_id,
      originSessionId: r.origin_session_id,
      workspaceId: r.workspace_id,
      meta: r.meta,
      byteOffset: r.byte_offset,
      entryCount: r.entry_count,
      prompts: r.prompts,
      notes: r.notes,
      phase: r.phase,
      attempts: r.attempts,
      counts: r.counts,
      episodeId: r.episode_id,
      updatedAt: r.updated_at
    })
  )

const SessionIdRow = z.object({ session_id: z.string() })

function sum(a: MemoryCounts, b: MemoryCounts): MemoryCounts {
  return {
    specifics: a.specifics + b.specifics,
    facts: a.facts + b.facts,
    tasks: a.tasks + b.tasks,
    episodes: a.episodes + b.episodes
  }
}

export function createExtractState(deps: { db: MemoryDb }): ExtractState {
  const { db } = deps

  function find(sessionId: string): ExtractRow | null {
    return db.get(`SELECT ${COLUMNS} FROM extract_state WHERE session_id = ?`, StateRow, [
      sessionId
    ])
  }

  function mustRow(sessionId: string): ExtractRow {
    const row = find(sessionId)
    if (row === null) throw new Error(NO_ROW)
    return row
  }

  /** Deletes the rows `where` picks; answers their `session_id`s. */
  function removeWhere(where: string, params: readonly string[]): string[] {
    const ids = db
      .all(`SELECT session_id FROM extract_state WHERE ${where}`, SessionIdRow, params)
      .map((r) => r.session_id)
    db.run(`DELETE FROM extract_state WHERE ${where}`, params)
    return ids
  }

  return {
    get: (sessionId) => find(sessionId),

    track: (input) => {
      db.run(
        `INSERT INTO extract_state (${COLUMNS})
         VALUES (?, ?, ?, ?, 0, 0, 0, '[]', ?, 0, ?, NULL, ?)
         ON CONFLICT (session_id) DO UPDATE SET origin_session_id = excluded.origin_session_id,
           workspace_id = excluded.workspace_id, meta = excluded.meta, phase = excluded.phase,
           updated_at = excluded.updated_at`,
        [
          input.sessionId,
          input.originSessionId,
          input.workspaceId,
          JSON.stringify(input.meta),
          input.phase,
          JSON.stringify(NO_COUNTS),
          input.at
        ]
      )
      return mustRow(input.sessionId)
    },

    advance: (sessionId, step) => {
      const row = mustRow(sessionId)
      const notes = step.note === null ? row.notes : [...row.notes, step.note]
      db.run(
        `UPDATE extract_state SET byte_offset = ?, entry_count = ?, prompts = ?, notes = ?,
           attempts = 0, counts = ?, episode_id = ?, updated_at = ?
         WHERE session_id = ?`,
        [
          step.byteOffset,
          step.entryCount,
          step.prompts,
          JSON.stringify(notes.slice(-EXTRACT_LIMITS.notesKept)),
          JSON.stringify(sum(row.counts, step.added)),
          step.episodeId ?? row.episodeId,
          step.at,
          sessionId
        ]
      )
    },

    failed: (sessionId, at) => {
      const attempts = mustRow(sessionId).attempts + 1
      db.run('UPDATE extract_state SET attempts = ?, updated_at = ? WHERE session_id = ?', [
        attempts,
        at,
        sessionId
      ])
      return attempts
    },

    setPhase: (sessionId, phase, at) => {
      // No row: nothing to mark (R8). The UPDATE matches no row and makes none.
      db.run('UPDATE extract_state SET phase = ?, updated_at = ? WHERE session_id = ?', [
        phase,
        at,
        sessionId
      ])
    },

    pending: () =>
      db.all(
        `SELECT ${COLUMNS} FROM extract_state WHERE phase IN ('live', 'ending')
         ORDER BY updated_at, session_id`,
        StateRow
      ),

    remove: (sessionId) =>
      removeWhere('session_id = ? OR origin_session_id = ?', [sessionId, sessionId]),

    removeByWorkspace: (workspaceId) => removeWhere('workspace_id = ?', [workspaceId]),

    rebindOrigin: (oldId, newId) => {
      db.run('UPDATE extract_state SET origin_session_id = ? WHERE origin_session_id = ?', [
        newId,
        oldId
      ])
    }
  }
}
