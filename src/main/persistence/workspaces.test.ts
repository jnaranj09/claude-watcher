import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACES_FILE_VERSION,
  type WorkspacesFile
} from '../../shared/schemas/workspace'
import { WORKSPACE_ERROR, createWorkspacesStore, type WorkspacesBlobStore } from './workspaces'

/** A blob store over a mutable cell, so a test can seed a file and read back what was written. */
function fakeBlobStore(seed?: unknown): WorkspacesBlobStore & {
  written: () => WorkspacesFile | undefined
  backups: () => number
} {
  let cell = seed
  let written: WorkspacesFile | undefined
  let backups = 0
  return {
    read: () => cell,
    write: (value) => {
      written = value
      cell = value
    },
    backup: () => {
      backups += 1
    },
    written: () => written,
    backups: () => backups
  }
}

let ids: number
const newId = (): string => `w${++ids}`
beforeEach(() => {
  ids = 0
})

describe('createWorkspacesStore', () => {
  it('seeds Default on a fresh install and makes it active', () => {
    const store = createWorkspacesStore({ blobStore: fakeBlobStore(), newId })
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.id).toBe(DEFAULT_WORKSPACE_ID)
    expect(store.activeId()).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('backs up a corrupt file and re-seeds instead of crashing', () => {
    const blobStore = fakeBlobStore({ version: 99, nonsense: true })
    const log = vi.fn()
    const store = createWorkspacesStore({ blobStore, newId, log })
    expect(blobStore.backups()).toBe(1)
    expect(store.list()[0]?.id).toBe(DEFAULT_WORKSPACE_ID)
    // never-log-the-value: the log carries a code, not the blob
    for (const call of log.mock.calls) expect(String(call[0])).not.toContain('nonsense')
  })

  it('creates, sorts by name and rejects a duplicate name case-insensitively', () => {
    const store = createWorkspacesStore({ blobStore: fakeBlobStore(), newId })
    store.save({ name: 'Zeta', color: 'blue', defaultCwd: null })
    store.save({ name: 'Alpha', color: 'rose', defaultCwd: null })
    expect(store.list().map((w) => w.name)).toEqual(['Alpha', 'Default', 'Zeta'])
    expect(() => store.save({ name: 'alpha', color: 'blue', defaultCwd: null })).toThrow(
      WORKSPACE_ERROR.nameTaken
    )
  })

  it('updates an existing row and throws notFound on an unknown id', () => {
    const store = createWorkspacesStore({ blobStore: fakeBlobStore(), newId })
    const { saved } = store.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    const updated = store.save({ id: saved.id, name: 'Ops', color: 'green', defaultCwd: '/tmp' })
    expect(updated.saved.color).toBe('green')
    expect(updated.saved.defaultCwd).toBe('/tmp')
    expect(() => store.save({ id: 'nope', name: 'X', color: 'blue', defaultCwd: null })).toThrow(
      WORKSPACE_ERROR.notFound
    )
  })

  it('refuses to delete the Default workspace', () => {
    const store = createWorkspacesStore({ blobStore: fakeBlobStore(), newId })
    expect(() => store.remove(DEFAULT_WORKSPACE_ID)).toThrow(WORKSPACE_ERROR.defaultUndeletable)
  })

  it('refuses to delete a workspace that still has live sessions', () => {
    const store = createWorkspacesStore({
      blobStore: fakeBlobStore(),
      newId,
      hasLiveSessions: (id) => id === 'w1'
    })
    const { saved } = store.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(saved.id).toBe('w1')
    expect(() => store.remove('w1')).toThrow(WORKSPACE_ERROR.hasSessions)
    expect(store.list()).toHaveLength(2)
  })

  it('cascades into the scoped-config deleter and moves activeId off a deleted active workspace', () => {
    const cascade = vi.fn()
    const store = createWorkspacesStore({ blobStore: fakeBlobStore(), newId, cascade })
    const { saved } = store.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    store.setActive(saved.id)
    const after = store.remove(saved.id)
    expect(cascade).toHaveBeenCalledWith(saved.id)
    expect(after.activeId).toBe(DEFAULT_WORKSPACE_ID)
    expect(after.workspaces).toHaveLength(1)
  })

  it('does not cascade when the delete was refused', () => {
    const cascade = vi.fn()
    const store = createWorkspacesStore({
      blobStore: fakeBlobStore(),
      newId,
      cascade,
      hasLiveSessions: () => true
    })
    const { saved } = store.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(() => store.remove(saved.id)).toThrow(WORKSPACE_ERROR.hasSessions)
    expect(cascade).not.toHaveBeenCalled()
  })

  it('setActive throws notFound on an unknown id and persists a known one', () => {
    const blobStore = fakeBlobStore()
    const store = createWorkspacesStore({ blobStore, newId })
    const { saved } = store.save({ name: 'Ops', color: 'blue', defaultCwd: null })
    expect(() => store.setActive('nope')).toThrow(WORKSPACE_ERROR.notFound)
    expect(store.setActive(saved.id).activeId).toBe(saved.id)
    expect(blobStore.written()?.activeId).toBe(saved.id)
    expect(blobStore.written()?.version).toBe(WORKSPACES_FILE_VERSION)
  })

  it('falls back to Default when the persisted activeId names a missing workspace', () => {
    const store = createWorkspacesStore({
      blobStore: fakeBlobStore({
        version: WORKSPACES_FILE_VERSION,
        activeId: 'ghost',
        workspaces: [
          { id: DEFAULT_WORKSPACE_ID, name: 'Default', color: 'slate', defaultCwd: null }
        ]
      }),
      newId
    })
    expect(store.activeId()).toBe(DEFAULT_WORKSPACE_ID)
  })

  it('re-seeds Default when a hand-edited file dropped it', () => {
    const store = createWorkspacesStore({
      blobStore: fakeBlobStore({
        version: WORKSPACES_FILE_VERSION,
        activeId: 'w9',
        workspaces: [{ id: 'w9', name: 'Only', color: 'blue', defaultCwd: null }]
      }),
      newId
    })
    expect(store.get(DEFAULT_WORKSPACE_ID)).not.toBeNull()
    expect(store.activeId()).toBe('w9')
  })
})
