// Context's IPC handler bodies (spec 2026-10-18 §4), out of the registrar so they test in node
// (the pastSessionOpen.ts precedent). Each argument is UNTRUSTED: parsed here, and it never
// becomes a path. A file is a session id + an index into that session's report; a version is
// a history id whose path a live report must still name. Open takes any absolute path but
// refuses one that can run as a program (an execute bit or a launcher type: the system would
// run it, not show it); History and Restore take only an absolute `.md` path
// (`isInstructionPath`). A refusal is a code the renderer maps
// to copy (`registerContextIpc` throws it). Never logs a path.
//
// Restore is the one write to an operator's file (spec Decisions; technical-taste §12): it keeps
// the file as it is now first, never creates a folder, and writes only a path that is both in
// the history and in a live report.
import { basename, dirname, extname } from 'node:path'
import { stat, writeFile } from 'node:fs/promises'
import {
  FileRefSchema,
  isAbsolutePath,
  isInstructionPath,
  SessionSetupGetSchema,
  VersionRefSchema,
  type ContextRefusalCode,
  type DiffLine,
  type SessionSetupState
} from '../../shared/schemas/contextIpc'
import type { FileVersion } from '../../shared/schemas/fileHistory'
import {
  FILE_HISTORY_MAX_FILE_BYTES,
  nodeFileHistoryFs,
  type FileHistory,
  type OperatorFileRead
} from './fileHistory'
import { lineDiff } from './myersDiff'
import type { SessionSetup } from './sessionSetup'

export type ContextResult<T> = { ok: true; value: T } | { ok: false; code: ContextRefusalCode }

export interface ContextFs {
  /** The operator's file now (the history's own reader). */
  readCurrent(path: string, maxBytes: number): Promise<OperatorFileRead>
  isDirectory(path: string): Promise<boolean>
  /** Something is at the path (a symlink counts by its target). */
  exists(path: string): Promise<boolean>
  /** The system would run it rather than show it: an execute bit, or a launcher type. */
  isRunnable(path: string): Promise<boolean>
  /** Writes the file; never creates a folder. */
  writeFile(path: string, data: Buffer): Promise<void>
}

export interface ContextHandlers {
  get(raw: unknown): SessionSetupState
  list(raw: unknown): ContextResult<{ versions: FileVersion[]; tooLarge: boolean }>
  diff(raw: unknown): Promise<ContextResult<{ lines: DiffLine[] }>>
  open(raw: unknown): Promise<ContextResult<null>>
  restore(raw: unknown): Promise<ContextResult<{ fileName: string }>>
}

const refuse = (code: ContextRefusalCode): { ok: false; code: ContextRefusalCode } => ({
  ok: false,
  code
})

export function createContextHandlers(deps: {
  setup: Pick<SessionSetup, 'get' | 'reportsPath'>
  history: Pick<FileHistory, 'list' | 'get' | 'content' | 'tooLarge' | 'commitCurrent'>
  fs: ContextFs
  /** `shell.openPath`: '' on success, an error string otherwise. */
  openPath: (path: string) => Promise<string>
}): ContextHandlers {
  /** The path at `fileIndex` of the session's ready report, or null (also for a path `accepts`
   *  refuses). */
  function fileAt(raw: unknown, accepts: (path: string) => boolean): string | null {
    const { sessionId, fileIndex } = FileRefSchema.parse(raw)
    const s = deps.setup.get(sessionId)
    if (s.state !== 'ready') return null
    const path = s.report.instructionFiles[fileIndex]?.path
    return path !== undefined && accepts(path) ? path : null
  }

  /** A version of an instruction file whose path a live report still names, or null. */
  function liveVersion(raw: unknown): FileVersion | null {
    const v = deps.history.get(VersionRefSchema.parse(raw).versionId)
    return v !== null && isInstructionPath(v.path) && deps.setup.reportsPath(v.path) ? v : null
  }

  return {
    get: (raw) => deps.setup.get(SessionSetupGetSchema.parse(raw).sessionId),

    list(raw) {
      const path = fileAt(raw, isInstructionPath)
      if (path === null) return refuse('file_missing')
      return {
        ok: true,
        value: { versions: deps.history.list(path), tooLarge: deps.history.tooLarge(path) }
      }
    },

    async diff(raw) {
      const v = liveVersion(raw)
      if (v === null) return refuse('version_not_found')
      const now = await deps.fs.readCurrent(v.path, FILE_HISTORY_MAX_FILE_BYTES)
      if (!now.ok) return refuse(now.reason === 'too_large' ? 'file_too_large' : 'file_missing')
      const before = await deps.history.content(v.id)
      if (before === null) return refuse('version_not_found')
      // Too many changed lines: the diff gives up rather than load main (myersDiff.ts).
      const lines = lineDiff(before, now.data.toString('utf8'))
      return lines === null ? refuse('file_too_large') : { ok: true, value: { lines } }
    },

    async open(raw) {
      const path = fileAt(raw, isAbsolutePath)
      if (path === null) return refuse('file_missing')
      if (!(await deps.fs.exists(path))) return refuse('file_missing')
      if (await deps.fs.isRunnable(path)) return refuse('file_runnable')
      return (await deps.openPath(path)) === ''
        ? { ok: true, value: null }
        : refuse('file_open_failed')
    },

    async restore(raw) {
      const v = liveVersion(raw)
      if (v === null) return refuse('version_not_found')
      // No folder is created: a restore into a folder that is gone refuses before it keeps or
      // writes anything.
      if (!(await deps.fs.isDirectory(dirname(v.path)))) return refuse('file_restore_failed')
      const content = await deps.history.content(v.id)
      if (content === null) return refuse('version_not_found')
      const kept = await deps.history.commitCurrent(v.path)
      if (kept === 'store_write_failed') return refuse('store_write_failed')
      if (kept === 'file_too_large') return refuse('file_too_large')
      if (kept === 'unreadable') return refuse('file_restore_failed')
      try {
        await deps.fs.writeFile(v.path, Buffer.from(content, 'utf8'))
      } catch {
        console.warn('[claude-watcher][mods] code=file_restore_failed')
        return refuse('file_restore_failed')
      }
      return { ok: true, value: { fileName: basename(v.path) } }
    }
  }
}

/** Types the system runs when opened, on any platform (Linux launchers, macOS, Windows). */
const LAUNCHER_TYPES = new Set([
  '.desktop',
  '.appimage',
  '.app',
  '.command',
  '.jar',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.lnk',
  '.ps1',
  '.vbs'
])

/** The real filesystem behind `ContextFs`. */
export const nodeContextFs: ContextFs = {
  readCurrent: (path, maxBytes) => nodeFileHistoryFs.readOperatorFile(path, maxBytes),
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false // missing or unreadable: a yes/no whose throw is its answer
    }
  },
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false // missing or dangling: a yes/no whose throw is its answer
    }
  },
  async isRunnable(path) {
    if (LAUNCHER_TYPES.has(extname(path).toLowerCase())) return true
    if (process.platform === 'win32') return false
    try {
      // `stat` follows a symlink: the target's mode is what the system would run.
      return ((await stat(path)).mode & 0o111) !== 0
    } catch {
      return true // unreadable: not known to be safe to hand to the system
    }
  },
  async writeFile(path, data) {
    await writeFile(path, data)
  }
}
