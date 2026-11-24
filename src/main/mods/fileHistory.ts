// File history (spec 2026-10-18 §3): every instruction file a session's bridge mod names is
// snapshotted into `<userData>/claude-watcher-file-history/` when its content changed, so Context
// can show versions, a diff, and restore one. Its own store (technical-taste §6): `index.json`
// (FileHistoryIndexSchema) plus content blobs named by SHA-256, one blob per distinct content.
//
// - Retention: the newest FILE_HISTORY_MAX_VERSIONS per file; over FILE_HISTORY_MAX_TOTAL_BYTES the
//   oldest version of the largest history goes first, then (also past FILE_HISTORY_MAX_PATHS files)
//   the whole history of the file seen longest ago. The file just snapshotted always keeps its
//   newest version.
// - A file over FILE_HISTORY_MAX_FILE_BYTES is listed (`tooLarge`) but not snapshotted. Only an
//   absolute `.md` path is snapshotted (`isInstructionPath`); a report may name any file.
// - An index it could not read is moved aside (`index.unread-<now>.json`) before the first save
//   writes a new one; if it cannot be moved, the history stays in memory and the index is kept.
// - One operation at a time (a serial queue): two sessions reporting the same file together must
//   add one version, not two.
// - Never throws to its caller and never logs a path (it names the operator's folders): a failed
//   write reports `write_failed` and the history goes on in memory.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isInstructionPath } from '../../shared/schemas/contextIpc'
import {
  FILE_HISTORY_FILE_VERSION,
  FileHistoryIndexSchema,
  type FileVersion
} from '../../shared/schemas/fileHistory'
import type { StorageProblemCode } from '../../shared/schemas/storageHealth'

export const FILE_HISTORY_MAX_VERSIONS = 10
export const FILE_HISTORY_MAX_TOTAL_BYTES = 5 * 1024 * 1024
export const FILE_HISTORY_MAX_FILE_BYTES = 1024 * 1024
export const FILE_HISTORY_MAX_PATHS = 200

/** The folder under userData; its own store. */
export const FILE_HISTORY_DIR = 'claude-watcher-file-history'

const LOG = '[claude-watcher][mods]'

export type OperatorFileRead =
  | { ok: true; data: Buffer }
  | { ok: false; reason: 'missing' | 'not_file' | 'too_large' | 'unreadable' }

export interface FileHistoryFs {
  /** The operator's file: a regular file (a symlink counts only when the file it ends at is an
   *  absolute `.md`), at most `maxBytes`. A dangling symlink is `missing`; a folder, a device or
   *  a link out to any other file is `not_file`. Never throws. */
  readOperatorFile(path: string, maxBytes: number): Promise<OperatorFileRead>
  /** A file inside the store; null when it does not exist. */
  readStoreFile(path: string): Promise<Buffer | null>
  /** Writes a store file, creating its folders. */
  writeStoreFile(path: string, data: Buffer): Promise<void>
  removeStoreFile(path: string): Promise<void>
  renameStoreFile(from: string, to: string): Promise<void>
}

export type CommitCurrentResult = 'ok' | 'store_write_failed' | 'file_too_large' | 'unreadable'

export interface FileHistory {
  snapshot(paths: readonly string[]): Promise<void>
  /** Versions of one file, newest first. */
  list(path: string): FileVersion[]
  get(versionId: string): FileVersion | null
  content(versionId: string): Promise<string | null>
  /** The file was over the size cap when last read. */
  tooLarge(path: string): boolean
  /** Snapshot one file as it is now (restore keeps it first). A missing file is `ok`: there is
   *  nothing to keep. */
  commitCurrent(path: string): Promise<CommitCurrentResult>
}

export function createFileHistory(deps: {
  dir: string
  fs: FileHistoryFs
  now: () => number
  newId: () => string
  report: (code: StorageProblemCode) => void
  log: (line: string) => void
}): FileHistory {
  const indexPath = join(deps.dir, 'index.json')
  const blobPath = (hash: string): string => join(deps.dir, 'blobs', hash)
  let versions: FileVersion[] = []
  const large = new Set<string>()
  /** The index on disk could not be read: it is moved aside before anything overwrites it. */
  let unread = false

  let queue: Promise<unknown> = load()
  /** Run `fn` after every earlier operation. Each step catches its own failures; an unexpected
   *  throw still rejects to its caller, and the queue goes on. */
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn)
    queue = next.catch(() => deps.log(`${LOG} code=file_history_failed`))
    return next
  }

  async function load(): Promise<void> {
    let raw: Buffer | null
    try {
      raw = await deps.fs.readStoreFile(indexPath)
    } catch {
      deps.log(`${LOG} code=file_history_read_failed`)
      deps.report('read_failed')
      unread = true
      return
    }
    if (raw === null) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString('utf8'))
    } catch {
      parsed = undefined
    }
    const index = FileHistoryIndexSchema.safeParse(parsed)
    if (index.success) {
      versions = index.data.versions
      return
    }
    try {
      await deps.fs.renameStoreFile(indexPath, join(deps.dir, `index.corrupt-${deps.now()}.json`))
    } catch {
      deps.log(`${LOG} code=file_history_backup_failed`)
      deps.report('backup_failed')
    }
    deps.log(`${LOG} code=file_history_corrupt_reset`)
    deps.report('corrupt_reset')
  }

  /** Newest first, by `seenAt`, then by insertion (a later push is newer). */
  const of = (path: string): FileVersion[] =>
    versions
      .map((v, i) => ({ v, i }))
      .filter(({ v }) => v.path === path)
      .sort((x, y) => y.v.seenAt - x.v.seenAt || y.i - x.i)
      .map(({ v }) => v)

  /** Adds a version when the content is new. `false` when the store refused the write. */
  async function keep(path: string, data: Buffer): Promise<boolean> {
    const hash = createHash('sha256').update(data).digest('hex')
    if (of(path)[0]?.hash === hash) return true
    try {
      if (!versions.some((v) => v.hash === hash)) await deps.fs.writeStoreFile(blobPath(hash), data)
    } catch {
      deps.log(`${LOG} code=file_history_write_failed`)
      deps.report('write_failed')
      return false
    }
    versions.push({ id: deps.newId(), path, hash, size: data.length, seenAt: deps.now() })
    await prune(path)
    return persist()
  }

  /** Retention, after a version of `current` was added. Per file the newest
   *  FILE_HISTORY_MAX_VERSIONS stay. Over FILE_HISTORY_MAX_TOTAL_BYTES the oldest version of the
   *  largest history goes first; when only newest versions are left, or past
   *  FILE_HISTORY_MAX_PATHS files, the whole history of the file seen longest ago goes, never
   *  `current`'s. Each file's list is built once, so a prune costs about its version count. */
  async function prune(current: string): Promise<void> {
    const before = new Set(versions.map((v) => v.hash))
    const byPath = new Map<string, FileVersion[]>()
    for (const v of versions) byPath.set(v.path, [...(byPath.get(v.path) ?? []), v])
    // Newest first: reversed insertion, then a stable sort by `seenAt` (as `of` orders them).
    for (const [path, list] of byPath) {
      const newest = list.reverse().sort((x, y) => y.seenAt - x.seenAt)
      byPath.set(path, newest.slice(0, FILE_HISTORY_MAX_VERSIONS))
    }
    const refs = new Map<string, number>()
    let total = 0
    const count = (v: FileVersion, by: 1 | -1): void => {
      const n = (refs.get(v.hash) ?? 0) + by
      if (n === 0) refs.delete(v.hash)
      else refs.set(v.hash, n)
      if ((by === 1 && n === 1) || (by === -1 && n === 0)) total += by * v.size
    }
    for (const list of byPath.values()) for (const v of list) count(v, 1)
    while (total > FILE_HISTORY_MAX_TOTAL_BYTES) {
      const victim = largestHistoryWithOld(byPath)
      const oldest = victim?.pop()
      if (oldest === undefined) break
      count(oldest, -1)
    }
    while (total > FILE_HISTORY_MAX_TOTAL_BYTES || byPath.size > FILE_HISTORY_MAX_PATHS) {
      const stale = stalestPath(byPath, current)
      if (stale === null) break
      for (const v of byPath.get(stale) ?? []) count(v, -1)
      byPath.delete(stale)
    }
    const keptVersions = new Set([...byPath.values()].flat())
    versions = versions.filter((v) => keptVersions.has(v))
    for (const hash of before) {
      if (refs.has(hash)) continue
      try {
        await deps.fs.removeStoreFile(blobPath(hash))
      } catch {
        deps.log(`${LOG} code=file_history_prune_failed`)
      }
    }
  }

  /** The history (newest first) that weighs the most, among those with more than their newest. */
  function largestHistoryWithOld(byPath: Map<string, FileVersion[]>): FileVersion[] | null {
    let best: FileVersion[] | null = null
    let bestBytes = -1
    for (const list of byPath.values()) {
      if (list.length < 2) continue
      const bytes = list.reduce((sum, v) => sum + v.size, 0)
      if (bytes > bestBytes) {
        best = list
        bestBytes = bytes
      }
    }
    return best
  }

  /** The file whose newest version was seen longest ago, other than `current`. */
  function stalestPath(byPath: Map<string, FileVersion[]>, current: string): string | null {
    let best: string | null = null
    let bestAt = Infinity
    for (const [path, list] of byPath) {
      const at = list[0]?.seenAt ?? -Infinity
      if (path !== current && at < bestAt) {
        best = path
        bestAt = at
      }
    }
    return best
  }

  async function persist(): Promise<boolean> {
    if (unread) {
      try {
        await deps.fs.renameStoreFile(indexPath, join(deps.dir, `index.unread-${deps.now()}.json`))
        unread = false
      } catch {
        // The old index may still hold the history: keep it, and keep this run in memory.
        deps.log(`${LOG} code=file_history_backup_failed`)
        deps.report('backup_failed')
        return true
      }
    }
    try {
      const index = { version: FILE_HISTORY_FILE_VERSION, versions }
      await deps.fs.writeStoreFile(indexPath, Buffer.from(JSON.stringify(index)))
      return true
    } catch {
      deps.log(`${LOG} code=file_history_write_failed`)
      deps.report('write_failed')
      return false
    }
  }

  /** Read one operator file and keep it. A store failure was already reported by `keep`. */
  async function take(path: string): Promise<'kept' | 'store_failed' | 'too_large' | 'unread'> {
    const read = await deps.fs.readOperatorFile(path, FILE_HISTORY_MAX_FILE_BYTES)
    if (read.ok) {
      large.delete(path)
      return (await keep(path, read.data)) ? 'kept' : 'store_failed'
    }
    if (read.reason === 'too_large') {
      large.add(path)
      return 'too_large'
    }
    return 'unread'
  }

  return {
    snapshot(paths) {
      return serial(async () => {
        for (const path of paths.filter(isInstructionPath)) {
          const r = await take(path)
          if (r === 'too_large') deps.log(`${LOG} code=file_history_too_large`)
          else if (r === 'unread') deps.log(`${LOG} code=file_history_read_failed`)
        }
      })
    },
    list: of,
    get: (versionId) => versions.find((v) => v.id === versionId) ?? null,
    async content(versionId) {
      const v = versions.find((x) => x.id === versionId)
      if (v === undefined) return null
      try {
        return (await deps.fs.readStoreFile(blobPath(v.hash)))?.toString('utf8') ?? null
      } catch {
        deps.log(`${LOG} code=file_history_read_failed`)
        return null
      }
    },
    tooLarge: (path) => large.has(path),
    commitCurrent(path) {
      return serial(async (): Promise<CommitCurrentResult> => {
        const read = await deps.fs.readOperatorFile(path, FILE_HISTORY_MAX_FILE_BYTES)
        if (read.ok) return (await keep(path, read.data)) ? 'ok' : 'store_write_failed'
        if (read.reason === 'missing') return 'ok'
        if (read.reason === 'too_large') return 'file_too_large'
        return 'unreadable'
      })
    }
  }
}

const isMissing = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')

/** The real filesystem behind `FileHistoryFs`. */
export const nodeFileHistoryFs: FileHistoryFs = {
  async readOperatorFile(path, maxBytes) {
    try {
      // A link counts only when the file it ends at is itself an absolute `.md` (a CLAUDE.md
      // linked to AGENTS.md); a link out to any other file is `not_file`. The resolved file is
      // opened no-follow and non-blocking (a FIFO never hangs) and checked on its descriptor.
      // A dangling link is ENOENT, so `missing`.
      const real = await realpath(path)
      if (!isInstructionPath(real)) return { ok: false, reason: 'not_file' }
      const handle = await open(
        real,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        const s = await handle.stat()
        if (!s.isFile()) return { ok: false, reason: 'not_file' }
        if (s.size > maxBytes) return { ok: false, reason: 'too_large' }
        // One byte over the cap tells a file that grew past it after the stat.
        const buffer = Buffer.alloc(maxBytes + 1)
        let length = 0
        for (;;) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
          if (bytesRead === 0) break
          length += bytesRead
          if (length === buffer.length) break
        }
        if (length > maxBytes) return { ok: false, reason: 'too_large' }
        return { ok: true, data: buffer.subarray(0, length) }
      } finally {
        await handle.close()
      }
    } catch (err) {
      return { ok: false, reason: isMissing(err) ? 'missing' : 'unreadable' }
    }
  },
  async readStoreFile(path) {
    try {
      return await readFile(path)
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  },
  async writeStoreFile(path, data) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  },
  async removeStoreFile(path) {
    await rm(path, { force: true })
  },
  async renameStoreFile(from, to) {
    await rename(from, to)
  }
}
