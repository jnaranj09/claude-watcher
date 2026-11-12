// The `--mcp-config` file a session started from tasks gets: the endpoint URL and its bearer token,
// in a 0600 file under userData, so the token never goes on argv.
import { describe, it, expect, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MCP_SERVER_NAME, createMcpConfigs, removeMcpConfig, writeMcpConfig } from './mcpConfigFile'

let dir: string | null = null
function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'cw-mcp-'))
  return dir
}
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

const URL = 'http://127.0.0.1:29279/mcp/goals'

describe('mcp config file', () => {
  it('writes 0600 JSON that parses to the expected shape', () => {
    const userData = tempDir()
    const path = writeMcpConfig(userData, MCP_SERVER_NAME, 'tok123', URL)
    expect(path.startsWith(join(userData, 'mcp'))).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(userData, 'mcp')).mode & 0o777).toBe(0o700)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      mcpServers: {
        'claude-watcher': {
          type: 'http',
          url: URL,
          headers: { Authorization: 'Bearer tok123' }
        }
      }
    })
  })

  it('tightens a folder that already exists with looser permissions to 0700', () => {
    const userData = tempDir()
    mkdirSync(join(userData, 'mcp'), { mode: 0o755 })
    chmodSync(join(userData, 'mcp'), 0o755)
    writeMcpConfig(userData, MCP_SERVER_NAME, 'tok123', URL)
    expect(statSync(join(userData, 'mcp')).mode & 0o777).toBe(0o700)
  })

  it('each write gets its own file, and remove deletes it', () => {
    const userData = tempDir()
    const a = writeMcpConfig(userData, MCP_SERVER_NAME, 'a', URL)
    const b = writeMcpConfig(userData, MCP_SERVER_NAME, 'b', URL)
    expect(a).not.toBe(b)
    removeMcpConfig(a, 'goals', () => {})
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(true)
  })
})

describe('mcp configs per session', () => {
  it('a second write for a session removes its first file; remove deletes the file', () => {
    const userData = tempDir()
    const configs = createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => {},
      report: () => {}
    })
    const first = configs.write('sess-a', 't1', URL)
    const second = configs.write('sess-a', 't2', URL)
    expect(first).not.toBeNull()
    expect(existsSync(first ?? '')).toBe(false)
    configs.remove('sess-a')
    expect(existsSync(second ?? '')).toBe(false)
  })

  it('rebind keeps the file and moves who owns it', () => {
    const userData = tempDir()
    const configs = createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => {},
      report: () => {}
    })
    const path = configs.write('sess-old', 't', URL) ?? ''
    configs.rebind('sess-old', 'sess-new')
    configs.remove('sess-old')
    expect(existsSync(path)).toBe(true)
    configs.remove('sess-new')
    expect(existsSync(path)).toBe(false)
  })

  it('a write the disk refuses is null, logs a code only and reports goals write_failed', () => {
    const userData = tempDir()
    writeFileSync(join(userData, 'mcp'), 'not a folder')
    const lines: string[] = []
    const reported: string[] = []
    const configs = createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: (l) => lines.push(l),
      report: (code) => reported.push(code)
    })
    expect(configs.write('sess-a', 'secret-token', URL)).toBeNull()
    expect(lines).toEqual(['[claude-watcher][goals] code=mcp_config_write_failed'])
    expect(reported).toEqual(['write_failed'])
  })

  it("another server's instance logs a refused write under its own area", () => {
    const userData = tempDir()
    writeFileSync(join(userData, 'mcp'), 'not a folder')
    const lines: string[] = []
    const configs = createMcpConfigs({
      dir: () => userData,
      serverName: 'claude-watcher-memory',
      area: 'memory',
      log: (l) => lines.push(l),
      report: () => {}
    })
    expect(configs.write('sess-a', 'secret-token', URL)).toBeNull()
    expect(lines).toEqual(['[claude-watcher][memory] code=mcp_config_write_failed'])
  })

  it('clearStale removes the files a previous run left (their tokens died with it)', () => {
    const userData = tempDir()
    const leftover = writeMcpConfig(userData, MCP_SERVER_NAME, 'old', URL)
    const configs = createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: () => {},
      report: () => {}
    })
    configs.clearStale()
    expect(existsSync(leftover)).toBe(false)
  })

  it('clearStale with no folder yet does nothing and logs nothing', () => {
    const userData = tempDir()
    const lines: string[] = []
    createMcpConfigs({
      dir: () => userData,
      serverName: MCP_SERVER_NAME,
      area: 'goals',
      log: (l) => lines.push(l),
      report: () => {}
    }).clearStale()
    expect(lines).toEqual([])
  })
})
