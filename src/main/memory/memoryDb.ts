// The memory database (spec 2026-11-11 memory §2): the ONE importer of `node:sqlite`. It opens the
// file, creates and migrates the tables, and fails safe: a corrupt file (not a database, or
// damaged past its header: `PRAGMA quick_check` at open) is renamed (kept, never deleted) and an
// empty one starts; a file it cannot open, or one a newer app wrote, is refused
// without a write. Every row it hands out goes through a Zod schema; one that fails is logged by
// path and issue code. A SQLite error can carry text from the database, so logs carry `code=`
// only, never an error or a message.
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
 *  tagIds, templateId, goalId, taskIds). The text lives in `version` (newest = current, `seq`
 *  breaks a tie on `at`), each with the basis of its own text (the item's `basis` is the current
 *  one's); the two FTS5 indexes hold the current head (key/title) and body
 *  (value/body) under the item's `rid` as their rowid, and are written in the same transaction as
 *  the row. `rid` and `seq` are explicit INTEGER PRIMARY KEYs: VACUUM may renumber an implicit
 *  rowid, and the indexes must keep pointing at their item. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE item (
     rid INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
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
     seq INTEGER PRIMARY KEY,
     item_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
     at INTEGER NOT NULL,
     by TEXT NOT NULL CHECK (by IN ('agent', 'extract', 'operator')),
     basis TEXT NOT NULL CHECK (basis IN ('observed', 'stated', 'inferred')),
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

/** A row that fails its schema is logged (path and code only: the row is operator text) and
 *  thrown with the same code, which the store turns into a failed read or write. */
function parseRow<T>(schema: z.ZodType<T>, row: unknown, log: (code: string) => void): T {
  const parsed = schema.safeParse(row)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const code = `memory_db_row_invalid path=${issue?.path.join('.') ?? ''} issue=${issue?.code ?? ''}`
  log(code)
  throw new Error(`code=${code}`)
}

function userVersion(raw: DatabaseSync, log: (code: string) => void): number {
  return parseRow(UserVersionRow, raw.prepare('PRAGMA user_version').get(), log).user_version
}

const QuickCheckRow = z.object({ quick_check: z.literal('ok') })

/** Reads the file through a read-only connection before any write: a read-write close would
 *  checkpoint a leftover `-wal` into the file, and a refused or damaged file must keep its bytes
 *  (seen with SQLite 3.53.1: a read-only `quick_check` leaves the file and its `-wal` as they
 *  were). Answers `user_version`, or `'corrupt'` when `PRAGMA quick_check` throws (a page past the
 *  header is damaged: SQLITE_CORRUPT, which `attemptOpen` turns into a backup) or answers anything
 *  but one `ok` row. A newer file is not checked: it is refused untouched, never backed up. */
function inspectOnDisk(file: string, log: (code: string) => void): number | 'corrupt' {
  if (file === IN_MEMORY || !existsSync(file)) return 0
  const probe = new DatabaseSync(file, { readOnly: true })
  try {
    const version = userVersion(probe, log)
    if (version > MEMORY_SCHEMA_VERSION) return version
    const rows = probe.prepare('PRAGMA quick_check').all()
    const healthy = rows.length === 1 && QuickCheckRow.safeParse(rows[0]).success
    return healthy ? version : 'corrupt'
  } finally {
    probe.close()
  }
}

function migrate(raw: DatabaseSync, from: number, log: (code: string) => void): void {
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
  if (userVersion(raw, log) !== MEMORY_SCHEMA_VERSION)
    throw new Error('code=memory_db_migration_check')
}

function wrap(raw: DatabaseSync, log: (code: string) => void): MemoryDb {
  return {
    run: (sql, params = []) => {
      raw.prepare(sql).run(...params)
    },
    all: (sql, schema, params = []) =>
      raw
        .prepare(sql)
        .all(...params)
        .map((row) => parseRow(schema, row, log)),
    get: (sql, schema, params = []) => {
      const row = raw.prepare(sql).get(...params)
      return row === undefined ? null : parseRow(schema, row, log)
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
    // Read before any write: switching journal_mode or migrating would touch a newer file, and a
    // damaged one must be backed up as it is.
    const onDisk = inspectOnDisk(file, log)
    if (onDisk === 'corrupt') return 'corrupt'
    if (onDisk > MEMORY_SCHEMA_VERSION) {
      log('memory_db_newer_version')
      return READ_FAILED
    }
    const raw = new DatabaseSync(file)
    let kept = false
    try {
      const from = userVersion(raw, log)
      // Another writer between the probe and this open: still refuse before any write.
      if (from > MEMORY_SCHEMA_VERSION) {
        log('memory_db_newer_version')
        return READ_FAILED
      }
      raw.exec('PRAGMA journal_mode = WAL')
      raw.exec('PRAGMA foreign_keys = ON')
      migrate(raw, from, log)
      kept = true
      return { ok: true, db: wrap(raw, log), problem: null }
    } finally {
      if (!kept) raw.close()
    }
  } catch (e) {
    if (isCorrupt(e)) return 'corrupt'
    log('memory_db_read_failed')
    return READ_FAILED
  }
}

/** Renames the side files, then the file, to `<file>.corrupt-<now>[-wal|-shm]`; false when the
 *  set could not be moved aside, and then nothing new is created.
 *  Invariant: on false, every rename that already happened has been undone (newest first), so
 *  `<file>`, `<file>-wal` and `<file>-shm` hold what they held before. Only an undo that itself
 *  throws breaks it; that is logged (`memory_db_backup_undo_failed`) and the backup names keep
 *  the bytes. The main file moves last, so the original name never stands without its set. */
function backUpCorrupt(file: string, now: number, log: (code: string) => void): boolean {
  const backup = `${file}.corrupt-${now}`
  const moves = [
    ...SIDE_FILES.filter((side) => existsSync(`${file}${side}`)).map((side) => ({
      from: `${file}${side}`,
      to: `${backup}${side}`
    })),
    { from: file, to: backup }
  ]
  const done: typeof moves = []
  try {
    for (const move of moves) {
      renameSync(move.from, move.to)
      done.push(move)
    }
    return true
  } catch {
    log('memory_db_read_failed')
    for (const move of done.reverse()) {
      try {
        renameSync(move.to, move.from)
      } catch {
        log('memory_db_backup_undo_failed')
      }
    }
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
        `INSERT INTO version (item_id, at, by, basis, reason, head, body)
         VALUES (?, 0, 'operator', 'stated', NULL, 'smoke harbour', 'port 9281')`,
        [SMOKE_ID]
      )
      for (const index of ['item_words', 'item_trigram']) {
        db.run(
          `INSERT INTO ${index} (rowid, item_id, head, body)
           SELECT rid, id, 'smoke harbour', 'port 9281' FROM item WHERE id = ?`,
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
