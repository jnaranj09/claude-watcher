import { describe, it, expect, vi } from 'vitest'
import { createShortcutsStore, SHORTCUT_ERROR, type ShortcutsBlobStore } from './shortcuts'
import type { ShortcutsFile } from '../../shared/schemas/shortcut'

function fakeBlobStore(initial?: unknown): ShortcutsBlobStore & {
  written: ShortcutsFile[]
  backups: number
} {
  const written: ShortcutsFile[] = []
  let backups = 0
  return {
    written,
    get backups() {
      return backups
    },
    read: () => initial,
    write: (value: ShortcutsFile) => void written.push(value),
    backup: () => void backups++
  }
}

const A = { name: 'approve', alias: 'ap', text: 'I explicitly approve', workspaceId: null }
const B = { name: 'go on', alias: 'go', text: 'continue', workspaceId: null }

function idSeq(): () => string {
  let n = 0
  return () => `sc-${++n}`
}

describe('createShortcutsStore', () => {
  it('starts empty when there is no file', () => {
    expect(createShortcutsStore({ newId: idSeq() }).list()).toEqual([])
  })

  it('create mints an id and returns the saved row plus the list', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    const result = store.save(A)
    expect(result.saved).toEqual({ id: 'sc-1', ...A })
    expect(result.shortcuts).toEqual([{ id: 'sc-1', ...A }])
    expect(store.get('sc-1')).toEqual({ id: 'sc-1', ...A })
  })

  it('update keeps the id', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    const result = store.save({ id: 'sc-1', ...A, text: 'approved' })
    expect(result.saved.id).toBe('sc-1')
    expect(result.shortcuts).toHaveLength(1)
    expect(result.saved.text).toBe('approved')
  })

  it('throws not_found when updating an unknown id', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    expect(() => store.save({ id: 'nope', ...A })).toThrow(SHORTCUT_ERROR.notFound)
  })

  it('throws alias_taken when another row already holds the alias', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save(B)).not.toThrow()
    expect(() => store.save({ ...B, alias: 'ap' })).toThrow(SHORTCUT_ERROR.aliasTaken)
  })

  it('an update keeping its OWN alias is not a collision', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save({ id: 'sc-1', ...A, text: 'changed' })).not.toThrow()
  })

  it('allows two shortcuts to share a name (uniqueness is on the alias only)', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save({ ...B, name: A.name })).not.toThrow()
  })

  it('lists sorted by alias', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save({ ...A, alias: 'zz' })
    store.save({ ...B, alias: 'aa' })
    expect(store.list().map((s) => s.alias)).toEqual(['aa', 'zz'])
  })

  it('remove is idempotent for an unknown id', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(store.remove('nope')).toHaveLength(1)
    expect(store.remove('sc-1')).toEqual([])
  })

  it('hydrates from a healthy file', () => {
    const file = { version: 3, shortcuts: [{ id: 'sc-9', ...A }] }
    const store = createShortcutsStore({ blobStore: fakeBlobStore(file), newId: idSeq() })
    expect(store.get('sc-9')).toEqual({ id: 'sc-9', ...A })
  })

  it('loads a v2 file through the migration and persists it as v3', () => {
    const blob = fakeBlobStore({
      version: 2,
      shortcuts: [
        {
          id: 'old-1',
          name: 'approve',
          keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
          text: 'I explicitly approve',
          workspaceId: null
        }
      ]
    })
    const store = createShortcutsStore({ blobStore: blob, newId: idSeq() })
    expect(store.list()).toEqual([
      { id: 'old-1', name: 'approve', alias: 'oa', text: 'I explicitly approve', workspaceId: null }
    ])
    expect(blob.written[0]?.version).toBe(3)
    expect(blob.backups).toBe(0)
  })

  it('backs up + resets to empty on a corrupt file, logging a CODE only', () => {
    const log = vi.fn()
    const blob = fakeBlobStore({ version: 2, shortcuts: [{ id: 'x', keys: ['nope'] }] })
    const store = createShortcutsStore({ blobStore: blob, log, newId: idSeq() })
    expect(store.list()).toEqual([])
    expect(blob.backups).toBe(1)
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][shortcuts] code=shortcuts_corrupt_reset_to_defaults'
    )
  })

  it('logs a code and keeps memory when the write fails', () => {
    const log = vi.fn()
    const blob: ShortcutsBlobStore = {
      read: () => undefined,
      write: () => {
        throw new Error('disk full')
      },
      backup: () => {}
    }
    const store = createShortcutsStore({ blobStore: blob, log, newId: idSeq() })
    store.save(A)
    expect(store.list()).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_write_failed')
  })

  // Workspaces (Task 6) — the cascade calls this AFTER a delete is already committed. Global
  // rows (workspaceId: null) must survive untouched.
  it('removeByWorkspace deletes only that workspace rows and returns the count', () => {
    const blob = fakeBlobStore()
    const store = createShortcutsStore({ blobStore: blob, newId: idSeq() })
    store.save({ name: 'glob', alias: 'gl', text: 'global', workspaceId: null })
    store.save({ name: 'one', alias: 'on', text: 'one', workspaceId: 'w1' })
    store.save({ name: 'two', alias: 'tw', text: 'two', workspaceId: 'w2' })
    const before = blob.written.length
    expect(store.removeByWorkspace('w1')).toBe(1)
    expect(store.list().map((s) => s.name)).toEqual(['glob', 'two'])
    // Fix round 1, Finding 2 — a removal that is never PERSISTED comes back on the next boot,
    // resurrected under a workspace that no longer exists. Deleting the persist() call inside
    // removeByWorkspace must turn this red.
    expect(blob.written.length).toBe(before + 1)
    expect(blob.written.at(-1)).toEqual({ version: 3, shortcuts: store.list() })
  })

  it('NEVER logs a shortcut value (name or text) on any path', () => {
    const log = vi.fn()
    const blob = fakeBlobStore({
      version: 2,
      shortcuts: [{ id: 'x', name: 'SECRETNAME', text: 'SECRETTEXT' }]
    })
    createShortcutsStore({ blobStore: blob, log, newId: idSeq() })
    expect(log).toHaveBeenCalled()
    for (const call of log.mock.calls) {
      const line = String(call[0])
      expect(line).not.toContain('SECRETNAME')
      expect(line).not.toContain('SECRETTEXT')
    }
  })
})
