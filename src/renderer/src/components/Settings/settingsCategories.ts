// Settings — the category rail (spec 2026-09-29 §3). The order IS the rail's order; the first one
// is where Settings opens. The category is transient view state and is never persisted.
export type SettingsCategoryId = 'notifications' | 'appearance' | 'terminal' | 'keyboard' | 'api'

export const SETTINGS_CATEGORIES: readonly { id: SettingsCategoryId; label: string }[] = [
  { id: 'notifications', label: 'Notifications' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'api', label: 'API' }
]

export const FIRST_SETTINGS_CATEGORY: SettingsCategoryId = 'notifications'
