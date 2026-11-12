// The memory database (spec 2026-11-11 memory §2): the ONE importer of `node:sqlite`. It opens the
// file, creates and migrates the tables, and fails safe: a corrupt file is renamed (kept, never
// deleted) and an empty one starts; a file it cannot open, or one a newer app wrote, is refused
// without a write. Every row it hands out goes through a Zod schema. A SQLite error can carry text
// from the database, so logs carry `code=` only, never an error or a message.
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export const MEMORY_DB_FILE = 'claude-watcher-memory.db'
export const MEMORY_SCHEMA_VERSION = 1

export type SqlValue = string | number | null

export interface MemoryDb {
  run(sql: string, params?: readonly SqlValue[]): void
  /** Each row goes through `schema`; a row that fails throws (a bug, not operator data). */
  all<T>(sql: string, schema: z.ZodType<T>, params?: readonly SqlValue[]): T[]
  get<T>(sql: string, schema: z.ZodType<T>, params?: readonly SqlValue[]): T | null
  /** All-or-nothing: a throw inside rolls back and rethrows. */
  transaction<T>(work: () => T): T
  close(): void
}

export type MemoryDbOpen =
  | { ok: true; db: MemoryDb; problem: 'corrupt_reset' | null }
  | { ok: false; problem: 'read_failed' }

interface OpenDeps {
  now: () => number
  log: (line: string) => void
}

const LOG_PREFIX = '[claude-watcher][memory]'
const IN_MEMORY = ':memory:'
const READ_FAILED: MemoryDbOpen = { ok: false, problem: 'read_failed' }
/** SQLite primary result codes that mean "the bytes are not a sound database". */
const SQLITE_CORRUPT = 11
const SQLITE_NOTADB = 26
/** The side files SQLite keeps next to a WAL database; a backup takes them along. */
const SIDE_FILES: readonly string[] = ['-wal', '-shm']

/** `MIGRATIONS[n]` takes a file from `user_version` n to n + 1, inside one transaction.
 *  `item` holds what lists filter on as real columns and the rest in `meta` (JSON: sessionName,
 *  tagIds, templateId, goalId, taskIds). The text lives in `version` (newest = current); the two
 *  FTS5 indexes hold the current head (key/title) and body (value/body) and are written in the
 *  same transaction as the row. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE item (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('specific', 'fact')),
     workspace_id TEXT,
     state TEXT NOT NULL CHECK (state IN ('active', 'stale')),
     pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
     basis TEXT NOT NULL CHECK (basis IN ('observed', 'stated', 'inferred')),
     check_text TEXT,
     folder TEXT,
     origin_by TEXT NOT NULL CHECK (origin_by IN ('agent', 'extract', 'operator')),
     origin_session_id TEXT,
     origin_deleted_at INTEGER,
     last_seen_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     meta TEXT NOT NULL CHECK (json_valid(meta))
   ) STRICT;
   CREATE INDEX item_scope ON item (workspace_id, kind, state, updated_at);
   CREATE TABLE version (
     item_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     by TEXT NOT NULL CHECK (by IN ('agent', 'extract', 'operator')),
     reason TEXT,
     head TEXT NOT NULL,
     body TEXT NOT NULL
   ) STRICT;
   CREATE INDEX version_item ON version (item_id, at);
   CREATE VIRTUAL TABLE item_words USING fts5 (item_id UNINDEXED, head, body);
   CREATE VIRTUAL TABLE item_trigram USING fts5 (item_id UNINDEXED, head, body, tokenize = 'trigram');`
]

const UserVersionRow = z.object({ user_version: z.number().int() })

function sqliteCode(e: unknown): number | null {
  if (typeof e !== 'object' || e === null || !('errcode' in e)) return null
  // Extended codes (SQLITE_CORRUPT_VTAB …) keep the primary code in the low byte.
  return typeof e.errcode === 'number' ? e.errcode & 0xff : null
}

function isCorrupt(e: unknown): boolean {
  const code = sqliteCode(e)
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB
}

function parseRow<T>(schema: z.ZodType<T>, row: unknown): T {
  const parsed = schema.safeParse(row)
  if (parsed.success) return parsed.data
  // Path and code only: the row is operator text.
  const issue = parsed.error.issues[0]
  throw new Error(
    `code=memory_db_row_invalid path=${issue?.path.join('.') ?? ''} issue=${issue?.code ?? ''}`
  )
}

function userVersion(raw: DatabaseSync): number {
  return parseRow(UserVersionRow, raw.prepare('PRAGMA user_version').get()).user_version
}

/** Reads `user_version` through a read-only connection: a read-write close would checkpoint a
 *  leftover `-wal` into the file, and a refused file must stay byte for byte as it was. */
function versionOnDisk(file: string): number {
  if (file === IN_MEMORY || !existsSync(file)) return 0
  const probe = new DatabaseSync(file, { readOnly: true })
  try {
    return userVersion(probe)
  } finally {
    probe.close()
  }
}

function migrate(raw: DatabaseSync, from: number): void {
  if (from === MEMORY_SCHEMA_VERSION) return
  raw.exec('BEGIN IMMEDIATE')
  try {
    for (let v = from; v < MEMORY_SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v]
      if (step === undefined) throw new Error(`code=memory_db_migration_missing to=${v + 1}`)
      raw.exec(step)
    }
    raw.exec(`PRAGMA user_version = ${MEMORY_SCHEMA_VERSION}`)
    raw.exec('COMMIT')
  } catch (e) {
    if (raw.isTransaction) raw.exec('ROLLBACK')
    throw e
  }
  // A migration is checked after it runs (spec §2).
  if (userVersion(raw) !== MEMORY_SCHEMA_VERSION) throw new Error('code=memory_db_migration_check')
}

function wrap(raw: DatabaseSync): MemoryDb {
  return {
    run: (sql, params = []) => {
      raw.prepare(sql).run(...params)
    },
    all: (sql, schema, params = []) =>
      raw
        .prepare(sql)
        .all(...params)
        .map((row) => parseRow(schema, row)),
    get: (sql, schema, params = []) => {
      const row = raw.prepare(sql).get(...params)
      return row === undefined ? null : parseRow(schema, row)
    },
    transaction: (work) => {
      raw.exec('BEGIN IMMEDIATE')
      try {
        const out = work()
        raw.exec('COMMIT')
        return out
      } catch (e) {
        if (raw.isTransaction) raw.exec('ROLLBACK')
        throw e
      }
    },
    close: () => {
      raw.close()
    }
  }
}

type Attempt = MemoryDbOpen | 'corrupt'

function attemptOpen(file: string, log: (code: string) => void): Attempt {
  try {
    // Read before any write: switching journal_mode or migrating would touch a newer file.
    if (versionOnDisk(file) > MEMORY_SCHEMA_VERSION) {
      log('memory_db_newer_version')
      return READ_FAILED
    }
    const raw = new DatabaseSync(file)
    let kept = false
    try {
      const from = userVersion(raw)
      // Another writer between the probe and this open: still refuse before any write.
      if (from > MEMORY_SCHEMA_VERSION) {
        log('memory_db_newer_version')
        return READ_FAILED
      }
      raw.exec('PRAGMA journal_mode = WAL')
      raw.exec('PRAGMA foreign_keys = ON')
      migrate(raw, from)
      kept = true
      return { ok: true, db: wrap(raw), problem: null }
    } finally {
      if (!kept) raw.close()
    }
  } catch (e) {
    if (isCorrupt(e)) return 'corrupt'
    log('memory_db_read_failed')
    return READ_FAILED
  }
}

/** Renames the file and its side files to `<file>.corrupt-<now>[-wal|-shm]`; false when the
 *  file could not be moved aside (then nothing new is created over it). */
function backUpCorrupt(file: string, now: number, log: (code: string) => void): boolean {
  const backup = `${file}.corrupt-${now}`
  try {
    renameSync(file, backup)
    for (const side of SIDE_FILES) {
      if (existsSync(`${file}${side}`)) renameSync(`${file}${side}`, `${backup}${side}`)
    }
    return true
  } catch {
    log('memory_db_read_failed')
    return false
  }
}

/** `file` is a path or ':memory:'. Creates the tables on a new file, migrates an older
 *  `user_version`, and on a corrupt file renames it to `<file>.corrupt-<now>` and starts empty. */
export function openMemoryDb(file: string, deps: OpenDeps): MemoryDbOpen {
  const log = (code: string): void => deps.log(`${LOG_PREFIX} code=${code}`)
  const first = attemptOpen(file, log)
  if (first !== 'corrupt') return first
  if (!backUpCorrupt(file, deps.now(), log)) return READ_FAILED
  log('memory_db_corrupt_reset')
  const fresh = attemptOpen(file, log)
  if (fresh === 'corrupt') {
    log('memory_db_read_failed')
    return READ_FAILED
  }
  return fresh.ok ? { ...fresh, problem: 'corrupt_reset' } : fresh
}

const SMOKE_ID = 'smoke-item'
const IdRow = z.object({ id: z.string() })

/** Smoke: open a file in `dir`, write one row, find it by a word and by three characters. */
export function memorySmokeCheck(dir: string): { pass: boolean } {
  const log = (line: string): void => console.error(line)
  const open = openMemoryDb(join(dir, MEMORY_DB_FILE), { now: Date.now, log })
  if (!open.ok) return { pass: false }
  const { db } = open
  try {
    db.transaction(() => {
      db.run(
        `INSERT INTO item (id, kind, workspace_id, state, pinned, basis, check_text, folder,
           origin_by, origin_session_id, origin_deleted_at, last_seen_at, created_at, updated_at,
           meta)
         VALUES (?, 'specific', NULL, 'active', 0, 'stated', NULL, NULL, 'operator', NULL, NULL,
           0, 0, 0, '{}')`,
        [SMOKE_ID]
      )
      db.run(
        `INSERT INTO version (item_id, at, by, reason, head, body)
         VALUES (?, 0, 'operator', NULL, 'smoke harbour', 'port 9281')`,
        [SMOKE_ID]
      )
      for (const index of ['item_words', 'item_trigram']) {
        db.run(
          `INSERT INTO ${index} (item_id, head, body) VALUES (?, 'smoke harbour', 'port 9281')`,
          [SMOKE_ID]
        )
      }
    })
    const byWord = db.get('SELECT item_id AS id FROM item_words WHERE item_words MATCH ?', IdRow, [
      'harbour'
    ])
    // Three characters inside a token: only the trigram index finds them.
    const byChars = db.get(
      'SELECT item_id AS id FROM item_trigram WHERE item_trigram MATCH ?',
      IdRow,
      ['"281"']
    )
    return { pass: byWord?.id === SMOKE_ID && byChars?.id === SMOKE_ID }
  } catch {
    log(`${LOG_PREFIX} code=memory_db_smoke_failed`)
    return { pass: false }
  } finally {
    db.close()
  }
}
