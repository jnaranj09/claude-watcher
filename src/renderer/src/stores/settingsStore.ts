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
import {
  DEFAULT_SETTINGS,
  type ReminderFirstDelayMinutes,
  type TerminalScheme,
  type TerminalMenuTrigger
} from '../../../shared/schemas/settings'

export interface SettingsState {
  /** The live sound toggle (default ON — UX-DR26). The sole governor of sound frequency. */
  soundEnabled: boolean
  /** The live terminal font-size (px). Persisted now; Epic-3's terminal consumes it (F5). */
  terminalFontSize: number
  /** Attention reminders — how many times a still-blocked session is re-notified (0 = off). */
  reminderCount: number
  /** Attention reminders — minutes before the first reminder; each later gap doubles. */
  reminderFirstDelayMinutes: ReminderFirstDelayMinutes
  /** Shortcut expander — the letter of the Ctrl+Alt chord that opens the box. */
  expanderKey: string
  /** Programmatic API — whether the local HTTP listener is running (default OFF). */
  apiEnabled: boolean
  /** Programmatic API — the port the listener binds on 127.0.0.1. */
  apiPort: number
  /** Custom themes — the CHOSEN theme id (`default` or a folder id). The APPLIED bundle lives
   *  in themeStore. */
  themeId: string
  /** Theme wallpapers — theme id → picked wallpaper id (spec 2026-09-24). */
  wallpaperByTheme: Readonly<Record<string, string>>
  /** UX-13 — desktop popups on/off (default ON). Main reads its own copy; this drives Settings. */
  notificationsEnabled: boolean
  /** Card shell pane — the divider position (the shell's share of the frame, 0.15–0.85). */
  shellPaneRatio: number
  /** Terminal colours — follow the theme, or a built-in dark / light palette. */
  terminalScheme: TerminalScheme
  /** Which click opens the terminal Copy/Paste menu. */
  terminalMenuTrigger: TerminalMenuTrigger
  /** Include global (spec 2026-10-03 H) — a workspace view of a config list also shows the global
   *  rows. One value for every list. */
  includeGlobal: boolean
  /** Whether the initial load from main has completed (until then the defaults are shown). */
  loaded: boolean
  /** Action feedback (spec 2026-09-29 §2.1) — the last Settings MAIN returned (DEFAULT_SETTINGS
   *  before the first load). A refused write rolls the projection back to it. */
  authoritative: Settings
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
    reminderCount: DEFAULT_SETTINGS.reminderCount,
    reminderFirstDelayMinutes: DEFAULT_SETTINGS.reminderFirstDelayMinutes,
    expanderKey: DEFAULT_SETTINGS.expanderKey,
    apiEnabled: DEFAULT_SETTINGS.apiEnabled,
    apiPort: DEFAULT_SETTINGS.apiPort,
    themeId: DEFAULT_SETTINGS.themeId,
    wallpaperByTheme: DEFAULT_SETTINGS.wallpaperByTheme,
    notificationsEnabled: DEFAULT_SETTINGS.notificationsEnabled,
    shellPaneRatio: DEFAULT_SETTINGS.shellPaneRatio,
    terminalScheme: DEFAULT_SETTINGS.terminalScheme,
    terminalMenuTrigger: DEFAULT_SETTINGS.terminalMenuTrigger,
    includeGlobal: DEFAULT_SETTINGS.includeGlobal,
    loaded: false,
    authoritative: DEFAULT_SETTINGS,

    hydrate: (settings) => {
      set({
        soundEnabled: settings.soundEnabled,
        terminalFontSize: settings.terminalFontSize,
        reminderCount: settings.reminderCount,
        reminderFirstDelayMinutes: settings.reminderFirstDelayMinutes,
        expanderKey: settings.expanderKey,
        apiEnabled: settings.apiEnabled,
        apiPort: settings.apiPort,
        themeId: settings.themeId,
        wallpaperByTheme: settings.wallpaperByTheme,
        notificationsEnabled: settings.notificationsEnabled,
        shellPaneRatio: settings.shellPaneRatio,
        terminalScheme: settings.terminalScheme,
        terminalMenuTrigger: settings.terminalMenuTrigger,
        includeGlobal: settings.includeGlobal,
        loaded: true,
        authoritative: settings
      })
    },

    applyPatch: (patch) => {
      // Optimistic, immediate projection update (AC-5). Only set the fields the patch carries.
      set({
        ...(patch.soundEnabled !== undefined ? { soundEnabled: patch.soundEnabled } : {}),
        ...(patch.terminalFontSize !== undefined
          ? { terminalFontSize: patch.terminalFontSize }
          : {}),
        ...(patch.reminderCount !== undefined ? { reminderCount: patch.reminderCount } : {}),
        ...(patch.reminderFirstDelayMinutes !== undefined
          ? { reminderFirstDelayMinutes: patch.reminderFirstDelayMinutes }
          : {}),
        ...(patch.expanderKey !== undefined ? { expanderKey: patch.expanderKey } : {}),
        ...(patch.apiEnabled !== undefined ? { apiEnabled: patch.apiEnabled } : {}),
        ...(patch.apiPort !== undefined ? { apiPort: patch.apiPort } : {}),
        ...(patch.themeId !== undefined ? { themeId: patch.themeId } : {}),
        ...(patch.wallpaperByTheme !== undefined
          ? { wallpaperByTheme: patch.wallpaperByTheme }
          : {}),
        ...(patch.notificationsEnabled !== undefined
          ? { notificationsEnabled: patch.notificationsEnabled }
          : {}),
        ...(patch.shellPaneRatio !== undefined ? { shellPaneRatio: patch.shellPaneRatio } : {}),
        ...(patch.terminalScheme !== undefined ? { terminalScheme: patch.terminalScheme } : {}),
        ...(patch.terminalMenuTrigger !== undefined
          ? { terminalMenuTrigger: patch.terminalMenuTrigger }
          : {}),
        ...(patch.includeGlobal !== undefined ? { includeGlobal: patch.includeGlobal } : {})
      })
    }
  }))
}

// ---------------------------------------------------------------------------
// Selectors (NARROW, primitive — state.md). Components subscribe to the smallest slice.
// ---------------------------------------------------------------------------

/** The live sound toggle (primitive — safe without useShallow). */
export const selectSoundEnabled = (state: SettingsState): boolean => state.soundEnabled
/** UX-13 — the live desktop-popup toggle (primitive). */
export const selectNotificationsEnabled = (state: SettingsState): boolean =>
  state.notificationsEnabled
/** Card shell pane — the live divider ratio (primitive). */
export const selectShellPaneRatio = (state: SettingsState): number => state.shellPaneRatio
/** The live terminal font-size (primitive). */
export const selectTerminalFontSize = (state: SettingsState): number => state.terminalFontSize
/** Terminal colours — the live scheme (primitive). */
export const selectTerminalScheme = (state: SettingsState): TerminalScheme => state.terminalScheme
/** The live terminal Copy/Paste menu click (primitive). */
export const selectTerminalMenuTrigger = (state: SettingsState): TerminalMenuTrigger =>
  state.terminalMenuTrigger
/** Include global — the one remembered choice every config list reads (primitive). */
export const selectIncludeGlobal = (state: SettingsState): boolean => state.includeGlobal
/** Attention reminders — the live reminder count (primitive; 0 = off). */
export const selectReminderCount = (state: SettingsState): number => state.reminderCount
/** Attention reminders — the live first-reminder delay in minutes (primitive). */
export const selectReminderFirstDelayMinutes = (state: SettingsState): ReminderFirstDelayMinutes =>
  state.reminderFirstDelayMinutes
/** Shortcut expander — the live open-chord letter (primitive). */
export const selectExpanderKey = (state: SettingsState): string => state.expanderKey
/** Programmatic API — whether the local HTTP listener is on (primitive). */
export const selectApiEnabled = (state: SettingsState): boolean => state.apiEnabled
/** Programmatic API — the port the listener binds (primitive). */
export const selectApiPort = (state: SettingsState): number => state.apiPort
/** Custom themes — the live chosen theme id (primitive). */
export const selectThemeId = (state: SettingsState): string => state.themeId
/** Same object reference until a hydrate/patch replaces it — safe without `useShallow`. */
export const selectWallpaperByTheme = (state: SettingsState): Readonly<Record<string, string>> =>
  state.wallpaperByTheme
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

/** The code `persistSettingsPatch` rejects with; Settings maps it to `Could not save <setting>.` */
export const SETTINGS_PERSIST_FAILED = 'settings_persist_failed'

/**
 * Persist a settings patch through main. Applies it OPTIMISTICALLY first (immediate effect,
 * AC-5), then awaits main: on success re-hydrates with main's validated value; on a refusal ROLLS
 * BACK to the last value main returned (`authoritative`) — the optimistic value must never outlive
 * a refused write — logs a code (never the value) and REJECTS with `settings_persist_failed`, so
 * the caller can say what did not save (spec 2026-09-29 §2.1).
 *
 * Exported so the Settings UI binds its controls to ONE persistence entry point.
 */
export async function persistSettingsPatch(patch: SettingsPatch): Promise<void> {
  settingsStore.getState().applyPatch(patch)
  let stored: Settings
  try {
    stored = await window.settings.set(patch)
  } catch {
    console.warn('[c9watch][settings] code=settings_persist_failed')
    settingsStore.getState().hydrate(settingsStore.getState().authoritative)
    throw new Error(SETTINGS_PERSIST_FAILED)
  }
  settingsStore.getState().hydrate(stored)
}

/** Load settings from main at startup and hydrate the singleton store. Resolves whether it worked
 *  (the startup toast names the failures); on a failure it leaves the defaults (sound ON) so the
 *  app is usable. Never rejects. */
export async function loadSettings(): Promise<boolean> {
  try {
    const settings = await window.settings.get()
    settingsStore.getState().hydrate(settings)
    return true
  } catch {
    console.warn('[c9watch][settings] code=settings_load_failed')
    return false
  }
}
