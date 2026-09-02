import { describe, it, expect, vi } from 'vitest'
import {
  loadPersistedOrReset,
  createInMemoryBlobStore,
  type PersistedBlobStore
} from './persistedBlob'

type Blob = { n: number }
const parse = (raw: unknown): Blob => {
  if (typeof raw === 'object' && raw !== null && typeof (raw as Blob).n === 'number') {
    return raw as Blob
  }
  throw new Error('bad')
}
function fake(
  seed: unknown,
  opts: { readThrows?: boolean; backupThrows?: boolean } = {}
): { store: PersistedBlobStore<Blob>; backups: () => number } {
  let backups = 0
  const store: PersistedBlobStore<Blob> = {
    read: () => {
      if (opts.readThrows) throw new Error('io')
      return seed
    },
    write: () => {},
    backup: () => {
      backups++
      if (opts.backupThrows) throw new Error('io')
    }
  }
  return { store, backups: () => backups }
}
function load(store: PersistedBlobStore<Blob>): {
  value: Blob
  onProblem: ReturnType<typeof vi.fn>
} {
  const onProblem = vi.fn()
  const value = loadPersistedOrReset<Blob>({
    blobStore: store,
    parse,
    fallback: () => ({ n: 0 }),
    onProblem
  })
  return { value, onProblem }
}

describe('loadPersistedOrReset', () => {
  it('nothing persisted ⇒ fallback, no problem reported', () => {
    const { value, onProblem } = load(fake(undefined).store)
    expect(value).toEqual({ n: 0 })
    expect(onProblem).not.toHaveBeenCalled()
  })
  it('healthy blob ⇒ parsed value', () => {
    expect(load(fake({ n: 7 }).store).value).toEqual({ n: 7 })
  })
  it('corrupt blob ⇒ backup + fallback + corrupt_reset_to_defaults', () => {
    const f = fake({ n: 'x' })
    const { value, onProblem } = load(f.store)
    expect(value).toEqual({ n: 0 })
    expect(f.backups()).toBe(1)
    expect(onProblem).toHaveBeenCalledWith('corrupt_reset_to_defaults')
  })
  it('corrupt blob + backup failure ⇒ still fallback, both problems reported in order', () => {
    const { onProblem } = load(fake({ n: 'x' }, { backupThrows: true }).store)
    expect(onProblem.mock.calls.map((c) => c[0])).toEqual([
      'backup_failed',
      'corrupt_reset_to_defaults'
    ])
  })
  it('unreadable store ⇒ fallback + read_failed, no backup', () => {
    const f = fake(undefined, { readThrows: true })
    const { value, onProblem } = load(f.store)
    expect(value).toEqual({ n: 0 })
    expect(f.backups()).toBe(0)
    expect(onProblem).toHaveBeenCalledWith('read_failed')
  })
  it('in-memory store reads undefined and swallows writes/backups', () => {
    const s = createInMemoryBlobStore<Blob>()
    expect(s.read()).toBeUndefined()
    expect(() => s.write({ n: 1 })).not.toThrow()
    expect(() => s.backup()).not.toThrow()
  })
})
