// Security audit lead `mods/fileHistory:prune-distinct-paths-unbounded`: the bridge mod's report
// (and through it the repository a session runs in) chooses which `.md` files are snapshotted.
// Fault: a history that keeps the newest version of every distinct file, so many files pass the
// total cap on disk and the file count has no bound. Real files and the real store fs.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFileHistory,
  FILE_HISTORY_MAX_PATHS,
  FILE_HISTORY_MAX_TOTAL_BYTES,
  nodeFileHistoryFs,
  type FileHistory
} from './fileHistory'

let root = ''
let clock = 0

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cw-file-history-bounds-'))
  mkdirSync(join(root, 'repo'))
  clock = 1000
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function history(): FileHistory {
  let n = 0
  return createFileHistory({
    dir: join(root, 'store'),
    fs: nodeFileHistoryFs,
    now: () => clock,
    newId: () => `v${++n}`,
    report: () => undefined,
    log: () => undefined
  })
}

function blobBytes(): number {
  const dir = join(root, 'store', 'blobs')
  return readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)
}

async function snapshotEach(h: FileHistory, paths: string[]): Promise<void> {
  for (const path of paths) {
    clock += 1
    await h.snapshot([path])
  }
}

describe('file history bounds over many distinct files', () => {
  it('eight distinct 900 KiB files stay within the total cap on disk, after a reload too', async () => {
    const paths = Array.from({ length: 8 }, (_, i) => join(root, 'repo', `f${i}.md`))
    for (const p of paths) writeFileSync(p, p.padEnd(900 * 1024, '.'))
    await snapshotEach(history(), paths)
    expect(blobBytes()).toBeLessThanOrEqual(FILE_HISTORY_MAX_TOTAL_BYTES)
    const reloaded = history()
    await reloaded.snapshot([]) // waits for the index load
    expect(paths.filter((p) => reloaded.list(p).length > 0)).toEqual(paths.slice(3))
  })

  it('past the file cap, the file seen longest ago is dropped', async () => {
    const paths = Array.from({ length: FILE_HISTORY_MAX_PATHS + 1 }, (_, i) =>
      join(root, 'repo', `n${i}.md`)
    )
    for (const p of paths) writeFileSync(p, p)
    const h = history()
    await snapshotEach(h, paths)
    expect([h.list(paths[0] ?? '').length, h.list(paths[1] ?? '').length]).toEqual([0, 1])
    expect(readdirSync(join(root, 'store', 'blobs'))).toHaveLength(FILE_HISTORY_MAX_PATHS)
  })
})
