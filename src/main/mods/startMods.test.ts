// The start's two mod installs (memory phase 3, Task 10): the bridge mod and the memory mod each
// install into their own folder, and a failed memory mod never costs the bridge mod.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import type { ModFs } from './modInstall'
import { installAppMods } from './startMods'

function fakeFs(files: Record<string, string>): ModFs {
  const map = new Map(Object.entries(files))
  return {
    listFiles: (dir) =>
      Promise.resolve(
        [...map.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1))
      ),
    readFile: (path) => {
      const v = map.get(path)
      return Promise.resolve(v === undefined ? null : Buffer.from(v))
    },
    writeFile: (path, data) => {
      map.set(path, data.toString())
      return Promise.resolve()
    },
    removeDir: () => Promise.resolve()
  }
}

const BRIDGE_SRC = { '/src/watcher-bridge/.claude-plugin/plugin.json': '{"name":"watcher-bridge"}' }
const MEMORY_SRC = { '/src/watcher-memory/.claude-plugin/plugin.json': '{"name":"watcher-memory"}' }

describe('installAppMods', () => {
  it('the start installs both mods', async () => {
    const reports: string[] = []
    const lines: string[] = []
    expect(
      await installAppMods({
        userDataDir: '/data',
        fs: fakeFs({ ...BRIDGE_SRC, ...MEMORY_SRC }),
        report: (c) => reports.push(c),
        log: (l) => lines.push(l),
        sourceDirOf: (n) => `/src/${n}`
      })
    ).toEqual({
      bridge: join('/data', 'mods', 'watcher-bridge'),
      memory: join('/data', 'mods', 'watcher-memory')
    })
    expect([reports, lines]).toEqual([[], []])
  })

  it('a memory mod that cannot be installed leaves the bridge mod installed, reports once and logs a code', async () => {
    const reports: string[] = []
    const lines: string[] = []
    expect(
      await installAppMods({
        userDataDir: '/data',
        fs: fakeFs(BRIDGE_SRC),
        report: (c) => reports.push(c),
        log: (l) => lines.push(l),
        sourceDirOf: (n) => `/src/${n}`
      })
    ).toEqual({ bridge: join('/data', 'mods', 'watcher-bridge'), memory: null })
    expect([reports, lines]).toEqual([
      ['write_failed'],
      ['[claude-watcher][mods] code=mod_install_failed']
    ])
  })

  it('a bridge mod that cannot be installed still installs the memory mod', async () => {
    const reports: string[] = []
    expect(
      await installAppMods({
        userDataDir: '/data',
        fs: fakeFs(MEMORY_SRC),
        report: (c) => reports.push(c),
        log: () => undefined,
        sourceDirOf: (n) => `/src/${n}`
      })
    ).toEqual({ bridge: null, memory: join('/data', 'mods', 'watcher-memory') })
    expect(reports).toEqual(['write_failed'])
  })
})
