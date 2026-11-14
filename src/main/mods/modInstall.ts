// A shipped mod's install at start (spec 2026-10-18 §1.2): copy the shipped mod into
// <userData>/mods/<name>, the folder a spawn hands claude as `--plugin-dir`. Each profile has its
// own userData, so dev, drive and e2e never share a copy.
//
// The folder is replaced WHOLE, and only when a shipped file differs from the installed one.
// Files only the installed copy has (the engine lays its types and a tsconfig.json into a
// `--plugin-dir` folder) do not count as a difference, or every start would rewrite it.
//
// FAIL OPEN: a failed install returns null; sessions then launch without the mod
// (`mod_not_installed`) and storage health reports it. Never logs a path.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StorageProblemCode } from '../../shared/schemas/storageHealth'

/** A mod's folder and plugin name. Not `claude-…`: the engine reserves that prefix. The
 *  shipped `plugin.json` and `electron-builder.yml` hold the same string (modInstall.test). */
export const BRIDGE_MOD_NAME = 'watcher-bridge'
export const MEMORY_MOD_NAME = 'watcher-memory'
export type ModName = typeof BRIDGE_MOD_NAME | typeof MEMORY_MOD_NAME

export interface ModFs {
  /** Every file under `dir`, relative to it with `/`; [] when `dir` does not exist. */
  listFiles(dir: string): Promise<string[]>
  /** The file's bytes, or null when it does not exist. */
  readFile(path: string): Promise<Buffer | null>
  /** Writes the file, creating its folders. */
  writeFile(path: string, data: Buffer): Promise<void>
  removeDir(path: string): Promise<void>
}

export function modSourceDir(opts: {
  name: ModName
  isPackaged: boolean
  resourcesPath: string
  /** `__dirname` of the built main bundle — `<repo>/out/main` in every unpackaged run. */
  mainDir: string
}): string {
  return opts.isPackaged
    ? join(opts.resourcesPath, 'mods', opts.name)
    : join(opts.mainDir, '..', '..', 'src', 'mod', opts.name)
}

/** Shipped files: everything in the mod folder but its engine tests. */
const ships = (rel: string): boolean => !rel.endsWith('.test.ts')

export async function installMod(deps: {
  name: ModName
  sourceDir: string
  userDataDir: string
  fs: ModFs
  report: (code: StorageProblemCode) => void
  log: (line: string) => void
}): Promise<string | null> {
  const target = join(deps.userDataDir, 'mods', deps.name)
  try {
    const files = (await deps.fs.listFiles(deps.sourceDir)).filter(ships)
    if (files.length === 0) throw new Error('mod source holds no files')
    const shipped = new Map<string, Buffer>()
    for (const rel of files) {
      const data = await deps.fs.readFile(join(deps.sourceDir, rel))
      if (data === null) throw new Error('mod source file vanished')
      shipped.set(rel, data)
    }
    let same = true
    for (const [rel, data] of shipped) {
      const installed = await deps.fs.readFile(join(target, rel))
      if (installed === null || !installed.equals(data)) {
        same = false
        break
      }
    }
    if (same) return target
    await deps.fs.removeDir(target)
    for (const [rel, data] of shipped) await deps.fs.writeFile(join(target, rel), data)
    return target
  } catch {
    deps.log('[claude-watcher][mods] code=mod_install_failed')
    deps.report('write_failed')
    return null
  }
}

/** The packaged smoke's check: the install at start left a manifest behind. */
export function modSmokeCheck(
  dir: string | null,
  exists: (path: string) => boolean
): { installed: boolean; pass: boolean } {
  const installed = dir !== null && exists(join(dir, '.claude-plugin', 'plugin.json'))
  return { installed, pass: installed }
}

const isMissing = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && err.code === 'ENOENT'

/** The real filesystem behind `ModFs`. */
export const nodeModFs: ModFs = {
  async listFiles(dir) {
    try {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true })
      return entries
        .filter((e) => e.isFile())
        .map((e) =>
          join(e.parentPath, e.name)
            .slice(dir.length + 1)
            .split('\\')
            .join('/')
        )
        .sort()
    } catch (err) {
      if (isMissing(err)) return []
      throw err
    }
  },
  async readFile(path) {
    try {
      return await readFile(path)
    } catch (err) {
      if (isMissing(err)) return null
      throw err
    }
  },
  async writeFile(path, data) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  },
  async removeDir(path) {
    await rm(path, { recursive: true, force: true })
  }
}
