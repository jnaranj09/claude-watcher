// A shipped mod's install at start (spec 2026-10-18 §1.2): copy the shipped mod into
// <userData>/mods/<name>, and replace that folder whole only when it differs.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BRIDGE_MOD_NAME,
  MEMORY_MOD_NAME,
  installMod,
  modSmokeCheck,
  modSourceDir,
  type ModFs
} from './modInstall'

const SRC = '/app/mods/watcher-bridge'
const USER = '/data'
const TARGET = '/data/mods/watcher-bridge'

function fakeFs(files: Record<string, string>): ModFs & {
  files: Map<string, string>
  touched: string[]
} {
  const map = new Map(Object.entries(files))
  const touched: string[] = []
  return {
    files: map,
    touched,
    listFiles: (dir) =>
      Promise.resolve(
        [...map.keys()]
          .filter((p) => p.startsWith(`${dir}/`))
          .map((p) => p.slice(dir.length + 1))
          .sort()
      ),
    readFile: (path) => {
      const v = map.get(path)
      return Promise.resolve(v === undefined ? null : Buffer.from(v))
    },
    writeFile: (path, data) => {
      touched.push(path)
      map.set(path, data.toString())
      return Promise.resolve()
    },
    removeDir: (path) => {
      touched.push(path)
      for (const k of [...map.keys()]) if (k.startsWith(`${path}/`)) map.delete(k)
      return Promise.resolve()
    }
  }
}

const SHIPPED = {
  [`${SRC}/.claude-plugin/plugin.json`]: '{"name":"watcher-bridge"}',
  [`${SRC}/hooks/hooks.json`]: '{"modules":["./register.ts"]}',
  [`${SRC}/hooks/register.ts`]: 'v1',
  [`${SRC}/hooks/report.ts`]: 'r1',
  [`${SRC}/hooks/report.test.ts`]: 'test'
}

function run(fs: ModFs): {
  out: Promise<string | null>
  report: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn<(l: string) => void>>
} {
  const report = vi.fn()
  const log = vi.fn<(l: string) => void>()
  return {
    out: installMod({ name: BRIDGE_MOD_NAME, sourceDir: SRC, userDataDir: USER, fs, report, log }),
    report,
    log
  }
}

describe('installMod', () => {
  it('copies the shipped mod on the first run, without its tests', async () => {
    const fs = fakeFs(SHIPPED)
    expect(await run(fs).out).toBe(TARGET)
    expect(fs.files.get(`${TARGET}/hooks/register.ts`)).toBe('v1')
    expect(fs.files.get(`${TARGET}/.claude-plugin/plugin.json`)).toBe('{"name":"watcher-bridge"}')
    expect(fs.files.has(`${TARGET}/hooks/report.test.ts`)).toBe(false)
  })

  it('writes nothing when the installed copy already matches', async () => {
    const fs = fakeFs(SHIPPED)
    await run(fs).out
    fs.touched.length = 0
    expect(await run(fs).out).toBe(TARGET)
    expect(fs.touched).toEqual([])
  })

  it('writes nothing for files the engine adds to the installed copy', async () => {
    const fs = fakeFs(SHIPPED)
    await run(fs).out
    fs.files.set(`${TARGET}/.claude-plugin/types/claude-code/index.d.ts`, 'engine types')
    fs.files.set(`${TARGET}/tsconfig.json`, '{}')
    fs.touched.length = 0
    await run(fs).out
    expect(fs.touched).toEqual([])
  })

  it('replaces the folder whole when the shipped content changed, dropping old files', async () => {
    const fs = fakeFs(SHIPPED)
    await run(fs).out
    fs.files.set(`${TARGET}/hooks/old.ts`, 'stale')
    fs.files.set(`${SRC}/hooks/register.ts`, 'v2')
    expect(await run(fs).out).toBe(TARGET)
    expect(fs.files.get(`${TARGET}/hooks/register.ts`)).toBe('v2')
    expect(fs.files.has(`${TARGET}/hooks/old.ts`)).toBe(false)
  })

  it('never touches a path outside its own folder', async () => {
    const fs = fakeFs({ ...SHIPPED, '/data/mods/other/x': 'keep', '/data/settings.json': 'keep' })
    await run(fs).out
    fs.files.set(`${SRC}/hooks/register.ts`, 'v2')
    await run(fs).out
    expect(fs.touched.length).toBeGreaterThan(0)
    expect(fs.touched.every((p) => p === TARGET || p.startsWith(`${TARGET}/`))).toBe(true)
    expect(fs.files.get('/data/mods/other/x')).toBe('keep')
  })

  it('returns null, reports write_failed and logs one code without a path when a copy fails', async () => {
    const fs = fakeFs(SHIPPED)
    fs.writeFile = () => Promise.reject(new Error(`EACCES ${TARGET}`))
    const { out, report, log } = run(fs)
    expect(await out).toBeNull()
    expect(report).toHaveBeenCalledWith('write_failed')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][mods] code=mod_install_failed')
  })

  it('returns null when the shipped mod folder holds no files', async () => {
    const { out, report } = run(fakeFs({}))
    expect(await out).toBeNull()
    expect(report).toHaveBeenCalledWith('write_failed')
  })
})

describe('installMod with the memory mod', () => {
  it('installs the memory mod into its own folder beside the bridge mod', async () => {
    const fs = fakeFs({
      '/src/watcher-memory/.claude-plugin/plugin.json': '{"name":"watcher-memory"}',
      '/src/watcher-memory/hooks/register.ts': 'm1'
    })
    const report = vi.fn()
    const log = vi.fn<(l: string) => void>()
    expect(
      await installMod({
        name: MEMORY_MOD_NAME,
        sourceDir: '/src/watcher-memory',
        userDataDir: '/data',
        fs,
        report,
        log
      })
    ).toBe(join('/data', 'mods', 'watcher-memory'))
    const written = fs.touched
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((p) => p.startsWith(join('/data', 'mods', 'watcher-memory')))).toBe(true)
  })
})

describe('modSourceDir', () => {
  it('reads <resourcesPath>/mods/watcher-bridge when packaged', () => {
    expect(
      modSourceDir({ name: BRIDGE_MOD_NAME, isPackaged: true, resourcesPath: '/r', mainDir: '/x' })
    ).toBe('/r/mods/watcher-bridge')
  })

  it('reads the repo copy under src/mod when unpackaged', () => {
    expect(
      modSourceDir({
        name: BRIDGE_MOD_NAME,
        isPackaged: false,
        resourcesPath: '/r',
        mainDir: '/repo/out/main'
      })
    ).toBe('/repo/src/mod/watcher-bridge')
  })
})

describe('modSmokeCheck', () => {
  it('passes when the installed plugin.json exists', () => {
    expect(modSmokeCheck(TARGET, (p) => p === `${TARGET}/.claude-plugin/plugin.json`)).toEqual({
      installed: true,
      pass: true
    })
  })

  it('fails when nothing was installed', () => {
    expect(modSmokeCheck(null, () => true)).toEqual({ installed: false, pass: false })
  })
})

describe('the mod name', () => {
  it('each shipped mod has its manifest name, its builder entry and its folder', () => {
    const builderYml = readFileSync(join(__dirname, '../../../electron-builder.yml'), 'utf8')
    for (const name of [BRIDGE_MOD_NAME, MEMORY_MOD_NAME]) {
      expect(
        (
          JSON.parse(
            readFileSync(join(__dirname, `../../mod/${name}/.claude-plugin/plugin.json`), 'utf8')
          ) as { name: string }
        ).name
      ).toBe(name)
      expect(builderYml).toContain(`from: src/mod/${name}`)
      expect(builderYml).toContain(`to: mods/${name}`)
    }
  })

  it('matches the shipped plugin.json', () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '../../mod/watcher-bridge/.claude-plugin/plugin.json'), 'utf8')
    ) as { name: string; version: string }
    expect(manifest.name).toBe(BRIDGE_MOD_NAME)
  })

  it('is shipped by electron-builder extraResources under mods/<name>', () => {
    const yml = readFileSync(join(__dirname, '../../../electron-builder.yml'), 'utf8')
    expect(yml).toContain(`from: src/mod/${BRIDGE_MOD_NAME}`)
    expect(yml).toContain(`to: mods/${BRIDGE_MOD_NAME}`)
  })
})
