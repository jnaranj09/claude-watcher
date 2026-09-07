// Phrase shortcuts — the renderer PROJECTION of main's shortcuts store (state.md: main is truth;
// this is a hydrated copy, replaced wholesale from every IPC result — no client merge).
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Shortcut, ShortcutSaveRequest } from '../../../shared/ipc/contract'

export interface ShortcutsState {
  shortcuts: Shortcut[]
  loaded: boolean
  hydrate: (shortcuts: Shortcut[]) => void
}
export type ShortcutsStoreApi = StoreApi<ShortcutsState>

export function createShortcutsStore(): ShortcutsStoreApi {
  return createStore<ShortcutsState>((set) => ({
    shortcuts: [],
    loaded: false,
    hydrate: (shortcuts) => set({ shortcuts, loaded: true })
  }))
}

export const selectShortcuts = (state: ShortcutsState): Shortcut[] => state.shortcuts
export const selectShortcutsLoaded = (state: ShortcutsState): boolean => state.loaded

export const shortcutsStore = createShortcutsStore()

export function useShortcuts<T>(selector: (state: ShortcutsState) => T): T {
  return useStore(shortcutsStore, selector)
}

const LOG_PREFIX = '[claude-watcher][shortcuts]'

export async function loadShortcuts(): Promise<void> {
  try {
    shortcutsStore.getState().hydrate(await window.shortcuts.list())
  } catch {
    console.warn(`${LOG_PREFIX} code=shortcuts_load_failed`)
  }
}

/** Rethrows: the Shortcuts form maps `shortcut_keys_taken` etc. to copy. */
export async function saveShortcut(req: ShortcutSaveRequest): Promise<Shortcut> {
  const result = await window.shortcuts.save(req)
  shortcutsStore.getState().hydrate(result.shortcuts)
  return result.saved
}

export async function removeShortcut(id: string): Promise<void> {
  try {
    shortcutsStore.getState().hydrate(await window.shortcuts.remove(id))
  } catch {
    console.warn(`${LOG_PREFIX} code=shortcuts_remove_failed`)
  }
}
