import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  shortcutsStore,
  loadShortcuts,
  saveShortcut,
  removeShortcut,
  setShortcutFavorite,
  selectShortcuts,
  selectShortcutsLoaded,
  makeSelectVisibleShortcuts
} from './shortcutsStore'

const A = {
  id: 'sc-1',
  name: 'approve',
  alias: 'ap',
  text: 'I explicitly approve',
  workspaceId: null,
  favorite: false
}

beforeEach(() => {
  shortcutsStore.setState({ shortcuts: [], loaded: false })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function fakeBridge(
  over: Partial<Record<'list' | 'save' | 'remove' | 'setFavorite', unknown>> = {}
): void {
  ;(window as unknown as { shortcuts: unknown }).shortcuts = {
    list: vi.fn(() => Promise.resolve([A])),
    save: vi.fn(() => Promise.resolve({ saved: A, shortcuts: [A] })),
    remove: vi.fn(() => Promise.resolve([])),
    ...over
  }
}

describe('makeSelectVisibleShortcuts', () => {
  const GLOBAL = { ...A, id: 'g', workspaceId: null }
  const OWN = { ...A, id: 'own', workspaceId: 'w1' }
  const OTHER = { ...A, id: 'other', workspaceId: 'w2' }
  const ORPHAN = { ...A, id: 'orphan', workspaceId: 'gone' }

  it('keeps global rows and the active workspace’s own rows; drops every other scope', () => {
    shortcutsStore.setState({ shortcuts: [GLOBAL, OWN, OTHER, ORPHAN], loaded: true })
    const visible = makeSelectVisibleShortcuts('w1')(shortcutsStore.getState())
    expect(visible.map((s) => s.id)).toEqual(['g', 'own'])
  })

  it('a row scoped to a workspace that no longer exists is visible in NO workspace', () => {
    shortcutsStore.setState({ shortcuts: [ORPHAN], loaded: true })
    expect(makeSelectVisibleShortcuts('w1')(shortcutsStore.getState())).toEqual([])
    expect(makeSelectVisibleShortcuts('w9')(shortcutsStore.getState())).toEqual([])
  })
})

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
      alias: A.alias,
      text: A.text,
      workspaceId: null
    })
    expect(saved).toEqual(A)
    expect(selectShortcuts(shortcutsStore.getState())).toEqual([A])
  })

  it('RETHROWS a save failure so the form can render the error code', async () => {
    fakeBridge({ save: vi.fn(() => Promise.reject(new Error('shortcut_alias_taken'))) })
    await expect(
      saveShortcut({ name: 'x', alias: 'ap', text: 'y', workspaceId: null })
    ).rejects.toThrow('shortcut_alias_taken')
  })

  it('logs a remove failure by code and RETHROWS it for the dialog', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    shortcutsStore.setState({ shortcuts: [A], loaded: true })
    fakeBridge({ remove: vi.fn(() => Promise.reject(new Error('boom'))) })
    await expect(removeShortcut('sc-1')).rejects.toThrow('boom')
    expect(warn).toHaveBeenCalledWith('[claude-watcher][shortcuts] code=shortcuts_remove_failed')
  })
})

describe('shortcutsStore — favorites', () => {
  it('setShortcutFavorite replaces the projection with main answer', async () => {
    const setFavorite = vi.fn(() => Promise.resolve([{ ...A, favorite: true }]))
    fakeBridge({ setFavorite })
    shortcutsStore.setState({ shortcuts: [A], loaded: true })
    await setShortcutFavorite('sc-1', true)
    expect(setFavorite).toHaveBeenCalledWith('sc-1', true)
    expect(shortcutsStore.getState().shortcuts[0]?.favorite).toBe(true)
  })
  it('setShortcutFavorite logs a code, rethrows and keeps the projection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeBridge({ setFavorite: vi.fn(() => Promise.reject(new Error('store_write_failed'))) })
    shortcutsStore.setState({ shortcuts: [A], loaded: true })
    await expect(setShortcutFavorite('sc-1', true)).rejects.toThrow('store_write_failed')
    expect(shortcutsStore.getState().shortcuts[0]?.favorite).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      '[claude-watcher][shortcuts] code=shortcuts_set_favorite_failed'
    )
  })
})
