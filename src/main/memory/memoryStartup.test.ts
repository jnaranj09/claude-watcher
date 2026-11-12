// Memory at app start (spec 2026-11-11 memory): the database file is opened once, its problem is
// told to storage health, and memory stays off (no store) when the file cannot be opened or the
// run is the smoke test. A cascade and the quit never throw. Real files in a temp dir.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { StorageReporter } from '../persistence/persistedBlob'
import { MEMORY_DB_FILE } from './memoryDb'
import { openMemory } from './memoryStartup'

const NOW = 1_762_800_000_000

let dir: string
let file: string
let report: Mock<StorageReporter>
let lines: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-watcher-memory-start-'))
  file = join(dir, MEMORY_DB_FILE)
  report = vi.fn<StorageReporter>()
  lines = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function open(smoke = false, at = file): ReturnType<typeof openMemory> {
  let ids = 0
  return openMemory({
    smoke,
    file: at,
    now: () => NOW,
    newId: () => `m${++ids}`,
    report,
    log: (line) => {
      lines.push(line)
    }
  })
}

describe('openMemory', () => {
  it('opens the file and builds the store, reporting nothing', () => {
    const memory = open()
    expect(memory).not.toBeNull()
    expect(existsSync(file)).toBe(true)
    expect(report).not.toHaveBeenCalled()
    memory?.close()
  })

  it('opens nothing under the smoke test', () => {
    expect(open(true)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
    expect(report).not.toHaveBeenCalled()
  })

  it('reports corrupt_reset and still builds the store over a damaged file', () => {
    writeFileSync(file, 'not a database, not even close to one'.repeat(200))
    const memory = open()
    expect(report).toHaveBeenCalledWith('corrupt_reset')
    expect(memory).not.toBeNull()
    expect(readdirSync(dir).some((name) => name.startsWith(`${MEMORY_DB_FILE}.corrupt-`))).toBe(
      true
    )
    memory?.close()
  })

  it('reports read_failed and leaves memory off when the file cannot be opened', () => {
    const memory = open(false, join(dir, 'missing-folder', MEMORY_DB_FILE))
    expect(memory).toBeNull()
    expect(report).toHaveBeenCalledWith('read_failed')
  })
})

describe('the opened memory', () => {
  it("removes a deleted workspace's items", () => {
    const memory = open()
    const store = memory?.store
    store?.add({
      text: { kind: 'specific', key: 'API port', value: '9280' },
      workspaceId: 'w1',
      check: null,
      basis: 'stated',
      origin: { by: 'operator', sessionId: null },
      meta: {
        folder: null,
        sessionName: null,
        tagIds: [],
        templateId: null,
        goalId: null,
        taskIds: []
      }
    })
    expect(store?.get('m1')).not.toBeNull()
    memory?.removeByWorkspace('w1')
    expect(
      store?.search(
        { workspaceId: 'w1', includeGlobal: true },
        { kind: null, query: null, filters: {}, offset: 0, limit: 10 },
        { sessionFolder: null, tagIdsByName: () => [], goalIdsByName: () => [] }
      ).total
    ).toBe(0)
    memory?.close()
  })

  it('a cascade the disk refuses logs a code and never throws', () => {
    const memory = open()
    memory?.close()
    expect(() => memory?.removeByWorkspace('w1')).not.toThrow()
    expect(lines).toContain('[claude-watcher][memory] code=memory_cascade_failed')
  })

  it('a close that fails logs a code and never throws', () => {
    const memory = open()
    memory?.close()
    expect(() => memory?.close()).not.toThrow()
    expect(lines).toContain('[claude-watcher][memory] code=memory_db_close_failed')
  })
})
