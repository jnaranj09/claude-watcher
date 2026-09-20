// Custom themes — the renderer PROJECTION of the applied ThemeBundle (state.md: main is truth;
// this is replaced wholesale on every `theme:applied` push, never edited here). Terminals read
// `bundle.terminal` through a narrow selector and apply it imperatively (terminal.md).
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  DEFAULT_THEME_BUNDLE,
  type ThemeBundle,
  type ThemeTerminal
} from '../../../shared/schemas/theme'

export interface ThemeState {
  bundle: ThemeBundle
  setBundle: (bundle: ThemeBundle) => void
}
export type ThemeStoreApi = StoreApi<ThemeState>

export function createThemeStore(): ThemeStoreApi {
  return createStore<ThemeState>((set) => ({
    bundle: DEFAULT_THEME_BUNDLE,
    setBundle: (bundle) => set({ bundle })
  }))
}

export const themeStore = createThemeStore()

export function useTheme<T>(selector: (state: ThemeState) => T): T {
  return useStore(themeStore, selector)
}

export const selectThemeBundle = (s: ThemeState): ThemeBundle => s.bundle
/** The same object reference until the next push — safe without useShallow. */
export const selectThemeTerminal = (s: ThemeState): ThemeTerminal => s.bundle.terminal
export const selectAppliedThemeId = (s: ThemeState): string => s.bundle.id
