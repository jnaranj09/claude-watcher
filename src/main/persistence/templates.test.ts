import { STORE_WRITE_FAILED } from '../../shared/schemas/storageHealth'
import { describe, it, expect, vi } from 'vitest'
import { createTemplatesStore, TEMPLATE_ERROR, type TemplatesBlobStore } from './templates'
import { EFFORT_LEVELS, type TemplatesFile } from '../../shared/schemas/template'

const ROW = {
  name: 'work api',
  cwd: '/home/op/work/api',
  model: 'opus',
  permissionMode: 'acceptEdits' as const,
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: []
}

function fakeBlob(
  seed: unknown,
  opts: { writeThrows?: boolean } = {}
): {
  blobStore: TemplatesBlobStore
  writes: TemplatesFile[]
  backups: () => number
  current: () => unknown
} {
  let blob: unknown = seed
  const writes: TemplatesFile[] = []
  let backups = 0
  const blobStore: TemplatesBlobStore = {
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
  opts: { writeThrows?: boolean } = {}
): {
  store: ReturnType<typeof createTemplatesStore>
  fake: ReturnType<typeof fakeBlob>
  log: ReturnType<typeof vi.fn>
} {
  const fake = fakeBlob(seed, opts)
  const log = vi.fn()
  let n = 0
  const store = createTemplatesStore({ blobStore: fake.blobStore, log, newId: () => `id-${++n}` })
  return { store, fake, log }
}

describe('createTemplatesStore — load', () => {
  it('fresh install: empty list, writes the empty v1 file, logs nothing', () => {
    const { store, fake, log } = make()
    expect(store.list()).toEqual([])
    expect(fake.writes).toEqual([{ version: 1, templates: [] }])
    expect(log).not.toHaveBeenCalled()
  })
  it('healthy file: loads rows and lists them sorted by name, case-insensitive', () => {
    const { store } = make({
      version: 1,
      templates: [
        { id: 'b', ...ROW, name: 'zeta' },
        { id: 'a', ...ROW, name: 'Alpha' },
        { id: 'c', ...ROW, name: 'beta' }
      ]
    })
    expect(store.list().map((t) => t.name)).toEqual(['Alpha', 'beta', 'zeta'])
  })
  it('corrupt file: backup + empty + code, and the log never carries a value', () => {
    const { store, fake, log } = make({ version: 1, templates: [{ id: 'x', ...ROW, cwd: '' }] })
    expect(store.list()).toEqual([])
    expect(fake.backups()).toBe(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[claude-watcher][templates] code=templates_corrupt_reset_to_defaults')
    for (const line of lines) {
      expect(line).not.toContain('/home/op')
      expect(line).not.toContain('work api')
    }
  })
  // A file written BEFORE the effort field existed has no `effort` key. It MUST load, not be
  // backed up and reset — a reset here deletes every template the operator ever saved. The
  // guard is `.default(null)` on TemplateSchema.effort; reverting it turns this red.
  it('loads a PRE-CHANGE file (rows with no effort key) without backing it up', () => {
    const preChange = {
      id: 'x',
      name: 'work api',
      cwd: '/home/op/work/api',
      model: 'opus',
      permissionMode: 'acceptEdits'
    }
    const { store, fake, log } = make({ version: 1, templates: [preChange] })
    expect(store.list()).toEqual([
      { ...preChange, effort: null, workspaceId: null, initialPrompt: null, params: [] }
    ])
    expect(fake.backups()).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('createTemplatesStore — save / get / remove', () => {
  it('create mints an id, returns the saved row + the sorted list, persists', () => {
    const { store, fake } = make()
    const out = store.save(ROW)
    expect(out.saved).toEqual({ id: 'id-1', ...ROW })
    expect(out.templates).toEqual([out.saved])
    expect(store.get('id-1')).toEqual(out.saved)
    expect(fake.current()).toEqual({ version: 1, templates: [out.saved] })
  })
  it('update keeps the id and replaces the fields', () => {
    const { store } = make()
    store.save(ROW)
    const out = store.save({ id: 'id-1', ...ROW, name: 'renamed', model: null })
    expect(out.saved).toEqual({ id: 'id-1', ...ROW, name: 'renamed', model: null })
    expect(store.list()).toHaveLength(1)
  })
  it('update with an unknown id throws template_not_found and changes nothing', () => {
    const { store } = make()
    expect(() => store.save({ id: 'ghost', ...ROW })).toThrow(TEMPLATE_ERROR.notFound)
    expect(store.list()).toEqual([])
  })
  it('a duplicate name (trimmed, case-insensitive) throws template_name_taken — except for the row itself', () => {
    const { store } = make()
    store.save(ROW)
    expect(() => store.save({ ...ROW, name: '  WORK API ' })).toThrow(TEMPLATE_ERROR.nameTaken)
    expect(() => store.save({ id: 'id-1', ...ROW, name: 'Work API' })).not.toThrow()
    expect(store.list()).toHaveLength(1)
  })
  it('remove drops the row and returns the list; an unknown id is a no-op that does not write', () => {
    const { store, fake } = make()
    store.save(ROW)
    const before = fake.writes.length
    expect(store.remove('id-1')).toEqual([])
    expect(store.get('id-1')).toBeNull()
    expect(store.remove('id-1')).toEqual([])
    expect(fake.writes.length).toBe(before + 1)
  })
  it('round-trips every effort level', () => {
    for (const level of EFFORT_LEVELS) {
      const { store } = make()
      const out = store.save({ ...ROW, effort: level })
      expect(out.saved.effort).toBe(level)
      expect(store.get(out.saved.id)?.effort).toBe(level)
    }
  })
  it('save persists the initial prompt and its params', () => {
    const { store } = make()
    const params = [{ label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 20 }]
    const out = store.save({ ...ROW, initialPrompt: 'Work on $1', params })
    expect(store.get(out.saved.id)).toMatchObject({ initialPrompt: 'Work on $1', params })
  })
  it('UX-06: a failed write undoes the save, throws store_write_failed, and logs templates_write_failed', () => {
    const { store, log } = make(undefined, { writeThrows: true })
    expect(() => store.save(ROW)).toThrow(STORE_WRITE_FAILED)
    expect(store.list()).toEqual([])
    expect(log).toHaveBeenCalledWith('[claude-watcher][templates] code=templates_write_failed')
  })

  // Workspaces (Task 6) — the cascade calls this AFTER a delete is already committed. Global
  // rows (workspaceId: null) must survive untouched.
  it('removeByWorkspace deletes only that workspace rows and returns the count', () => {
    const { store, fake } = make()
    store.save({ ...ROW, name: 'G', workspaceId: null })
    store.save({ ...ROW, name: 'A', workspaceId: 'w1' })
    store.save({ ...ROW, name: 'B', workspaceId: 'w2' })
    const before = fake.writes.length
    expect(store.removeByWorkspace('w1')).toBe(1)
    expect(store.list().map((t) => t.name)).toEqual(['B', 'G'])
    // Fix round 1, Finding 2 — a removal that is never PERSISTED comes back on the next boot,
    // resurrected under a workspace that no longer exists. Deleting the persist() call inside
    // removeByWorkspace must turn this red.
    expect(fake.writes.length).toBe(before + 1)
    expect(fake.current()).toEqual({
      version: 1,
      templates: store.list()
    })
  })

  // T-17 — no rule is ever silently changed by a delete.
  it('refuses to delete a template a rule uses, and keeps it', () => {
    const fake = fakeBlob(undefined)
    const store = createTemplatesStore({
      blobStore: fake.blobStore,
      newId: () => 'id-1',
      ruleRefCount: (id) => (id === 'id-1' ? 2 : 0)
    })
    store.save(ROW)
    expect(() => store.remove('id-1')).toThrow(TEMPLATE_ERROR.inUse)
    expect(store.get('id-1')).not.toBeNull()
  })
})

// §1.4 / T-17 — a scope change never hides a template from a rule that uses it: the same injected
// check the tags store runs for T-16. Widening, or narrowing into the rules' own workspace, is fine.
describe('createTemplatesStore — a scope change never hides a template from a rule', () => {
  function usedBy(
    refs: { ruleWorkspaceId: string | null }[],
    workspaceId: string | null
  ): { store: ReturnType<typeof createTemplatesStore>; fake: ReturnType<typeof fakeBlob> } {
    const fake = fakeBlob(undefined)
    const store = createTemplatesStore({
      blobStore: fake.blobStore,
      newId: () => 'id-1',
      ruleRefs: (id) => (id === 'id-1' ? refs : [])
    })
    store.save({ ...ROW, workspaceId })
    return { store, fake }
  }

  it('refuses global → workspace while a global rule uses it, and writes nothing', () => {
    const { store, fake } = usedBy([{ ruleWorkspaceId: null }], null)
    const writes = fake.writes.length
    expect(() => store.save({ id: 'id-1', ...ROW, workspaceId: 'w1' })).toThrow(
      TEMPLATE_ERROR.inUse
    )
    expect(store.get('id-1')?.workspaceId).toBeNull()
    expect(fake.writes.length).toBe(writes)
  })

  it('refuses workspace A → B while a rule in A uses it', () => {
    const { store } = usedBy([{ ruleWorkspaceId: 'w1' }], 'w1')
    expect(() => store.save({ id: 'id-1', ...ROW, workspaceId: 'w2' })).toThrow(
      TEMPLATE_ERROR.inUse
    )
    expect(store.get('id-1')?.workspaceId).toBe('w1')
  })

  it('allows widening a used template to global', () => {
    const { store } = usedBy([{ ruleWorkspaceId: 'w1' }], 'w1')
    expect(store.save({ id: 'id-1', ...ROW, workspaceId: null }).saved.workspaceId).toBeNull()
  })

  it('allows narrowing into the workspace of the rule that uses it', () => {
    const { store } = usedBy([{ ruleWorkspaceId: 'w1' }], null)
    expect(store.save({ id: 'id-1', ...ROW, workspaceId: 'w1' }).saved.workspaceId).toBe('w1')
  })
})
