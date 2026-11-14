// The real filesystem behind file history, Context and the mod install, on a temp folder: the
// fakes in the other tests return these reasons; this proves the real adapters give them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeFileHistoryFs } from './fileHistory'
import { nodeContextFs } from './contextHandlers'
import { nodeModFs } from './modInstall'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-modfs-'))
})
afterEach(() => {
  chmodSync(dir, 0o700)
  rmSync(dir, { recursive: true, force: true })
})

const isRoot = process.getuid?.() === 0

describe('nodeFileHistoryFs.readOperatorFile', () => {
  it('reads a regular file', async () => {
    writeFileSync(join(dir, 'a.md'), 'hi')
    const r = await nodeFileHistoryFs.readOperatorFile(join(dir, 'a.md'), 100)
    expect(r.ok && r.data.toString()).toBe('hi')
  })

  it('reads through a symlink to a regular file', async () => {
    writeFileSync(join(dir, 'a.md'), 'hi')
    symlinkSync(join(dir, 'a.md'), join(dir, 'link.md'))
    expect((await nodeFileHistoryFs.readOperatorFile(join(dir, 'link.md'), 100)).ok).toBe(true)
  })

  it('calls a folder not_file', async () => {
    mkdirSync(join(dir, 'sub'))
    expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'sub'), 100)).toEqual({
      ok: false,
      reason: 'not_file'
    })
  })

  it('calls a dangling symlink missing', async () => {
    symlinkSync(join(dir, 'nowhere.md'), join(dir, 'dangling.md'))
    expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'dangling.md'), 100)).toEqual({
      ok: false,
      reason: 'missing'
    })
  })

  it('calls a file over the cap too_large', async () => {
    writeFileSync(join(dir, 'big.md'), 'x'.repeat(101))
    expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'big.md'), 100)).toEqual({
      ok: false,
      reason: 'too_large'
    })
  })

  it.skipIf(isRoot)('calls a file it may not read unreadable', async () => {
    writeFileSync(join(dir, 'locked.md'), 'x')
    chmodSync(join(dir, 'locked.md'), 0o000)
    expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'locked.md'), 100)).toEqual({
      ok: false,
      reason: 'unreadable'
    })
  })
})

describe('nodeContextFs', () => {
  it('writeFile into a missing folder rejects and creates no folder', async () => {
    await expect(
      nodeContextFs.writeFile(join(dir, 'gone', 'CLAUDE.md'), Buffer.from('x'))
    ).rejects.toThrow()
    expect(existsSync(join(dir, 'gone'))).toBe(false)
  })

  it('exists is false for a dangling symlink and true for a file', async () => {
    symlinkSync(join(dir, 'nowhere.md'), join(dir, 'dangling.md'))
    writeFileSync(join(dir, 'a.md'), 'x')
    expect(await nodeContextFs.exists(join(dir, 'dangling.md'))).toBe(false)
    expect(await nodeContextFs.exists(join(dir, 'a.md'))).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'isRunnable is true for a file with an execute bit and for a launcher, false for text',
    async () => {
      writeFileSync(join(dir, 'run.sh'), 'x')
      chmodSync(join(dir, 'run.sh'), 0o755)
      writeFileSync(join(dir, 'app.desktop'), 'x')
      writeFileSync(join(dir, 'notes.txt'), 'x')
      expect(await nodeContextFs.isRunnable(join(dir, 'run.sh'))).toBe(true)
      expect(await nodeContextFs.isRunnable(join(dir, 'app.desktop'))).toBe(true)
      expect(await nodeContextFs.isRunnable(join(dir, 'notes.txt'))).toBe(false)
    }
  )

  it('isDirectory is true only for a folder', async () => {
    writeFileSync(join(dir, 'a.md'), 'x')
    expect(await nodeContextFs.isDirectory(dir)).toBe(true)
    expect(await nodeContextFs.isDirectory(join(dir, 'a.md'))).toBe(false)
    expect(await nodeContextFs.isDirectory(join(dir, 'gone'))).toBe(false)
  })
})

describe('nodeModFs.listFiles', () => {
  it('lists every file under a folder, relative and sorted', async () => {
    mkdirSync(join(dir, 'hooks'))
    writeFileSync(join(dir, 'hooks', 'register.ts'), '')
    writeFileSync(join(dir, 'a.json'), '')
    expect(await nodeModFs.listFiles(dir)).toEqual(['a.json', 'hooks/register.ts'])
  })

  it('answers [] for a missing folder', async () => {
    expect(await nodeModFs.listFiles(join(dir, 'gone'))).toEqual([])
  })
})
