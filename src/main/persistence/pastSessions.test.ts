import { describe, it, expect, vi } from 'vitest'
import { createPastSessionsStore, type PastSessionsBlobStore } from './pastSessions'
import { createWorkspacesStore } from './workspaces'
import { PAST_SESSIONS_MAX, type PastSessionsFile } from '../../shared/schemas/pastSession'

const ROW = {
  id: 's1',
  name: 'billing api',
  cwd: '/home/op/work/api',
  workspaceId: 'default',
  tagIds: [] as string[],
  launchedAt: 100,
  endedAt: 200
}

function fakeBlob(seed?: unknown): {
  blobStore: PastSessionsBlobStore
  backups: () => number
  current: () => unknown
} {
  let blob: unknown = seed
  let backups = 0
  const blobStore: PastSessionsBlobStore = {
    read: () => blob,
    write: (value: PastSessionsFile) => {
      blob = value
    },
    backup: () => {
      backups++
    }
  }
  return { blobStore, backups: () => backups, current: () => blob }
}

describe('createPastSessionsStore — load', () => {
  it('fresh install: empty, writes the empty v1 file, logs nothing', () => {
    const fake = fakeBlob()
    const log = vi.fn()
    const store = createPastSessionsStore({ blobStore: fake.blobStore, log })
    expect(store.list()).toEqual([])
    expect(fake.current()).toEqual({ version: 1, sessions: [] })
    expect(log).not.toHaveBeenCalled()
  })
  it('corrupt file: backup + empty + code, and the log never carries a value', () => {
    const fake = fakeBlob({ version: 1, sessions: [{ ...ROW, cwd: '' }] })
    const log = vi.fn()
    const store = createPastSessionsStore({ blobStore: fake.blobStore, log })
    expect(store.list()).toEqual([])
    expect(fake.backups()).toBe(1)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain(
      '[claude-watcher][past-sessions] code=past_sessions_corrupt_reset_to_defaults'
    )
    for (const line of lines) {
      expect(line).not.toContain('/home/op')
      expect(line).not.toContain('billing api')
    }
  })
  it('UX-03: a record naming a missing workspace is HIDDEN, but kept in the file', () => {
    const fake = fakeBlob({
      version: 1,
      sessions: [ROW, { ...ROW, id: 's2', workspaceId: 'gone' }]
    })
    const log = vi.fn()
    const store = createPastSessionsStore({
      blobStore: fake.blobStore,
      log,
      workspaceExists: (id) => id === 'default'
    })
    expect(store.list().map((s) => s.id)).toEqual(['s1'])
    expect(store.get('s2')).toBeNull()
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][past-sessions] code=past_sessions_hidden_unknown_workspace count=1'
    )
    // The load-time write and every later one keep it (the file is what a restart reads).
    expect((fake.current() as PastSessionsFile).sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    store.archive({ ...ROW, id: 's3', endedAt: 999 })
    store.remove('s1')
    expect((fake.current() as PastSessionsFile).sessions.map((s) => s.id)).toEqual(['s3', 's2'])
  })
  it('UX-03: the hidden record comes back once its workspace does (a restored workspaces file)', () => {
    const fake = fakeBlob({ version: 1, sessions: [{ ...ROW, workspaceId: 'w1' }] })
    createPastSessionsStore({ blobStore: fake.blobStore, workspaceExists: () => false })
    const restored = createPastSessionsStore({
      blobStore: fake.blobStore,
      workspaceExists: () => true
    })
    expect(restored.list().map((s) => s.id)).toEqual(['s1'])
  })
  it('UX-01: a record still marked live on load is a crash leftover — it becomes a normal record', () => {
    const fake = fakeBlob({ version: 1, sessions: [{ ...ROW, live: true, endedAt: 555 }] })
    const log = vi.fn()
    const store = createPastSessionsStore({ blobStore: fake.blobStore, log })
    expect(store.list()).toEqual([{ ...ROW, endedAt: 555 }])
    expect((fake.current() as PastSessionsFile).sessions[0]).not.toHaveProperty('live')
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][past-sessions] code=past_sessions_recovered_live count=1'
    )
  })
})

describe('createPastSessionsStore — live records (UX-01, UX-02)', () => {
  it('a live record is written to the file but never listed', () => {
    const fake = fakeBlob()
    const store = createPastSessionsStore({ blobStore: fake.blobStore })
    store.markLive(ROW)
    expect(store.list()).toEqual([])
    expect((fake.current() as PastSessionsFile).sessions).toEqual([{ ...ROW, live: true }])
  })
  it('get still answers for a live record (Open then says already_open)', () => {
    const store = createPastSessionsStore()
    store.markLive(ROW)
    expect(store.get('s1')?.live).toBe(true)
  })
  it('archive overwrites the live record by id and ends it', () => {
    const store = createPastSessionsStore()
    store.markLive(ROW)
    store.archive({ ...ROW, endedAt: 900 })
    expect(store.list()).toEqual([{ ...ROW, endedAt: 900 }])
  })
  it('archive keeps the transcript path the live record learned', () => {
    const store = createPastSessionsStore()
    store.markLive({ ...ROW, transcriptPath: '/t/s1.jsonl' })
    store.archive(ROW)
    expect(store.get('s1')?.transcriptPath).toBe('/t/s1.jsonl')
  })
  it('the cap never evicts a live record', () => {
    const store = createPastSessionsStore()
    store.markLive({ ...ROW, id: 'running', endedAt: 0 })
    for (let i = 1; i <= PAST_SESSIONS_MAX + 1; i++) {
      store.archive({ ...ROW, id: `s${i}`, endedAt: i })
    }
    expect(store.get('running')).not.toBeNull()
    expect(store.list()).toHaveLength(PAST_SESSIONS_MAX)
  })
  it('dropLive removes a live record only — an archived one stays', () => {
    const store = createPastSessionsStore()
    store.markLive({ ...ROW, id: 'old' })
    store.archive(ROW)
    store.dropLive('old')
    store.dropLive('s1')
    expect(store.get('old')).toBeNull()
    expect(store.get('s1')).not.toBeNull()
  })
})

describe('createPastSessionsStore — archive / get / remove', () => {
  it('archive inserts, lists newest first, and persists', () => {
    const fake = fakeBlob()
    const store = createPastSessionsStore({ blobStore: fake.blobStore })
    store.archive(ROW)
    store.archive({ ...ROW, id: 's2', endedAt: 300 })
    expect(store.list().map((s) => s.id)).toEqual(['s2', 's1'])
    expect(store.get('s1')).toEqual(ROW)
    expect((fake.current() as PastSessionsFile).sessions.map((s) => s.id)).toEqual(['s2', 's1'])
  })
  it('archive OVERWRITES by id — a resumed session that ends again keeps one record', () => {
    const store = createPastSessionsStore()
    store.archive(ROW)
    store.archive({ ...ROW, name: 'renamed', endedAt: 900 })
    expect(store.list()).toHaveLength(1)
    expect(store.get('s1')?.name).toBe('renamed')
  })
  it('caps at PAST_SESSIONS_MAX, dropping the OLDEST by endedAt', () => {
    const store = createPastSessionsStore()
    for (let i = 0; i < PAST_SESSIONS_MAX + 1; i++) {
      store.archive({ ...ROW, id: `s${i}`, endedAt: i })
    }
    expect(store.list()).toHaveLength(PAST_SESSIONS_MAX)
    expect(store.get('s0')).toBeNull()
    expect(store.get(`s${PAST_SESSIONS_MAX}`)).not.toBeNull()
  })
  it('remove is idempotent and returns the remaining list', () => {
    const store = createPastSessionsStore()
    store.archive(ROW)
    expect(store.remove('s1')).toEqual([])
    expect(store.remove('s1')).toEqual([])
    expect(store.remove('never')).toEqual([])
  })
  it('removeByWorkspace cascades only that workspace and reports the count', () => {
    const store = createPastSessionsStore()
    store.archive(ROW)
    store.archive({ ...ROW, id: 's2', workspaceId: 'w1' })
    store.archive({ ...ROW, id: 's3', workspaceId: 'w1', endedAt: 5 })
    expect(store.removeByWorkspace('w1')).toBe(2)
    expect(store.list().map((s) => s.id)).toEqual(['s1'])
    expect(store.removeByWorkspace('w1')).toBe(0)
  })
  it('records are tied by workspace ID: a workspace rename changes nothing, a delete cascades', () => {
    const past = createPastSessionsStore()
    let n = 0
    const workspaces = createWorkspacesStore({
      newId: () => `w${++n}`,
      cascade: (id) => {
        past.removeByWorkspace(id)
      }
    })
    const { saved } = workspaces.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    past.archive({ ...ROW, workspaceId: saved.id })
    workspaces.save({ id: saved.id, name: 'Operations', color: 'blue', defaultCwd: null })
    expect(past.get('s1')?.workspaceId).toBe(saved.id)
    workspaces.remove(saved.id)
    expect(past.get('s1')).toBeNull()
  })
})
