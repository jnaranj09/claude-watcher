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
  selectReminderFirstDelayMinutes
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
      reminderFirstDelayMinutes: 10
    })
    const s = store.getState()
    expect(selectSoundEnabled(s)).toBe(false)
    expect(selectTerminalFontSize(s)).toBe(22)
    expect(selectLoaded(s)).toBe(true)
    expect(selectReminderCount(s)).toBe(5)
    expect(selectReminderFirstDelayMinutes(s)).toBe(10)
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
