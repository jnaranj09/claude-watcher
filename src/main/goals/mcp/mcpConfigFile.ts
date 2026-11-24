// The `--mcp-config` file of a session given one of the app's MCP servers (spec 2026-10-19 goals,
// Claude integration: the goals server, then memory's, spec 2026-11-11). It names that server
// (its `serverName`) and its endpoint on the hook listener, and carries the session's bearer token
// in a `headers` entry, so the token never goes on argv: only this file's path does. Each server
// keeps its own `createMcpConfigs`, so a session can hold one file per server (goals, memory), and
// each logs under its own area (`[claude-watcher][goals]`, `[claude-watcher][memory]`).
//
// Files live in `<userData>/mcp/` (folder 0700, files 0600, a random name each: `sessionFiles.ts`,
// shared with the hook settings files), every server's in the one folder. A file goes when its session goes (`window/cardState.ts`), and a start clears
// what the last run left, since every token in it died with that run: ONE sweep (the goals
// instance's `clearStale`, index.ts) clears every server's files, so no other instance runs one.
// Logs carry a `code=` only: never the path, never the token. A refused write is also told to the
// operator through the `report` it is given (the goals server: the `goals` store's `write_failed`,
// the notice a refused background goals write shows; the memory server: the `memory` store's).
import { createSessionFiles, removeSessionFile, writeSessionFile } from '../../sessionFiles'
import type { StorageProblemCode } from '../../../shared/schemas/storageHealth'

/** The goals server's key in its config, so claude names its tools
 *  `mcp__claude-watcher__<tool>`; also its `serverInfo.name`. */
export const MCP_SERVER_NAME = 'claude-watcher'
const MCP_CONFIG_DIRNAME = 'mcp'

/** Shape (claude 2.1.304, probed): `{ mcpServers: { <name>: { type: 'http', url, headers } } }`. */
function mcpConfigText(serverName: string, token: string, url: string): string {
  return JSON.stringify({
    mcpServers: {
      [serverName]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } }
    }
  })
}

/** Write one config file for `serverName` under `<dir>/mcp/` and return its path. Throws when the
 *  disk refuses. */
export function writeMcpConfig(
  dir: string,
  serverName: string,
  token: string,
  url: string
): string {
  return writeSessionFile(dir, MCP_CONFIG_DIRNAME, mcpConfigText(serverName, token, url))
}

/** Delete a config file; a file already gone is fine. `area` is the log area of its server. */
export function removeMcpConfig(path: string, area: string, log: (line: string) => void): void {
  removeSessionFile(path, { prefix: `[claude-watcher][${area}]`, code: 'mcp_config', log })
}

export interface McpConfigs {
  /** Write the session's config (removing any earlier one of it); null when the disk refused. */
  write(sessionId: string, token: string, url: string): string | null
  /** `/clear` gave the session a new id; claude keeps the file it loaded. */
  rebind(oldSessionId: string, newSessionId: string): void
  /** The session is gone: delete its file. */
  remove(sessionId: string): void
  /** At start: delete every file a previous run left in the folder, whichever server's it was. */
  clearStale(): void
}

export function createMcpConfigs(options: {
  /** `app.getPath('userData')`, read when a file is written. */
  dir: () => string
  /** The server key each file names (`MCP_SERVER_NAME` for the goals server,
   *  `MEMORY_MCP_SERVER_NAME` for memory's). */
  serverName: string
  /** The log area: `[claude-watcher][<area>]` (`goals`, `memory`). */
  area: string
  log: (line: string) => void
  /** Storage health's reporter for the server's store (goals: `storageHealth.reporterFor('goals')`). */
  report: (code: StorageProblemCode) => void
}): McpConfigs {
  const files = createSessionFiles({
    dir: options.dir,
    dirname: MCP_CONFIG_DIRNAME,
    prefix: `[claude-watcher][${options.area}]`,
    code: 'mcp_config',
    log: options.log,
    onWriteFailed: () => options.report('write_failed')
  })
  return {
    write: (sessionId, token, url) =>
      files.write(sessionId, mcpConfigText(options.serverName, token, url)),
    rebind: files.rebind,
    remove: files.remove,
    clearStale: files.clearStale
  }
}

/** What a spawn needs to hand a session one of the app's MCP servers. */
export interface McpGrantSpawn<G extends { sessionId: string }> {
  /** SEC-6: only while THIS process holds the hook port, which serves the endpoint. */
  hookListening(): boolean
  tokens: { mint(grant: G): string; revoke(sessionId: string): void }
  configs: Pick<McpConfigs, 'write'>
  /** The server's endpoint URL on the hook listener. */
  url: string
  /** Code-only log sink. */
  log(line: string): void
}

/**
 * Mint `grant`'s fresh token and write its session's config file. The file's path, or null when
 * the session must go without the server: the hook port is not ours (SEC-6, logged under `area`)
 * or the disk refused the file (`write` logged it), in which case no token is left behind.
 */
export function grantMcpConfig<G extends { sessionId: string }>(
  spawn: McpGrantSpawn<G>,
  area: string,
  grant: NoInfer<G>
): string | null {
  if (!spawn.hookListening()) {
    spawn.log(`[claude-watcher][${area}] code=mcp_hook_port_not_ours`)
    return null
  }
  const token = spawn.tokens.mint(grant)
  const path = spawn.configs.write(grant.sessionId, token, spawn.url)
  if (path === null) spawn.tokens.revoke(grant.sessionId)
  return path
}
