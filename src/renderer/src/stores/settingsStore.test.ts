// Story 2.4 — the renderer settings-store tests (jsdom `unit` project).
//
// Asserts the view-state projection (state.md): defaults before load (sound ON), hydrate from a
// main-sourced Settings, and optimistic partial patches that update only the named fields.
// [Source: story 2.4 Task 5; AC-3/5; src/renderer/src/stores/boardStore.ts (factory conventions)]
import { describe, it, expect } from 'vitest'
import {
  createSettingsStore,
  selectSoundEnabled,
  selectTerminalFontSize,
  selectLoaded,
  selectReminderCount,
  selectReminderFirstDelayMinutes,
  selectExpanderKey,
  selectApiEnabled,
  selectApiPort,
  selectThemeId,
  selectWallpaperByTheme,
  selectShellPaneRatio,
  selectTerminalScheme,
  selectTerminalMenuTrigger
} from './settingsStore'
import { DEFAULT_SETTINGS } from '../../../shared/schemas/settings'

describe('createSettingsStore — view-state projection (AC-3/5)', () => {
  it('starts at DEFAULT_SETTINGS (sound ON) and not-yet-loaded', () => {
    const store = createSettingsStore()
    const s = store.getState()
    expect(selectSoundEnabled(s)).toBe(DEFAULT_SETTINGS.soundEnabled)
    expect(selectSoundEnabled(s)).toBe(true)
    expect(selectTerminalFontSize(s)).toBe(DEFAULT_SETTINGS.terminalFontSize)
    expect(selectLoaded(s)).toBe(false)
  })

  it('hydrate replaces the projection from a main-sourced Settings and marks loaded', () => {
    const store = createSettingsStore()
    store.getState().hydrate({
      version: 1,
      soundEnabled: false,
      terminalFontSize: 22,
      reminderCount: 5,
      reminderFirstDelayMinutes: 10,
      expanderKey: 'X',
      apiEnabled: false,
      apiPort: DEFAULT_SETTINGS.apiPort,
      themeId: 'default',
      wallpaperByTheme: {},
      notificationsEnabled: true,
      shellPaneRatio: 0.3,
      terminalScheme: 'light',
      terminalMenuTrigger: 'ctrl-right-click'
    })
    const s = store.getState()
    expect(selectSoundEnabled(s)).toBe(false)
    expect(selectTerminalFontSize(s)).toBe(22)
    expect(selectLoaded(s)).toBe(true)
    expect(selectReminderCount(s)).toBe(5)
    expect(selectReminderFirstDelayMinutes(s)).toBe(10)
    expect(selectTerminalScheme(s)).toBe('light')
    expect(selectTerminalMenuTrigger(s)).toBe('ctrl-right-click')
  })

  it('applyPatch updates ONLY the named field (soundEnabled) — immediate effect', () => {
    const store = createSettingsStore()
    store.getState().applyPatch({ soundEnabled: false })
    expect(selectSoundEnabled(store.getState())).toBe(false)
    // terminalFontSize untouched
    expect(selectTerminalFontSize(store.getState())).toBe(DEFAULT_SETTINGS.terminalFontSize)
  })

  it('applyPatch updates ONLY the named field (terminalFontSize)', () => {
    const store = createSettingsStore()
    store.getState().applyPatch({ terminalFontSize: 18 })
    expect(selectTerminalFontSize(store.getState())).toBe(18)
    expect(selectSoundEnabled(store.getState())).toBe(DEFAULT_SETTINGS.soundEnabled)
  })

  it('an empty patch is a no-op', () => {
    const store = createSettingsStore()
    const before = { ...store.getState() }
    store.getState().applyPatch({})
    expect(selectSoundEnabled(store.getState())).toBe(before.soundEnabled)
    expect(selectTerminalFontSize(store.getState())).toBe(before.terminalFontSize)
  })

  it('starts at the reminder defaults (3 reminders, first after 2 min)', () => {
    const s = createSettingsStore().getState()
    expect(selectReminderCount(s)).toBe(DEFAULT_SETTINGS.reminderCount)
    expect(selectReminderFirstDelayMinutes(s)).toBe(DEFAULT_SETTINGS.reminderFirstDelayMinutes)
  })

  it('applyPatch updates ONLY the named reminder field', () => {
    const store = createSettingsStore()
    store.getState().applyPatch({ reminderCount: 0 })
    expect(selectReminderCount(store.getState())).toBe(0)
    expect(selectReminderFirstDelayMinutes(store.getState())).toBe(
      DEFAULT_SETTINGS.reminderFirstDelayMinutes
    )
    store.getState().applyPatch({ reminderFirstDelayMinutes: 15 })
    expect(selectReminderFirstDelayMinutes(store.getState())).toBe(15)
    expect(selectReminderCount(store.getState())).toBe(0)
    expect(selectSoundEnabled(store.getState())).toBe(DEFAULT_SETTINGS.soundEnabled)
  })
})

describe('expanderKey projection', () => {
  it('starts at the default, hydrates, and applies a patch', () => {
    const store = createSettingsStore()
    expect(selectExpanderKey(store.getState())).toBe('X')
    store.getState().hydrate({ ...DEFAULT_SETTINGS, expanderKey: 'Q' })
    expect(selectExpanderKey(store.getState())).toBe('Q')
    store.getState().applyPatch({ expanderKey: 'Z' })
    expect(selectExpanderKey(store.getState())).toBe('Z')
    // A patch without the key leaves it alone.
    store.getState().applyPatch({ soundEnabled: false })
    expect(selectExpanderKey(store.getState())).toBe('Z')
  })
})

describe('programmatic API projection', () => {
  it('starts with the API off on the default port, and hydrates from main', () => {
    const store = createSettingsStore()
    expect(selectApiEnabled(store.getState())).toBe(false)
    expect(selectApiPort(store.getState())).toBe(DEFAULT_SETTINGS.apiPort)
    store.getState().hydrate({ ...DEFAULT_SETTINGS, apiEnabled: true, apiPort: 9300 })
    expect(selectApiEnabled(store.getState())).toBe(true)
    expect(selectApiPort(store.getState())).toBe(9300)
  })

  it('applyPatch applies each field, and a patch without them leaves both alone', () => {
    const store = createSettingsStore()
    store.getState().applyPatch({ apiEnabled: true })
    expect(selectApiEnabled(store.getState())).toBe(true)
    expect(selectApiPort(store.getState())).toBe(DEFAULT_SETTINGS.apiPort)
    store.getState().applyPatch({ apiPort: 9300 })
    expect(selectApiPort(store.getState())).toBe(9300)
    expect(selectApiEnabled(store.getState())).toBe(true)
    // A patch that names neither key touches neither.
    store.getState().applyPatch({ soundEnabled: false })
    expect(selectApiEnabled(store.getState())).toBe(true)
    expect(selectApiPort(store.getState())).toBe(9300)
  })
})

describe('themeId', () => {
  it('starts as default, hydrates and patches', () => {
    const store = createSettingsStore()
    expect(selectThemeId(store.getState())).toBe('default')
    store.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' })
    expect(selectThemeId(store.getState())).toBe('paper')
    store.getState().applyPatch({ themeId: 'liquid-glass' })
    expect(selectThemeId(store.getState())).toBe('liquid-glass')
    store.getState().applyPatch({ soundEnabled: false })
    expect(selectThemeId(store.getState())).toBe('liquid-glass')
  })
})

describe('wallpaperByTheme (spec 2026-09-24)', () => {
  it('hydrates and applies a patch', () => {
    const store = createSettingsStore()
    store.getState().hydrate({ ...DEFAULT_SETTINGS, wallpaperByTheme: { g: 'a' } })
    expect(selectWallpaperByTheme(store.getState())).toEqual({ g: 'a' })
    store.getState().applyPatch({ wallpaperByTheme: { g: 'b' } })
    expect(selectWallpaperByTheme(store.getState())).toEqual({ g: 'b' })
    store.getState().applyPatch({ soundEnabled: false })
    expect(selectWallpaperByTheme(store.getState())).toEqual({ g: 'b' })
  })
})

describe('settingsStore — shellPaneRatio projection', () => {
  it('defaults to 0.3, hydrates, and applies a patch optimistically', () => {
    const store = createSettingsStore()
    expect(selectShellPaneRatio(store.getState())).toBe(0.3)
    store.getState().hydrate({ ...DEFAULT_SETTINGS, shellPaneRatio: 0.5 })
    expect(selectShellPaneRatio(store.getState())).toBe(0.5)
    store.getState().applyPatch({ shellPaneRatio: 0.2 })
    expect(selectShellPaneRatio(store.getState())).toBe(0.2)
  })
})

describe('terminalScheme', () => {
  it('starts on "theme" and a patch changes only it', () => {
    const store = createSettingsStore()
    expect(selectTerminalScheme(store.getState())).toBe('theme')
    store.getState().applyPatch({ terminalScheme: 'dark' })
    expect(selectTerminalScheme(store.getState())).toBe('dark')
    expect(store.getState().terminalFontSize).toBe(DEFAULT_SETTINGS.terminalFontSize)
  })
})
