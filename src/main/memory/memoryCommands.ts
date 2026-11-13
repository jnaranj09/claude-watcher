// The shell commands that worked (memory phase 2): one counted row per workspace, folder and
// text, the newest `EXTRACT_LIMITS.commandsPerWorkspace` of a workspace kept. A row is shared by
// every session that ran the command, so deleting a session's memory never deletes one (D36).
// No method opens its own transaction: extraction calls `record` inside `store.batch`, and every
// other method is one statement or a read. Command text is SENSITIVE: nothing here logs.
import { z } from 'zod'
import { MEMORY_ERROR, MemoryCommandSchema, type MemoryCommand } from '../../shared/schemas/memory'
import { EXTRACT_LIMITS } from '../../shared/schemas/memoryExtract'
import { folderAtOrUnder, type SqlClause } from './filterSql'
import type { MemoryDb } from './memoryDb'
import { CountRow } from './memoryRows'

export interface MemoryCommands {
  /** One row per workspace, folder and text: count + 1, last_at, last_session_id,
   *  session_deleted_at cleared. Then only the newest `EXTRACT_LIMITS.commandsPerWorkspace` rows
   *  of the workspace stay. */
  record(input: {
    workspaceId: string
    folder: string
    text: string
    sessionId: string
    at: number
  }): void
  /** Newest first. `query`: every whitespace-separated term must be in the text (case ignored).
   *  `folder`: that folder and below, on a path boundary. */
  list(
    workspaceId: string,
    input: { query: string | null; folder: string | null; offset: number; limit: number }
  ): { rows: MemoryCommand[]; total: number }
  /** An unknown id throws `MEMORY_ERROR.commandNotFound`. */
  remove(id: string): void
  removeByWorkspace(workspaceId: string): number
  /** Marks the rows whose last run was `sessionId`; a row already marked keeps its first date. */
  markSessionDeleted(sessionId: string, at: number): number
  rebindSession(oldId: string, newId: string): void
}

const NEWEST_FIRST = 'last_at DESC, rid DESC'

const CommandRow = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    folder: z.string(),
    text: z.string(),
    count: z.number(),
    last_at: z.number(),
    session_deleted_at: z.number().nullable()
  })
  .transform(
    (r): z.input<typeof MemoryCommandSchema> => ({
      id: r.id,
      workspaceId: r.workspace_id,
      folder: r.folder,
      text: r.text,
      count: r.count,
      lastAt: r.last_at,
      sessionDeletedAt: r.session_deleted_at
    })
  )
  .pipe(MemoryCommandSchema)

/** Each term as a plain substring of the text, case ignored: `instr`, so `%` and `_` are plain
 *  characters (no LIKE). */
function termClauses(query: string | null): SqlClause[] {
  const terms = (query ?? '').split(/\s+/).filter((t) => t !== '')
  return terms.map((t) => ({ sql: 'instr(lower(text), lower(?)) > 0', params: [t] }))
}

export function createMemoryCommands(deps: { db: MemoryDb; newId: () => string }): MemoryCommands {
  const { db, newId } = deps

  function changes(): number {
    return db.get('SELECT changes() AS n', CountRow)?.n ?? 0
  }

  return {
    record: (input) => {
      db.run(
        `INSERT INTO command (id, workspace_id, folder, text, count, last_at, last_session_id,
           session_deleted_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, NULL)
         ON CONFLICT (workspace_id, folder, text) DO UPDATE SET count = count + 1,
           last_at = excluded.last_at, last_session_id = excluded.last_session_id,
           session_deleted_at = NULL`,
        [newId(), input.workspaceId, input.folder, input.text, input.at, input.sessionId]
      )
      db.run(
        `DELETE FROM command WHERE workspace_id = ? AND rid NOT IN (
           SELECT rid FROM command WHERE workspace_id = ? ORDER BY ${NEWEST_FIRST} LIMIT ?)`,
        [input.workspaceId, input.workspaceId, EXTRACT_LIMITS.commandsPerWorkspace]
      )
    },

    list: (workspaceId, input) => {
      const clauses: SqlClause[] = [
        { sql: 'workspace_id = ?', params: [workspaceId] },
        ...(input.folder === null ? [] : [folderAtOrUnder('folder', input.folder)]),
        ...termClauses(input.query)
      ]
      const where = clauses.map((c) => c.sql).join(' AND ')
      const params = clauses.flatMap((c) => c.params)
      return {
        total: db.get(`SELECT COUNT(*) AS n FROM command WHERE ${where}`, CountRow, params)?.n ?? 0,
        rows: db.all(
          `SELECT id, workspace_id, folder, text, count, last_at, session_deleted_at FROM command
           WHERE ${where} ORDER BY ${NEWEST_FIRST} LIMIT ? OFFSET ?`,
          CommandRow,
          [...params, input.limit, input.offset]
        )
      }
    },

    remove: (id) => {
      db.run('DELETE FROM command WHERE id = ?', [id])
      if (changes() === 0) throw new Error(MEMORY_ERROR.commandNotFound)
    },

    removeByWorkspace: (workspaceId) => {
      db.run('DELETE FROM command WHERE workspace_id = ?', [workspaceId])
      return changes()
    },

    markSessionDeleted: (sessionId, at) => {
      db.run(
        `UPDATE command SET session_deleted_at = ?
         WHERE last_session_id = ? AND session_deleted_at IS NULL`,
        [at, sessionId]
      )
      return changes()
    },

    rebindSession: (oldId, newId) => {
      db.run('UPDATE command SET last_session_id = ? WHERE last_session_id = ?', [newId, oldId])
    }
  }
}
