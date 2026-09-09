import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  shortcutsStore,
  loadShortcuts,
  saveShortcut,
  removeShortcut,
  selectShortcuts,
  selectShortcutsLoaded
} from './shortcutsStore'

const A = {
  id: 'sc-1',
  name: 'approve',
  keys: ['Ctrl+Alt+A'],
  text: 'I explicitly approve',
  workspaceId: null
}

beforeEach(() => {
  shortcutsStore.setState({ shortcuts: [], loaded: false })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function fakeBridge(over: Partial<Record<'list' | 'save' | 'remove', unknown>> = {}): void {
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([A])),
    save: vi.fn(() => Promise.resolve({ saved: A, shortcuts: [A] })),
    remove: vi.fn(() => Promise.resolve([])),
    ...over
  }
}

describe('shortcutsStore', () => {
  it('hydrates from the bridge on load', async () => {
    fakeBridge()
    await loadShortcuts()
    expect(selectShortcuts(shortcutsStore.getState())).toEqual([A])
    expect(selectShortcutsLoaded(shortcutsStore.getState())).toBe(true)
  })

  it('logs a code and leaves the store empty when load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeBridge({ list: vi.fn(() => Promise.reject(new Error('boom'))) })
    await loadShortcuts()
    expect(selectShortcuts(shortcutsStore.getState())).toEqual([])
    expect(warn).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_load_failed')
  })

  it('replaces the projection wholesale on save and returns the saved row', async () => {
    fakeBridge()
    const saved = await saveShortcut({
      name: A.name,
      keys: A.keys,
      text: A.text,
      workspaceId: null
    })
    expect(saved).toEqual(A)
    expect(selectShortcuts(shortcutsStore.getState())).toEqual([A])
  })

  it('RETHROWS a save failure so the form can render the error code', async () => {
    fakeBridge({ save: vi.fn(() => Promise.reject(new Error('shortcut_keys_taken'))) })
    await expect(
      saveShortcut({ name: 'x', keys: ['Ctrl+Alt+A'], text: 'y', workspaceId: null })
    ).rejects.toThrow('shortcut_keys_taken')
  })

  it('swallows a remove failure with a code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    shortcutsStore.setState({ shortcuts: [A], loaded: true })
    fakeBridge({ remove: vi.fn(() => Promise.reject(new Error('boom'))) })
    await removeShortcut('sc-1')
    expect(warn).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_remove_failed')
  })
})
