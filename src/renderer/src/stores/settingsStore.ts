// Story 2.4 — the renderer settings store (RENDERER VIEW-STATE).
//
// Settings are renderer view-state per .claude/rules/state.md — a small Zustand store with
// narrow selectors, NOT session truth and NOT denormalized. The AUTHORITY for the persisted
// value is MAIN (electron-store); this store is a PROJECTION the renderer reads at startup
// (via window.settings.get()) and writes back through window.settings.set(...). It is kept
// SEPARATE from the board store so the board store stays focused on the session projection.
//
// Live application: components subscribe to narrow slices (`soundEnabled` / `terminalFontSize`)
// so a change takes effect IMMEDIATELY in the running session (AC-5). The sound wiring reads
// the live `soundEnabled` flag off this store on each `attention.raised` (AC-1/3). Settings
// have NO time dimension — no now()/clock is injected (unlike the board store).
// [Source: story 2.4 Task 5; AC-3/4/5; .claude/rules/state.md; src/renderer/src/stores/
//  boardStore.ts (factory + narrow-selector conventions)]
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Settings, SettingsPatch } from '../../../shared/ipc/contract'
// DEFAULT_SETTINGS is a runtime VALUE (the fresh-start defaults) — it lives in the shared
// schema (pure Zod, importable by both sides). The contract re-exports only the payload TYPES.
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'

export interface SettingsState {
  /** The live sound toggle (default ON — UX-DR26). The sole governor of sound frequency. */
  soundEnabled: boolean
  /** The live terminal font-size (px). Persisted now; Epic-3's terminal consumes it (F5). */
  terminalFontSize: number
  /** Whether the initial load from main has completed (until then the defaults are shown). */
  loaded: boolean
  /** Replace the whole projection from a main-sourced `Settings` (used on startup load). */
  hydrate: (settings: Settings) => void
  /** Apply a partial patch OPTIMISTICALLY to the projection (immediate effect). The caller
   *  also persists via window.settings.set(...); the returned authoritative value re-hydrates. */
  applyPatch: (patch: SettingsPatch) => void
}

/** A Zustand vanilla store over `SettingsState`. */
export type SettingsStoreApi = StoreApi<SettingsState>

/**
 * Build a fresh settings store. Exported as a FACTORY so tests get an isolated instance; the
 * app uses the singleton `settingsStore` / `useSettings` below. Defaults mirror DEFAULT_SETTINGS
 * (sound ON) so the pre-load UI is sane.
 */
export function createSettingsStore(): SettingsStoreApi {
  return createStore<SettingsState>((set) => ({
    soundEnabled: DEFAULT_SETTINGS.soundEnabled,
    terminalFontSize: DEFAULT_SETTINGS.terminalFontSize,
    loaded: false,

    hydrate: (settings) => {
      set({
        soundEnabled: settings.soundEnabled,
        terminalFontSize: settings.terminalFontSize,
        loaded: true
      })
    },

    applyPatch: (patch) => {
      // Optimistic, immediate projection update (AC-5). Only set the fields the patch carries.
      set({
        ...(patch.soundEnabled !== undefined ? { soundEnabled: patch.soundEnabled } : {}),
        ...(patch.terminalFontSize !== undefined
          ? { terminalFontSize: patch.terminalFontSize }
          : {})
      })
    }
  }))
}

// ---------------------------------------------------------------------------
// Selectors (NARROW, primitive — state.md). Components subscribe to the smallest slice.
// ---------------------------------------------------------------------------

/** The live sound toggle (primitive — safe without useShallow). */
export const selectSoundEnabled = (state: SettingsState): boolean => state.soundEnabled
/** The live terminal font-size (primitive). */
export const selectTerminalFontSize = (state: SettingsState): number => state.terminalFontSize
/** Whether the initial load has completed (primitive). */
export const selectLoaded = (state: SettingsState): boolean => state.loaded

// ---------------------------------------------------------------------------
// The app singleton store + bound hook. Tests use `createSettingsStore()` directly.
// ---------------------------------------------------------------------------

/** The app's singleton settings store. */
export const settingsStore = createSettingsStore()

/** Bind a narrow selector to the singleton store. For PRIMITIVE selectors. */
export function useSettings<T>(selector: (state: SettingsState) => T): T {
  return useStore(settingsStore, selector)
}

/**
 * Persist a settings patch through main and re-hydrate the projection with the authoritative
 * value. Applies the patch OPTIMISTICALLY first (immediate UI effect, AC-5), then awaits the
 * main round-trip; on success re-hydrates with the validated value, on failure logs a code and
 * leaves the optimistic value (a transient mismatch self-heals on the next get). NEVER throws.
 *
 * Exported so the Settings UI binds its controls to ONE persistence entry point (no duplicated
 * window.settings.set call sites). Uses the singleton store + the real window.settings bridge.
 */
export async function persistSettingsPatch(patch: SettingsPatch): Promise<void> {
  settingsStore.getState().applyPatch(patch)
  try {
    const authoritative = await window.settings.set(patch)
    settingsStore.getState().hydrate(authoritative)
  } catch {
    // Never log the value (Guardrail #6); the optimistic value already took effect in-session.
    console.warn('[c9watch][settings] code=settings_persist_failed')
  }
}

/** Load settings from main at startup and hydrate the singleton store. NEVER throws — on a
 *  failure it leaves the defaults (sound ON) so the app is usable. */
export async function loadSettings(): Promise<void> {
  try {
    const settings = await window.settings.get()
    settingsStore.getState().hydrate(settings)
  } catch {
    console.warn('[c9watch][settings] code=settings_load_failed')
  }
}
