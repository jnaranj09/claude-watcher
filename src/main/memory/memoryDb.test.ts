// The memory database module (spec 2026-11-11 memory §2): opens, migrates, fails safe.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MEMORY_DB_FILE,
  MEMORY_SCHEMA_VERSION,
  memorySmokeCheck,
  openMemoryDb,
  type MemoryDb
} from './memoryDb'

const VersionRow = z.object({ user_version: z.number() })
const CountRow = z.object({ n: z.number() })
const JournalRow = z.object({ journal_mode: z.string() })

let dir: string
let file: string
let lines: string[]
const deps = {
  now: () => 1_700_000_000_000,
  log: (line: string) => {
    lines.push(line)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-watcher-memory-db-'))
  file = join(dir, MEMORY_DB_FILE)
  lines = []
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function openOk(path: string): MemoryDb {
  const open = openMemoryDb(path, deps)
  if (!open.ok) throw new Error('open failed')
  return open.db
}

function insertItem(db: MemoryDb, id: string): void {
  db.run(
    `INSERT INTO item (id, kind, workspace_id, state, pinned, basis, check_text, folder,
       origin_by, origin_session_id, origin_deleted_at, last_seen_at, created_at, updated_at, meta)
     VALUES (?, 'fact', NULL, 'active', 0, 'stated', NULL, NULL, 'operator', NULL, NULL, 1, 1, 1, '{}')`,
    [id]
  )
}

/** A file a later app version wrote: our tables, one row, a higher `user_version`. */
function writeVersion(path: string, version: number): void {
  const db = openOk(path)
  insertItem(db, 'a')
  db.run(`PRAGMA user_version = ${version}`)
  db.close()
}

describe('openMemoryDb', () => {
  it('creates version 1 on a new file and reopens it without change', () => {
    const first = openOk(file)
    expect(first.get('PRAGMA user_version', VersionRow)).toEqual({ user_version: 1 })
    expect(first.get('PRAGMA journal_mode', JournalRow)).toEqual({ journal_mode: 'wal' })
    insertItem(first, 'a')
    first.close()
    const again = openMemoryDb(file, deps)
    expect(again).toMatchObject({ ok: true, problem: null })
    const db = openOk(file)
    expect(db.get('PRAGMA user_version', VersionRow)).toEqual({
      user_version: MEMORY_SCHEMA_VERSION
    })
    expect(db.get('SELECT count(*) AS n FROM item', CountRow)).toEqual({ n: 1 })
    db.close()
  })

  it('opens an in-memory database with the tables', () => {
    const db = openOk(':memory:')
    expect(db.get('PRAGMA user_version', VersionRow)).toEqual({ user_version: 1 })
    expect(db.all('SELECT count(*) AS n FROM version', CountRow)).toEqual([{ n: 0 }])
    db.close()
  })

  it('rolls a failed transaction back', () => {
    const db = openOk(':memory:')
    expect(() =>
      db.transaction(() => {
        insertItem(db, 'a')
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.get('SELECT count(*) AS n FROM item', CountRow)).toEqual({ n: 0 })
    db.close()
  })

  it('commits a transaction and returns its value', () => {
    const db = openOk(':memory:')
    expect(db.transaction(() => (insertItem(db, 'a'), 7))).toBe(7)
    expect(db.get('SELECT count(*) AS n FROM item', CountRow)).toEqual({ n: 1 })
    db.close()
  })

  it('answers null from get when no row matches', () => {
    const db = openOk(':memory:')
    expect(db.get('SELECT 1 AS n WHERE 0', CountRow)).toBeNull()
    db.close()
  })

  it('throws a code, not the row, when a row fails its schema', () => {
    const db = openOk(':memory:')
    expect(() => db.get("SELECT 'secret text' AS n", CountRow)).toThrow(
      /^code=memory_db_row_invalid path=n issue=invalid_type$/
    )
    db.close()
  })

  it('logs the path and code of a row that fails its schema, never its value', () => {
    const db = openOk(':memory:')
    lines = []
    expect(() => db.all("SELECT 'secret text' AS n", CountRow)).toThrow()
    expect(lines).toEqual([
      '[claude-watcher][memory] code=memory_db_row_invalid path=n issue=invalid_type'
    ])
    db.close()
  })

  it('backs a corrupt file up and starts empty', () => {
    writeFileSync(file, 'not a database')
    writeFileSync(`${file}-wal`, 'side file')
    const open = openMemoryDb(file, deps)
    expect(open).toMatchObject({ ok: true, problem: 'corrupt_reset' })
    const names = readdirSync(dir)
    const backup = names.find(
      (n) => n.startsWith(`${MEMORY_DB_FILE}.corrupt-`) && !n.includes('-wal')
    )
    expect(backup).toBe(`${MEMORY_DB_FILE}.corrupt-1700000000000`)
    expect(readFileSync(join(dir, `${MEMORY_DB_FILE}.corrupt-1700000000000`), 'utf8')).toBe(
      'not a database'
    )
    expect(readFileSync(join(dir, `${MEMORY_DB_FILE}.corrupt-1700000000000-wal`), 'utf8')).toBe(
      'side file'
    )
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_corrupt_reset'])
    const db = openOk(file)
    expect(db.get('SELECT count(*) AS n FROM item', CountRow)).toEqual({ n: 0 })
    db.close()
  })

  it('backs up a file damaged past its header and starts empty', () => {
    const db = openOk(file)
    db.transaction(() => {
      for (let i = 0; i < 400; i++) insertItem(db, `item-${i}-${'x'.repeat(400)}`)
    })
    db.close()
    // Past the first two pages (4 KiB each): the header and `user_version` still read fine.
    const bytes = readFileSync(file)
    bytes.fill(0x41, 8192, Math.floor(bytes.length / 2))
    writeFileSync(file, bytes)
    lines = []
    const open = openMemoryDb(file, deps)
    expect(open).toMatchObject({ ok: true, problem: 'corrupt_reset' })
    expect(readFileSync(join(dir, `${MEMORY_DB_FILE}.corrupt-1700000000000`)).equals(bytes)).toBe(
      true
    )
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_corrupt_reset'])
    const fresh = openOk(file)
    expect(fresh.get('SELECT count(*) AS n FROM item', CountRow)).toEqual({ n: 0 })
    fresh.close()
  })

  it('backs up a damaged file without folding its leftover -wal in', () => {
    // A copy taken while the writer is open: the file plus a -wal holding a later write.
    const live = openOk(join(dir, 'live.db'))
    live.transaction(() => {
      for (let i = 0; i < 400; i++) insertItem(live, `item-${i}-${'x'.repeat(400)}`)
    })
    live.run('PRAGMA wal_checkpoint(TRUNCATE)')
    live.run('PRAGMA wal_autocheckpoint = 0')
    insertItem(live, 'late')
    copyFileSync(join(dir, 'live.db'), file)
    copyFileSync(join(dir, 'live.db-wal'), `${file}-wal`)
    live.close()
    const bytes = readFileSync(file)
    bytes.fill(0x41, 8192, Math.floor(bytes.length / 2))
    writeFileSync(file, bytes)
    const wal = readFileSync(`${file}-wal`)
    expect(openMemoryDb(file, deps)).toMatchObject({ ok: true, problem: 'corrupt_reset' })
    const backup = join(dir, `${MEMORY_DB_FILE}.corrupt-1700000000000`)
    expect(readFileSync(backup).equals(bytes)).toBe(true)
    expect(readFileSync(`${backup}-wal`).equals(wal)).toBe(true)
  })

  // A folder at one backup name makes that rename fail: before anything moved (-wal), after the
  // -wal moved (-shm), or after both side files moved (the main file).
  it.each(['-wal', '-shm', ''])(
    'leaves a corrupt file and its side files in place when the %j backup rename fails',
    (blocked) => {
      writeFileSync(file, 'not a database')
      writeFileSync(`${file}-wal`, 'wal bytes')
      writeFileSync(`${file}-shm`, 'shm bytes')
      const blocker = `${MEMORY_DB_FILE}.corrupt-1700000000000${blocked}`
      mkdirSync(join(dir, blocker))
      expect(openMemoryDb(file, deps)).toEqual({ ok: false, problem: 'read_failed' })
      expect(readFileSync(file, 'utf8')).toBe('not a database')
      expect(readFileSync(`${file}-wal`, 'utf8')).toBe('wal bytes')
      // Its name only: the read-only version check rewrites the -shm (SQLite's WAL index, rebuilt
      // from the -wal) before the backup runs; seen with SQLite 3.53.1.
      expect(existsSync(`${file}-shm`)).toBe(true)
      expect(readdirSync(dir).filter((n) => n.includes('.corrupt-'))).toEqual([blocker])
      expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_read_failed'])
    }
  )

  it('answers read_failed when the folder cannot be opened', () => {
    const open = openMemoryDb(join(dir, 'missing', MEMORY_DB_FILE), deps)
    expect(open).toEqual({ ok: false, problem: 'read_failed' })
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_read_failed'])
  })

  it('refuses a file from a newer schema version without touching it', () => {
    writeVersion(file, 99)
    const before = readFileSync(file)
    const open = openMemoryDb(file, deps)
    expect(open).toEqual({ ok: false, problem: 'read_failed' })
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(readdirSync(dir).some((n) => n.includes('.corrupt-'))).toBe(false)
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_newer_version'])
  })

  it('refuses a newer file left with a -wal by a crash without folding the -wal in', () => {
    // A copy taken while the writer is still open is what a crash leaves: the file plus its -wal.
    const live = openOk(join(dir, 'live.db'))
    live.run('PRAGMA wal_autocheckpoint = 0')
    live.run('PRAGMA user_version = 99')
    insertItem(live, 'a')
    copyFileSync(join(dir, 'live.db'), file)
    copyFileSync(join(dir, 'live.db-wal'), `${file}-wal`)
    live.close()
    const before = readFileSync(file)
    expect(openMemoryDb(file, deps)).toEqual({ ok: false, problem: 'read_failed' })
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(lines).toEqual(['[claude-watcher][memory] code=memory_db_newer_version'])
  })

  it('never logs a value', () => {
    writeFileSync(file, 'secret text that is not a database')
    openMemoryDb(file, deps)
    openMemoryDb(join(dir, 'missing', MEMORY_DB_FILE), deps)
    writeVersion(join(dir, 'newer.db'), 99)
    openMemoryDb(join(dir, 'newer.db'), deps)
    expect(lines).toHaveLength(3)
    for (const line of lines)
      expect(line).toMatch(/^\[claude-watcher\]\[memory\] code=memory_db_\w+$/)
  })
})

describe('memorySmokeCheck', () => {
  it('smoke check passes on a writable folder', () => {
    expect(memorySmokeCheck(dir)).toEqual({ pass: true })
  })

  it('fails on a folder that does not exist', () => {
    expect(memorySmokeCheck(join(dir, 'missing'))).toEqual({ pass: false })
  })
})
