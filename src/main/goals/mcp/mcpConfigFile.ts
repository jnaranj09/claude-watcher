// The `--mcp-config` file of a session started from goal tasks (spec 2026-10-19 goals, Claude
// integration). It names the MCP endpoint on the hook listener and carries the session's bearer
// token in a `headers` entry, so the token never goes on argv: only this file's path does.
//
// Files live in `<userData>/mcp/` (folder 0700, files 0600, a random name each). A file goes when
// its session goes (`window/cardState.ts`), and a start clears what the last run left, since every
// token in it died with that run. Logs carry a `code=` only: never the path, never the token.
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The server key in the config, so claude names the tool `mcp__claude-watcher__<tool>`. */
export const MCP_SERVER_NAME = 'claude-watcher'
const MCP_CONFIG_DIRNAME = 'mcp'

/**
 * Write one config file under `<dir>/mcp/` and return its path. Throws when the disk refuses.
 * Shape (claude 2.1.304, probed): `{ mcpServers: { <name>: { type: 'http', url, headers } } }`.
 */
export function writeMcpConfig(dir: string, token: string, url: string): string {
  const folder = join(dir, MCP_CONFIG_DIRNAME)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  // `mkdirSync`'s mode does nothing to a folder that already exists.
  chmodSync(folder, 0o700)
  const path = join(folder, `${randomBytes(16).toString('hex')}.json`)
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } }
    }
  }
  writeFileSync(path, JSON.stringify(config), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return path
}

/** Delete a config file; a file already gone is fine. */
export function removeMcpConfig(path: string, log: (line: string) => void): void {
  try {
    rmSync(path, { force: true })
  } catch {
    log('[claude-watcher][goals] code=mcp_config_remove_failed')
  }
}

export interface McpConfigs {
  /** Write the session's config (removing any earlier one of it); null when the disk refused. */
  write(sessionId: string, token: string, url: string): string | null
  /** `/clear` gave the session a new id; claude keeps the file it loaded. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: delete its file. */
  remove(sessionId: string): void
  /** At start: delete every file a previous run left. */
  clearStale(): void
}

export function createMcpConfigs(options: {
  /** `app.getPath('userData')`, read when a file is written. */
  dir: () => string
  log: (line: string) => void
}): McpConfigs {
  const paths = new Map<string, string>()

  function remove(sessionId: string): void {
    const path = paths.get(sessionId)
    if (path === undefined) return
    paths.delete(sessionId)
    removeMcpConfig(path, options.log)
  }

  return {
    write(sessionId, token, url) {
      remove(sessionId)
      try {
        const path = writeMcpConfig(options.dir(), token, url)
        paths.set(sessionId, path)
        return path
      } catch {
        options.log('[claude-watcher][goals] code=mcp_config_write_failed')
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
      const folder = join(options.dir(), MCP_CONFIG_DIRNAME)
      let names: string[]
      try {
        names = readdirSync(folder)
      } catch (err) {
        // No folder yet: nothing was left. Any other refusal leaves dead files behind.
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
          options.log('[claude-watcher][goals] code=mcp_config_clear_failed')
        }
        return
      }
      for (const name of names) {
        if (name.endsWith('.json')) removeMcpConfig(join(folder, name), options.log)
      }
    }
  }
}
