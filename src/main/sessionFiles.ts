// One private file per launched session, in a folder of the app's data dir: the `--mcp-config`
// files (`goals/mcp/mcpConfigFile.ts`, folder `mcp/`) and the hook settings files
// (`hooks/hookSettingsFile.ts`, folder `hooks/`). Each holds a per-launch secret (a bearer token,
// or the hook channel token in its URLs), so only its path ever reaches claude's argv.
//
// Folder 0700 (chmod even when it already exists), file 0600, a random name each, created new
// (`wx`: never a file or link that is there). A file follows its session on `/clear` (claude keeps
// the file it loaded) and goes with it; a start clears what the last run left, since every secret
// in it died with that run. Logs carry a `code=` only: never the path, never the content.
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Write `content` to a new private file under `<dir>/<dirname>/` and return its path. Throws
 *  when the disk refuses. */
export function writeSessionFile(dir: string, dirname: string, content: string): string {
  const folder = join(dir, dirname)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  // `mkdirSync`'s mode does nothing to a folder that already exists.
  chmodSync(folder, 0o700)
  const path = join(folder, `${randomBytes(16).toString('hex')}.json`)
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return path
}

/** How a file set names its log lines: `<prefix> code=<code>_write_failed` and so on. */
interface SessionFilesLog {
  /** The line's start, e.g. `[claude-watcher][goals]`. */
  prefix: string
  /** The code's stem, e.g. `mcp_config` → `mcp_config_write_failed`. */
  code: string
  log: (line: string) => void
}

/** Delete one file; a file already gone is fine. */
export function removeSessionFile(path: string, how: SessionFilesLog): void {
  try {
    rmSync(path, { force: true })
  } catch {
    how.log(`${how.prefix} code=${how.code}_remove_failed`)
  }
}

export interface SessionFiles {
  /** Write the session's file (removing any earlier one of it); null when the disk refused. */
  write(sessionId: string, content: string): string | null
  /** `/clear` gave the session a new id; claude keeps the file it loaded. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: delete its file. */
  remove(sessionId: string): void
  /** At start: delete every `.json` file a previous run left in the folder. */
  clearStale(): void
}

export function createSessionFiles(
  options: SessionFilesLog & {
    /** `app.getPath('userData')`, read when a file is written. */
    dir: () => string
    /** The folder under `dir`. */
    dirname: string
    /** Told when a write was refused (after the log line), so the operator can be shown it. */
    onWriteFailed?: () => void
  }
): SessionFiles {
  const paths = new Map<string, string>()

  function remove(sessionId: string): void {
    const path = paths.get(sessionId)
    if (path === undefined) return
    paths.delete(sessionId)
    removeSessionFile(path, options)
  }

  return {
    write(sessionId, content) {
      remove(sessionId)
      try {
        const path = writeSessionFile(options.dir(), options.dirname, content)
        paths.set(sessionId, path)
        return path
      } catch {
        options.log(`${options.prefix} code=${options.code}_write_failed`)
        options.onWriteFailed?.()
        return null
      }
    },
    rebind(oldSessionId, newSessionId) {
      const path = paths.get(oldSessionId)
      if (path === undefined || oldSessionId === newSessionId) return
      paths.delete(oldSessionId)
      paths.set(newSessionId, path)
    },
    remove,
    clearStale() {
      const folder = join(options.dir(), options.dirname)
      let names: string[]
      try {
        names = readdirSync(folder)
      } catch (err) {
        // No folder yet: nothing was left. Any other refusal leaves dead files behind.
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
          options.log(`${options.prefix} code=${options.code}_clear_failed`)
        }
        return
      }
      for (const name of names) {
        if (name.endsWith('.json')) removeSessionFile(join(folder, name), options)
      }
    }
  }
}
