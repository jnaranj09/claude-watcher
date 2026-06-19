import type { PtyApi, WatchApi, AttentionApi, SettingsApi } from './index'

declare global {
  interface Window {
    pty: PtyApi
    // Story 1.4 — the watch-events subscription bridge (main→renderer push).
    watch: WatchApi
    // Story 2.2 (FR-9) — the in-app jump-to-card subscription bridge (main→renderer push).
    attention: AttentionApi
    // Story 2.4 — the settings read/write bridge (typed invoke over CH.settingsGet/Set).
    settings: SettingsApi
  }
}
