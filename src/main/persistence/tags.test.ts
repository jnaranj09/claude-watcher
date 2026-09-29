import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import { describe, it, expect, vi } from 'vitest'
import { createTagsStore, TAG_ERROR, type TagRuleRef, type TagsBlobStore } from './tags'
import type { TagsFile } from '../../shared/schemas/tag'

const ROW = { name: 'prod', color: 'rose' as const, workspaceId: null }

function fakeBlob(
  seed: unknown,
  opts: { writeThrows?: boolean } = {}
): {
  blobStore: TagsBlobStore
  writes: TagsFile[]
  backups: () => number
  current: () => unknown
} {
  let blob: unknown = seed
  const writes: TagsFile[] = []
  let backups = 0
  const blobStore: TagsBlobStore = {
    read: () => blob,
    write: (value) => {
      if (opts.writeThrows) throw new Error('io')
      writes.push(value)
      blob = value
    },
    backup: () => {
      backups++
    }
  }
  return { blobStore, writes, backups: () => backups, current: () => blob }
}

function make(
  seed: unknown = undefined,
  opts: { writeThrows?: boolean; refs?: Record<string, TagRuleRef[]> } = {}
): {
  store: ReturnType<typeof createTagsStore>
  fake: ReturnType<typeof fakeBlob>
  log: ReturnType<typeof vi.fn>
} {
  const fake = fakeBlob(seed, opts)
  const log = vi.fn()
  let n = 0
  const store = createTagsStore({
    blobStore: fake.blobStore,
    log,
    newId: () => `id-${++n}`,
    ruleRefs: (id) => opts.refs?.[id] ?? []
  })
  return { store, fake, log }
}

describe('createTagsStore — load', () => {
  it('fresh install: empty list, writes the empty v1 file, logs nothing', () => {
    const { store, fake, log } = make()
    expect(store.list()).toEqual([])
    expect(fake.writes).toEqual([{ version: 1, tags: [] }])
    expect(log).not.toHaveBeenCalled()
  })

  it('healthy file: lists rows sorted by name, case-insensitive', () => {
    const { store } = make({
      version: 1,
      tags: [
        { id: 'b', ...ROW, name: 'zeta' },
        { id: 'a', ...ROW, name: 'Alpha' },
        { id: 'c', ...ROW, name: 'beta' }
      ]
    })
    expect(store.list().map((t) => t.name)).toEqual(['Alpha', 'beta', 'zeta'])
  })

  it('corrupt file: backup + empty + code, and the log never carries a name', () => {
    const { store, fake, log } = make({
      version: 1,
      tags: [{ id: 'x', name: 'secret-client', color: 'chartreuse', workspaceId: null }]
    })
    expect(store.list()).toEqual([])
    expect(fake.backups()).toBe(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[claude-watcher][tags] code=tags_corrupt_reset_to_defaults')
    for (const line of lines) expect(line).not.toContain('secret-client')
  })

  // W-11 — the guard is `.default(null)` on TagSchema.workspaceId; reverting it turns this red.
  it('loads a row written without workspaceId as GLOBAL, without a backup', () => {
    const { store, fake, log } = make({
      version: 1,
      tags: [{ id: 'x', name: 'prod', color: 'rose' }]
    })
    expect(store.list()).toEqual([{ id: 'x', name: 'prod', color: 'rose', workspaceId: null }])
    expect(fake.backups()).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('createTagsStore — save / get / remove', () => {
  it('create mints an id, returns the saved row + the sorted list, persists', () => {
    const { store, fake } = make()
    const out = store.save(ROW)
    expect(out.saved).toEqual({ id: 'id-1', ...ROW })
    expect(out.tags).toEqual([out.saved])
    expect(store.get('id-1')).toEqual(out.saved)
    expect(fake.current()).toEqual({ version: 1, tags: [out.saved] })
  })

  it('update keeps the id and replaces the fields', () => {
    const { store } = make()
    store.save(ROW)
    const out = store.save({ id: 'id-1', ...ROW, name: 'production', color: 'amber' })
    expect(out.saved).toEqual({ id: 'id-1', name: 'production', color: 'amber', workspaceId: null })
    expect(store.list()).toHaveLength(1)
  })

  it('update with an unknown id throws tag_not_found and changes nothing', () => {
    const { store } = make()
    expect(() => store.save({ id: 'ghost', ...ROW })).toThrow(TAG_ERROR.notFound)
    expect(store.list()).toEqual([])
  })

  it('remove drops the row; an unknown id is a no-op that does not write', () => {
    const { store, fake } = make()
    store.save(ROW)
    const before = fake.writes.length
    expect(store.remove('id-1')).toEqual([])
    expect(store.remove('id-1')).toEqual([])
    expect(fake.writes.length).toBe(before + 1)
  })

  it('removeByWorkspace deletes only that workspace, returns the count, and persists', () => {
    const { store, fake } = make()
    store.save({ ...ROW, name: 'G', workspaceId: null })
    store.save({ ...ROW, name: 'A', workspaceId: 'w1' })
    store.save({ ...ROW, name: 'B', workspaceId: 'w2' })
    const before = fake.writes.length
    expect(store.removeByWorkspace('w1')).toBe(1)
    expect(store.list().map((t) => t.name)).toEqual(['B', 'G'])
    expect(fake.writes.length).toBe(before + 1)
  })

  it('UX-06: a failed write undoes the save, throws store_write_failed, and logs tags_write_failed', () => {
    const { store, log } = make(undefined, { writeThrows: true })
    expect(() => store.save(ROW)).toThrow(STORE_WRITE_FAILED)
    expect(store.list()).toEqual([])
    expect(log).toHaveBeenCalledWith('[claude-watcher][tags] code=tags_write_failed')
  })
})

describe('createTagsStore — a name is unique within what one picker shows (T-24)', () => {
  it('a global tag clashes with a tag of the same name anywhere (trimmed, case-insensitive)', () => {
    const { store } = make()
    store.save({ ...ROW, workspaceId: 'wa' })
    expect(() => store.save({ ...ROW, name: ' PROD ' })).toThrow(TAG_ERROR.nameTaken)
  })

  it('a workspace tag clashes with a global one of the same name', () => {
    const { store } = make()
    store.save(ROW)
    expect(() => store.save({ ...ROW, workspaceId: 'wa' })).toThrow(TAG_ERROR.nameTaken)
  })

  it('the same name in two different workspaces is fine', () => {
    const { store } = make()
    store.save({ ...ROW, workspaceId: 'wa' })
    expect(() => store.save({ ...ROW, workspaceId: 'wb' })).not.toThrow()
  })

  it('the same name twice in one workspace clashes', () => {
    const { store } = make()
    store.save({ ...ROW, workspaceId: 'wa' })
    expect(() => store.save({ ...ROW, workspaceId: 'wa' })).toThrow(TAG_ERROR.nameTaken)
  })

  it('a row never clashes with itself', () => {
    const { store } = make()
    store.save(ROW)
    expect(() => store.save({ id: 'id-1', ...ROW, name: 'Prod' })).not.toThrow()
  })
})

describe('createTagsStore — a rule keeps what it points at (T-16, §1.4)', () => {
  it('refuses to delete a tag a rule uses, and keeps it', () => {
    const { store } = make(undefined, { refs: { 'id-1': [{ ruleWorkspaceId: null }] } })
    store.save(ROW)
    expect(() => store.remove('id-1')).toThrow(TAG_ERROR.inUse)
    expect(store.get('id-1')).not.toBeNull()
  })

  it('refuses to narrow a tag away from a rule in another workspace', () => {
    const { store } = make(undefined, { refs: { 'id-1': [{ ruleWorkspaceId: 'wb' }] } })
    store.save(ROW)
    expect(() => store.save({ id: 'id-1', ...ROW, workspaceId: 'wa' })).toThrow(TAG_ERROR.inUse)
    expect(store.get('id-1')?.workspaceId).toBeNull()
  })

  it('a GLOBAL rule cannot keep a tag it uses once the tag is scoped', () => {
    const { store } = make(undefined, { refs: { 'id-1': [{ ruleWorkspaceId: null }] } })
    store.save(ROW)
    expect(() => store.save({ id: 'id-1', ...ROW, workspaceId: 'wa' })).toThrow(TAG_ERROR.inUse)
  })

  it('allows narrowing to the one workspace whose rules use it', () => {
    const { store } = make(undefined, { refs: { 'id-1': [{ ruleWorkspaceId: 'wa' }] } })
    store.save(ROW)
    expect(store.save({ id: 'id-1', ...ROW, workspaceId: 'wa' }).saved.workspaceId).toBe('wa')
  })
})
