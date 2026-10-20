// File history (spec 2026-10-18 §3): every instruction file a session loads is snapshotted into
// the app's userData when its content changed. Fake fs + injected clock and ids.
import { describe, it, expect, vi } from 'vitest'
import {
  createFileHistory,
  FILE_HISTORY_MAX_FILE_BYTES,
  FILE_HISTORY_MAX_TOTAL_BYTES,
  FILE_HISTORY_MAX_VERSIONS,
  type FileHistoryFs,
  type OperatorFileRead
} from './fileHistory'

const DIR = '/data/claude-watcher-file-history'

type Operator = string | Exclude<OperatorFileRead, { ok: true }>['reason']

function world(operator: Record<string, Operator> = {}): {
  fs: FileHistoryFs
  operator: Map<string, Operator>
  store: Map<string, string>
  renames: [string, string][]
  deps: Parameters<typeof createFileHistory>[0]
  report: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn<(l: string) => void>>
  clock: { now: number }
} {
  const ops = new Map(Object.entries(operator))
  const store = new Map<string, string>()
  const renames: [string, string][] = []
  const tick = (): Promise<void> => Promise.resolve()
  const fs: FileHistoryFs = {
    async readOperatorFile(path, maxBytes) {
      await tick()
      const v = ops.get(path)
      if (v === undefined) return { ok: false, reason: 'missing' }
      if (v === 'not_file' || v === 'unreadable' || v === 'missing' || v === 'too_large') {
        return { ok: false, reason: v }
      }
      if (Buffer.byteLength(v) > maxBytes) return { ok: false, reason: 'too_large' }
      return { ok: true, data: Buffer.from(v) }
    },
    async readStoreFile(path) {
      await tick()
      const v = store.get(path)
      return v === undefined ? null : Buffer.from(v)
    },
    async writeStoreFile(path, data) {
      await tick()
      store.set(path, data.toString())
    },
    async removeStoreFile(path) {
      await tick()
      store.delete(path)
    },
    async renameStoreFile(from, to) {
      await tick()
      renames.push([from, to])
      const v = store.get(from)
      store.delete(from)
      if (v !== undefined) store.set(to, v)
    }
  }
  const clock = { now: 1000 }
  let n = 0
  const report = vi.fn()
  const log = vi.fn<(l: string) => void>()
  const deps = {
    dir: DIR,
    fs,
    now: () => clock.now,
    newId: () => `v${++n}`,
    report,
    log
  }
  return { fs, operator: ops, store, renames, deps, report, log, clock }
}

const blobCount = (store: Map<string, string>): number =>
  [...store.keys()].filter((k) => k.startsWith(`${DIR}/blobs/`)).length

describe('createFileHistory', () => {
  it('adds a version on the first snapshot of a file', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    expect(h.list('/p/CLAUDE.md')).toEqual([
      {
        id: 'v1',
        path: '/p/CLAUDE.md',
        hash: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        size: 3,
        seenAt: 1000
      }
    ])
  })

  it('adds no version when the content did not change', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    await h.snapshot(['/p/CLAUDE.md'])
    expect(h.list('/p/CLAUDE.md')).toHaveLength(1)
  })

  it('adds one version when the content changed, newest first', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    w.operator.set('/p/CLAUDE.md', 'two')
    w.clock.now = 2000
    await h.snapshot(['/p/CLAUDE.md'])
    expect(h.list('/p/CLAUDE.md').map((v) => v.seenAt)).toEqual([2000, 1000])
    expect(await h.content(h.list('/p/CLAUDE.md')[0]?.id ?? '')).toBe('two')
  })

  it(`keeps the newest ${FILE_HISTORY_MAX_VERSIONS} versions of a file, dropping the oldest and its blob`, async () => {
    const w = world()
    const h = createFileHistory(w.deps)
    for (let i = 0; i <= FILE_HISTORY_MAX_VERSIONS; i++) {
      w.operator.set('/p/a.md', `content ${i}`)
      w.clock.now = 1000 + i
      await h.snapshot(['/p/a.md'])
    }
    const versions = h.list('/p/a.md')
    expect(versions).toHaveLength(FILE_HISTORY_MAX_VERSIONS)
    expect(versions.at(-1)?.seenAt).toBe(1001)
    expect(blobCount(w.store)).toBe(FILE_HISTORY_MAX_VERSIONS)
  })

  it('over the total cap, drops the oldest version of the largest history', async () => {
    const w = world()
    const h = createFileHistory(w.deps)
    const big = (tag: string): string => tag.padEnd(900 * 1024, '.')
    for (let i = 0; i < 4; i++) {
      w.operator.set('/p/a.md', big(`a${i}`))
      w.clock.now = 1000 + i
      await h.snapshot(['/p/a.md'])
    }
    for (let i = 0; i < 2; i++) {
      w.operator.set('/p/b.md', big(`b${i}`))
      w.clock.now = 2000 + i
      await h.snapshot(['/p/b.md'])
    }
    expect(h.list('/p/a.md').map((v) => v.seenAt)).toEqual([1003, 1002, 1001])
    expect(h.list('/p/b.md')).toHaveLength(2)
    const total = [...w.store.entries()]
      .filter(([k]) => k.startsWith(`${DIR}/blobs/`))
      .reduce((sum, [, v]) => sum + Buffer.byteLength(v), 0)
    expect(total).toBeLessThanOrEqual(FILE_HISTORY_MAX_TOTAL_BYTES)
  })

  it('never drops a file’s newest version, even over the total cap', async () => {
    const w = world()
    const h = createFileHistory(w.deps)
    const paths = Array.from({ length: 6 }, (_, i) => `/p/f${i}.md`)
    for (const p of paths) w.operator.set(p, p.padEnd(900 * 1024, '.'))
    await h.snapshot(paths)
    for (const p of paths) expect(h.list(p)).toHaveLength(1)
  })

  it('lists a file over the size cap as too large and adds no version, with one code', async () => {
    const w = world({ '/p/huge.md': 'x'.repeat(FILE_HISTORY_MAX_FILE_BYTES + 1) })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/huge.md'])
    expect(h.list('/p/huge.md')).toEqual([])
    expect(h.tooLarge('/p/huge.md')).toBe(true)
    expect(w.log).toHaveBeenCalledTimes(1)
    expect(w.log).toHaveBeenCalledWith('[claude-watcher][mods] code=file_history_too_large')
  })

  it('two sessions snapshotting the same file at once add one version', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    const h = createFileHistory(w.deps)
    await Promise.all([h.snapshot(['/p/CLAUDE.md']), h.snapshot(['/p/CLAUDE.md'])])
    expect(h.list('/p/CLAUDE.md')).toHaveLength(1)
  })

  it('skips a folder, a dangling symlink and an unreadable file, and still keeps a good one', async () => {
    const w = world({
      '/p/dir.md': 'not_file',
      '/p/dangling.md': 'missing',
      '/p/locked.md': 'unreadable',
      '/p/good.md': 'ok'
    })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/dir.md', '/p/dangling.md', '/p/locked.md', '/p/good.md'])
    expect(h.list('/p/good.md')).toHaveLength(1)
    expect(w.log.mock.calls.map(([l]) => l)).toEqual([
      '[claude-watcher][mods] code=file_history_read_failed',
      '[claude-watcher][mods] code=file_history_read_failed',
      '[claude-watcher][mods] code=file_history_read_failed'
    ])
  })

  it('keeps the history across a restart', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    await createFileHistory(w.deps).snapshot(['/p/CLAUDE.md'])
    const again = createFileHistory(w.deps)
    await again.snapshot([])
    expect(again.list('/p/CLAUDE.md')).toHaveLength(1)
  })

  it('backs up a corrupt index, starts fresh and reports corrupt_reset', async () => {
    const w = world()
    w.store.set(`${DIR}/index.json`, '{"version":9}')
    const h = createFileHistory(w.deps)
    await h.snapshot([])
    expect(w.renames).toEqual([[`${DIR}/index.json`, `${DIR}/index.corrupt-1000.json`]])
    expect(w.report).toHaveBeenCalledWith('corrupt_reset')
    expect(h.list('/p/CLAUDE.md')).toEqual([])
  })

  it('reports write_failed and does not throw when the store cannot be written', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    w.fs.writeStoreFile = () => Promise.reject(new Error('ENOSPC'))
    const h = createFileHistory(w.deps)
    await expect(h.snapshot(['/p/CLAUDE.md'])).resolves.toBeUndefined()
    expect(w.report).toHaveBeenCalledWith('write_failed')
  })

  it('logs no path', async () => {
    const w = world({
      '/p/dir.md': 'not_file',
      '/p/huge.md': 'x'.repeat(FILE_HISTORY_MAX_FILE_BYTES + 1)
    })
    w.store.set(`${DIR}/index.json`, 'not json')
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/dir.md', '/p/huge.md'])
    for (const [line] of w.log.mock.calls) expect(line).not.toContain('/p/')
  })

  it('snapshots only absolute .md paths', async () => {
    const w = world({ '/p/run.sh': 'a', 'rel.md': 'b', '/p/NOTES.MD': 'c' })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/run.sh', 'rel.md', '/p/NOTES.MD'])
    expect(h.list('/p/run.sh')).toEqual([])
    expect(h.list('rel.md')).toEqual([])
    expect(h.list('/p/NOTES.MD')).toHaveLength(1)
  })

  it('after an index it could not read, backs it up before the first save writes a new one', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    w.store.set(`${DIR}/index.json`, 'old index')
    const read = w.fs.readStoreFile.bind(w.fs)
    w.fs.readStoreFile = (path) =>
      path.endsWith('index.json') ? Promise.reject(new Error('EIO')) : read(path)
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    expect(w.renames).toEqual([[`${DIR}/index.json`, `${DIR}/index.unread-1000.json`]])
    expect(w.store.get(`${DIR}/index.unread-1000.json`)).toBe('old index')
    expect(h.list('/p/CLAUDE.md')).toHaveLength(1)
  })

  it('after an index it could not read and could not back up, keeps the history in memory and never writes the index', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    w.store.set(`${DIR}/index.json`, 'old index')
    w.fs.readStoreFile = () => Promise.reject(new Error('EIO'))
    w.fs.renameStoreFile = () => Promise.reject(new Error('EACCES'))
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    expect(w.store.get(`${DIR}/index.json`)).toBe('old index')
    expect(w.report).toHaveBeenCalledWith('backup_failed')
    expect(h.list('/p/CLAUDE.md')).toHaveLength(1)
  })

  it('get and content answer by version id; an unknown id is null', async () => {
    const w = world({ '/p/CLAUDE.md': 'one' })
    const h = createFileHistory(w.deps)
    await h.snapshot(['/p/CLAUDE.md'])
    expect(h.get('v1')?.path).toBe('/p/CLAUDE.md')
    expect(await h.content('v1')).toBe('one')
    expect(h.get('nope')).toBeNull()
    expect(await h.content('nope')).toBeNull()
  })

  describe('commitCurrent (restore keeps what is there first)', () => {
    it('snapshots the file as it is now', async () => {
      const w = world({ '/p/CLAUDE.md': 'now' })
      const h = createFileHistory(w.deps)
      expect(await h.commitCurrent('/p/CLAUDE.md')).toBe('ok')
      expect(await h.content(h.list('/p/CLAUDE.md')[0]?.id ?? '')).toBe('now')
    })

    it('is ok for a deleted file: there is nothing to keep', async () => {
      const h = createFileHistory(world().deps)
      expect(await h.commitCurrent('/p/gone.md')).toBe('ok')
    })

    it('refuses a current file too large to keep', async () => {
      const w = world({ '/p/huge.md': 'x'.repeat(FILE_HISTORY_MAX_FILE_BYTES + 1) })
      expect(await createFileHistory(w.deps).commitCurrent('/p/huge.md')).toBe('file_too_large')
    })

    it('refuses an unreadable current file', async () => {
      const w = world({ '/p/locked.md': 'unreadable' })
      expect(await createFileHistory(w.deps).commitCurrent('/p/locked.md')).toBe('unreadable')
    })

    it('answers store_write_failed when the snapshot cannot be written', async () => {
      const w = world({ '/p/CLAUDE.md': 'now' })
      w.fs.writeStoreFile = () => Promise.reject(new Error('ENOSPC'))
      expect(await createFileHistory(w.deps).commitCurrent('/p/CLAUDE.md')).toBe(
        'store_write_failed'
      )
    })
  })
})
