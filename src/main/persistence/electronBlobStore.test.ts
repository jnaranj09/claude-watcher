// The generic electron-store-backed blob store. The interesting case is the one
// `loadPersistedOrReset` can NEVER see: a SYNTACTICALLY corrupt JSON file makes conf throw a
// `SyntaxError` out of the electron-store CONSTRUCTOR (`clearInvalidConfig` defaults to false),
// so the store never exists and the Zod-level corrupt path never runs. This file pins the
// construct → back up → reconstruct recovery.
//
// `electron` and `electron-store` cannot load under the bare-node `main-unit` runtime, so both
// are mocked: `app.getPath` points at a real mkdtemp dir (the rename is a REAL fs rename), and
// the fake Store's first construction throws a real `SyntaxError`, exactly like conf.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  userData: '',
  /** The `name` passed to each electron-store construction, in order. */
  constructions: [] as string[],
  /** Thrown by the NEXT construction, then cleared (so the retry succeeds). */
  throwOnNextConstruction: null as unknown
}))

vi.mock('electron', () => ({ app: { getPath: (): string => h.userData } }))
vi.mock('electron-store', () => {
  class FakeStore<T> {
    readonly path: string
    private readonly data = new Map<string, T | undefined>()
    constructor(options: { name: string; fileExtension: string }) {
      h.constructions.push(options.name)
      if (h.throwOnNextConstruction !== null) {
        const err = h.throwOnNextConstruction
        h.throwOnNextConstruction = null
        throw err
      }
      this.path = join(h.userData, `${options.name}.${options.fileExtension}`)
    }
    get(key: string): T | undefined {
      return this.data.get(key)
    }
    set(key: string, value: T): void {
      this.data.set(key, value)
    }
  }
  return { default: FakeStore }
})

const { createElectronBlobStore } = await import('./electronBlobStore')

type Blob = { n: number }
const NAME = 'claude-watcher-templates'

function files(): string[] {
  return readdirSync(h.userData).sort()
}
function writeLiveFile(text: string): void {
  writeFileSync(join(h.userData, `${NAME}.json`), text, 'utf8')
}

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'blobstore-'))
  h.constructions = []
  h.throwOnNextConstruction = null
})
afterEach(() => {
  rmSync(h.userData, { recursive: true, force: true })
})

describe('createElectronBlobStore', () => {
  it('a healthy construction touches nothing on disk', () => {
    writeLiveFile('{"templates":{"version":1}}')
    const store = createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })
    expect(h.constructions).toEqual([NAME])
    expect(files()).toEqual([`${NAME}.json`])
    store.write({ n: 1 })
    expect(store.read()).toEqual({ n: 1 })
  })

  it('a SYNTACTICALLY corrupt file is backed up and the store reconstructs (never crashes)', () => {
    writeLiveFile('{ not json')
    h.throwOnNextConstruction = new SyntaxError('Unexpected token o in JSON at position 2')

    const store = createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })

    expect(h.constructions).toEqual([NAME, NAME]) // threw, then retried
    const left = files()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatch(new RegExp(`^${NAME}\\.corrupt-\\d+\\.json$`))
    // The reset store is usable — the operator's data is preserved beside it, not destroyed.
    expect(store.read()).toBeUndefined()
    store.write({ n: 2 })
    expect(store.read()).toEqual({ n: 2 })
  })

  it('a corrupt file that cannot be renamed still reconstructs (nothing to back up)', () => {
    // No file on disk at all → renameSync throws ENOENT → the reset proceeds anyway.
    h.throwOnNextConstruction = new SyntaxError('Unexpected end of JSON input')
    const store = createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })
    expect(h.constructions).toEqual([NAME, NAME])
    expect(files()).toEqual([])
    expect(store.read()).toBeUndefined()
  })

  it('a REALM-FOREIGN SyntaxError (matched by name, not instanceof) recovers the same way', () => {
    // conf matches this class by `error.name === 'SyntaxError'`. If conf were ever loaded in a
    // separate realm, its SyntaxError would fail `instanceof` here — the name check is what
    // keeps the backup working. Simulated with an Error carrying the name but not the identity.
    writeLiveFile('{ not json')
    const foreign = new Error('Unexpected token } in JSON at position 9')
    foreign.name = 'SyntaxError'
    expect(foreign instanceof SyntaxError).toBe(false) // pins WHY the name check exists
    h.throwOnNextConstruction = foreign

    const store = createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })

    expect(h.constructions).toEqual([NAME, NAME])
    const left = files()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatch(new RegExp(`^${NAME}\\.corrupt-\\d+\\.json$`))
    expect(store.read()).toBeUndefined()
  })

  it('a NON-SyntaxError construction failure propagates (index.ts degrades to in-memory)', () => {
    h.throwOnNextConstruction = new Error('EACCES: permission denied')
    expect(() => createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })).toThrow('EACCES')
    expect(h.constructions).toEqual([NAME]) // no retry on an unrelated failure
  })

  it('backup() renames the live file to <name>.corrupt-<ts>.json, and swallows a missing file', () => {
    writeLiveFile('{"templates":{"version":"nope"}}') // parses, fails Zod → backup() path
    const store = createElectronBlobStore<Blob>({ name: NAME, key: 'templates' })
    store.backup()
    const left = files()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatch(new RegExp(`^${NAME}\\.corrupt-\\d+\\.json$`))
    expect(() => store.backup()).not.toThrow() // already gone — the in-memory reset proceeds
  })
})
