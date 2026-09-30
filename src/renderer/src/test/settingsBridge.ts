// A stubbed window.settings for the Settings UI tests (Settings.test / Settings.feedback.test).
import { vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SettingsPatch
} from '../../../shared/schemas/settings'

interface SettingsBridge {
  get(): Promise<Settings>
  set(patch: SettingsPatch): Promise<Settings>
}

/** What main would store for `patch` over the defaults. Fully typed field by field — spreading
 *  optional-undefined props is illegal under exactOptionalPropertyTypes. */
export function mergedSettings(patch: SettingsPatch): Settings {
  return {
    version: DEFAULT_SETTINGS.version,
    soundEnabled: patch.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    terminalFontSize: patch.terminalFontSize ?? DEFAULT_SETTINGS.terminalFontSize,
    reminderCount: patch.reminderCount ?? DEFAULT_SETTINGS.reminderCount,
    reminderFirstDelayMinutes:
      patch.reminderFirstDelayMinutes ?? DEFAULT_SETTINGS.reminderFirstDelayMinutes,
    expanderKey: patch.expanderKey ?? DEFAULT_SETTINGS.expanderKey,
    apiEnabled: patch.apiEnabled ?? DEFAULT_SETTINGS.apiEnabled,
    apiPort: patch.apiPort ?? DEFAULT_SETTINGS.apiPort,
    themeId: patch.themeId ?? DEFAULT_SETTINGS.themeId,
    wallpaperByTheme: patch.wallpaperByTheme ?? DEFAULT_SETTINGS.wallpaperByTheme,
    notificationsEnabled: patch.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled
  }
}

/** Stub window.settings. `set` records every patch in `setCalls`, then answers with `answer`
 *  (by default: resolve with the merged Settings, as main would). */
export function stubSettings(
  answer: (patch: SettingsPatch) => Promise<Settings> = (patch) =>
    Promise.resolve(mergedSettings(patch))
): { setCalls: SettingsPatch[]; set: ReturnType<typeof vi.fn> } {
  const setCalls: SettingsPatch[] = []
  const set = vi.fn((patch: SettingsPatch) => {
    setCalls.push(patch)
    return answer(patch)
  })
  const bridge: SettingsBridge = { get: () => Promise.resolve(DEFAULT_SETTINGS), set }
  ;(window as unknown as { settings: SettingsBridge }).settings = bridge
  return { setCalls, set }
}
