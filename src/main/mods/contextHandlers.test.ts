// Context's IPC handler bodies (spec 2026-10-18 §4), kept out of the registrar so they test in
// node. The renderer never sends a path: a session id + file index, or a version id; main
// resolves the path from its own records. Fakes for the setup, the history and the fs.
import { describe, it, expect, vi } from 'vitest'
import { createContextHandlers, type ContextFs } from './contextHandlers'
import type { SessionSetupState } from '../../shared/schemas/contextIpc'
import type { FileVersion } from '../../shared/schemas/fileHistory'
import type { FileHistory, OperatorFileRead } from './fileHistory'
import { modReportFixture, MOD_REPORT_SESSION_ID as SID } from '../../__fixtures__/modReport'

const FILE = '/work/app/CLAUDE.md' // fileIndex 1 in the fixture
const V: FileVersion = { id: 'v1', path: FILE, hash: 'a'.repeat(64), size: 3, seenAt: 1 }

function world(
  opts: {
    states?: Record<string, SessionSetupState>
    versions?: FileVersion[]
    contents?: Record<string, string>
    disk?: Record<string, string | Exclude<OperatorFileRead, { ok: true }>['reason']>
    dirs?: string[]
  } = {}
): {
  handlers: ReturnType<typeof createContextHandlers>
  fs: ContextFs & { calls: string[]; writes: [string, string][] }
  history: FileHistory & { committed: string[] }
  openPath: ReturnType<typeof vi.fn<(p: string) => Promise<string>>>
} {
  const states = opts.states ?? { [SID]: { state: 'ready', report: modReportFixture() } }
  const versions = opts.versions ?? [V]
  const contents = opts.contents ?? { v1: 'old' }
  const disk = new Map(Object.entries(opts.disk ?? { [FILE]: 'new' }))
  const dirs = new Set(opts.dirs ?? ['/work/app', '/home/op/.claude', '/work/app/docs'])
  const calls: string[] = []
  const writes: [string, string][] = []
  const fs: ContextFs & { calls: string[]; writes: [string, string][] } = {
    calls,
    writes,
    readCurrent(path, max) {
      calls.push(`read ${path}`)
      const v = disk.get(path)
      if (v === undefined) return Promise.resolve({ ok: false, reason: 'missing' })
      if (v === 'not_file' || v === 'unreadable' || v === 'too_large' || v === 'missing') {
        return Promise.resolve({ ok: false, reason: v })
      }
      if (v.length > max) return Promise.resolve({ ok: false, reason: 'too_large' })
      return Promise.resolve({ ok: true, data: Buffer.from(v) })
    },
    isDirectory(path) {
      calls.push(`isDirectory ${path}`)
      return Promise.resolve(dirs.has(path))
    },
    exists(path) {
      calls.push(`exists ${path}`)
      return Promise.resolve(disk.has(path))
    },
    writeFile(path, data) {
      calls.push(`write ${path}`)
      writes.push([path, data.toString()])
      disk.set(path, data.toString())
      return Promise.resolve()
    }
  }
  const committed: string[] = []
  const history: FileHistory & { committed: string[] } = {
    committed,
    snapshot: () => Promise.resolve(),
    list: (path) => versions.filter((v) => v.path === path),
    get: (id) => versions.find((v) => v.id === id) ?? null,
    content: (id) => Promise.resolve(contents[id] ?? null),
    tooLarge: () => false,
    commitCurrent: (path) => {
      committed.push(path)
      return Promise.resolve('ok')
    }
  }
  const openPath = vi.fn<(p: string) => Promise<string>>(() => Promise.resolve(''))
  const setup = {
    get: (id: string): SessionSetupState => states[id] ?? { state: 'waiting' },
    reportsPath: (path: string): boolean =>
      Object.values(states).some(
        (s) => s.state === 'ready' && s.report.instructionFiles.some((f) => f.path === path)
      )
  }
  return {
    handlers: createContextHandlers({ setup, history, fs, openPath }),
    fs,
    history,
    openPath
  }
}

describe('get', () => {
  it.each<SessionSetupState>([
    { state: 'ready', report: modReportFixture() },
    { state: 'waiting' },
    { state: 'unavailable', reason: 'claude_too_old' }
  ])('passes the $state state through', (state) => {
    const { handlers } = world({ states: { [SID]: state } })
    expect(handlers.get({ sessionId: SID })).toEqual(state)
  })
})

describe('list', () => {
  it('returns the versions of the file at that index', () => {
    const { handlers } = world()
    expect(handlers.list({ sessionId: SID, fileIndex: 1 })).toEqual({
      ok: true,
      value: { versions: [V], tooLarge: false }
    })
  })

  it.each([
    ['index -1', { sessionId: SID, fileIndex: -1 }],
    ['an index past the end', { sessionId: SID, fileIndex: 3 }],
    ['a session that is not live', { sessionId: 'not-live', fileIndex: 1 }]
  ])('refuses %s with file_missing and touches no file', (_name, arg) => {
    const { handlers, fs } = world()
    expect(handlers.list(arg)).toEqual({ ok: false, code: 'file_missing' })
    expect(fs.calls).toEqual([])
  })
})

describe('diff', () => {
  it('diffs the version against the file now', async () => {
    const { handlers } = world()
    expect(await handlers.diff({ versionId: 'v1' })).toEqual({
      ok: true,
      value: {
        lines: [
          { op: 'del', text: 'old' },
          { op: 'add', text: 'new' }
        ]
      }
    })
  })

  it('refuses file_missing when the file is gone now', async () => {
    const { handlers } = world({ disk: {} })
    expect(await handlers.diff({ versionId: 'v1' })).toEqual({ ok: false, code: 'file_missing' })
  })

  it('refuses file_too_large when the file now is over the cap', async () => {
    const { handlers } = world({ disk: { [FILE]: 'too_large' } })
    expect(await handlers.diff({ versionId: 'v1' })).toEqual({ ok: false, code: 'file_too_large' })
  })

  it('refuses file_too_large when the two texts differ in too many lines to compare', async () => {
    const many = (tag: string): string =>
      Array.from({ length: 3000 }, (_, i) => `${tag} ${i}`).join('\n')
    const { handlers } = world({ contents: { v1: many('a') }, disk: { [FILE]: many('b') } })
    expect(await handlers.diff({ versionId: 'v1' })).toEqual({ ok: false, code: 'file_too_large' })
  })

  it('refuses version_not_found for an unknown id', async () => {
    const { handlers, fs } = world()
    expect(await handlers.diff({ versionId: 'nope' })).toEqual({
      ok: false,
      code: 'version_not_found'
    })
    expect(fs.calls).toEqual([])
  })

  it('refuses version_not_found for a version no live report names, reading nothing', async () => {
    const other: FileVersion = { ...V, id: 'v9', path: '/etc/passwd' }
    const { handlers, fs } = world({ versions: [V, other] })
    expect(await handlers.diff({ versionId: 'v9' })).toEqual({
      ok: false,
      code: 'version_not_found'
    })
    expect(fs.calls).toEqual([])
  })
})

describe('open', () => {
  it('opens the path from the report in the operator’s editor', async () => {
    const { handlers, openPath } = world()
    expect(await handlers.open({ sessionId: SID, fileIndex: 1 })).toEqual({ ok: true, value: null })
    expect(openPath).toHaveBeenCalledWith(FILE)
  })

  it('refuses file_missing when the file is gone', async () => {
    const { handlers, openPath } = world({ disk: {} })
    expect(await handlers.open({ sessionId: SID, fileIndex: 1 })).toEqual({
      ok: false,
      code: 'file_missing'
    })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('refuses file_open_failed when the system cannot open it', async () => {
    const { handlers, openPath } = world()
    openPath.mockResolvedValue('no application')
    expect(await handlers.open({ sessionId: SID, fileIndex: 1 })).toEqual({
      ok: false,
      code: 'file_open_failed'
    })
  })

  it('refuses a forged index with file_missing and opens nothing', async () => {
    const { handlers, openPath } = world()
    expect(await handlers.open({ sessionId: SID, fileIndex: 99 })).toEqual({
      ok: false,
      code: 'file_missing'
    })
    expect(openPath).not.toHaveBeenCalled()
  })
})

describe('restore', () => {
  it('keeps the current file first, then writes the version, and names the file', async () => {
    const { handlers, fs, history } = world()
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: true,
      value: { fileName: 'CLAUDE.md' }
    })
    expect(history.committed).toEqual([FILE])
    expect(fs.writes).toEqual([[FILE, 'old']])
  })

  it('refuses version_not_found for a version no live report names, and writes nothing', async () => {
    const other: FileVersion = { ...V, id: 'v9', path: '/home/op/.bashrc' }
    const { handlers, fs, history } = world({ versions: [V, other], contents: { v9: 'x' } })
    expect(await handlers.restore({ versionId: 'v9' })).toEqual({
      ok: false,
      code: 'version_not_found'
    })
    expect(fs.writes).toEqual([])
    expect(history.committed).toEqual([])
  })

  it('refuses store_write_failed when the current file cannot be kept, and writes nothing', async () => {
    const { handlers, fs, history } = world()
    history.commitCurrent = () => Promise.resolve('store_write_failed')
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: false,
      code: 'store_write_failed'
    })
    expect(fs.writes).toEqual([])
  })

  it('refuses file_too_large when the current file is too large to keep', async () => {
    const { handlers, fs, history } = world()
    history.commitCurrent = () => Promise.resolve('file_too_large')
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: false,
      code: 'file_too_large'
    })
    expect(fs.writes).toEqual([])
  })

  it('refuses file_restore_failed when the current file cannot be read to keep, and writes nothing', async () => {
    const { handlers, fs, history } = world()
    history.commitCurrent = () => Promise.resolve('unreadable')
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: false,
      code: 'file_restore_failed'
    })
    expect(fs.writes).toEqual([])
  })

  it('refuses file_restore_failed when the folder is gone, creating nothing and keeping nothing', async () => {
    const { handlers, fs, history } = world({ dirs: [] })
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: false,
      code: 'file_restore_failed'
    })
    expect(fs.writes).toEqual([])
    expect(history.committed).toEqual([])
  })

  it('recreates a deleted file whose folder still exists', async () => {
    const { handlers, fs } = world({ disk: {} })
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: true,
      value: { fileName: 'CLAUDE.md' }
    })
    expect(fs.writes).toEqual([[FILE, 'old']])
  })

  it('refuses file_restore_failed when the write fails', async () => {
    const { handlers, fs } = world()
    fs.writeFile = () => Promise.reject(new Error('EACCES'))
    expect(await handlers.restore({ versionId: 'v1' })).toEqual({
      ok: false,
      code: 'file_restore_failed'
    })
  })
})
