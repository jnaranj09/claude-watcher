import { describe, it, expect, vi } from 'vitest'
import { createShortcutsStore, SHORTCUT_ERROR, type ShortcutsBlobStore } from './shortcuts'
import { shortcutKeysId, type ShortcutsFile } from '../../shared/schemas/shortcut'

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

const A = { name: 'approve', keys: ['Ctrl+Alt+A'], text: 'I explicitly approve', workspaceId: null }
const B = { name: 'go on', keys: ['Ctrl+Alt+G'], text: 'continue', workspaceId: null }

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

  it('throws keys_taken when another row already holds the chord', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save(B)).not.toThrow()
    expect(() => store.save({ ...B, name: 'dup', keys: ['Ctrl+Alt+A'] })).toThrow(
      SHORTCUT_ERROR.keysTaken
    )
  })

  it("does NOT report keys_taken against the row's own chord", () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save({ id: 'sc-1', ...A, name: 'renamed' })).not.toThrow()
  })

  it('allows two shortcuts to share a name (uniqueness is on the chord only)', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(() => store.save({ ...B, name: A.name })).not.toThrow()
  })

  it('lists sorted by chord', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(B) // Ctrl+Alt+G
    store.save(A) // Ctrl+Alt+A
    expect(store.list().map((s) => shortcutKeysId(s.keys))).toEqual(['Ctrl+Alt+A', 'Ctrl+Alt+G'])
  })

  it('throws keys_taken for a duplicate FULL sequence', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save({
      name: 'one',
      keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
      text: 'first',
      workspaceId: null
    })
    expect(() =>
      store.save({
        name: 'two',
        keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
        text: 'second',
        workspaceId: null
      })
    ).toThrow(SHORTCUT_ERROR.keysTaken)
  })

  // The operator's explicit requirement: a prefix and its extension are DIFFERENT bindings and
  // must coexist. Making isKeysTaken compare prefixes must turn this red.
  it('lets a PREFIX coexist with the sequence it prefixes', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save({
      name: 'long',
      keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
      text: 'long phrase',
      workspaceId: null
    })
    expect(() =>
      store.save({ name: 'short', keys: ['Ctrl+Alt+O'], text: 'short phrase', workspaceId: null })
    ).not.toThrow()
    expect(store.list()).toHaveLength(2)
  })

  it('sorts by the canonical sequence id, so a prefix sorts before its extensions', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save({
      name: 'long',
      keys: ['Ctrl+Alt+O', 'Ctrl+Alt+A'],
      text: 'long',
      workspaceId: null
    })
    store.save({ name: 'short', keys: ['Ctrl+Alt+O'], text: 'short', workspaceId: null })
    store.save({ name: 'other', keys: ['Ctrl+Alt+B'], text: 'other', workspaceId: null })
    expect(store.list().map((s) => shortcutKeysId(s.keys))).toEqual([
      'Ctrl+Alt+B',
      'Ctrl+Alt+O',
      'Ctrl+Alt+O Ctrl+Alt+A'
    ])
  })

  it('remove is idempotent for an unknown id', () => {
    const store = createShortcutsStore({ newId: idSeq() })
    store.save(A)
    expect(store.remove('nope')).toHaveLength(1)
    expect(store.remove('sc-1')).toEqual([])
  })

  it('hydrates from a healthy file', () => {
    const file = { version: 2, shortcuts: [{ id: 'sc-9', ...A }] }
    const store = createShortcutsStore({ blobStore: fakeBlobStore(file), newId: idSeq() })
    expect(store.get('sc-9')).toEqual({ id: 'sc-9', ...A })
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
    const store = createShortcutsStore({ newId: idSeq() })
    store.save({ name: 'glob', keys: ['Ctrl+Alt+A'], text: 'global', workspaceId: null })
    store.save({ name: 'one', keys: ['Ctrl+Alt+B'], text: 'one', workspaceId: 'w1' })
    store.save({ name: 'two', keys: ['Ctrl+Alt+C'], text: 'two', workspaceId: 'w2' })
    expect(store.removeByWorkspace('w1')).toBe(1)
    expect(store.list().map((s) => s.name)).toEqual(['glob', 'two'])
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
