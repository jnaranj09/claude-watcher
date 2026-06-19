/// <reference types="vite/client" />

// Story 1.4 — the renderer-side `Window` augment for the preload bridges. The web
// build program ALSO sees the preload's own augment (it includes src/preload/*.d.ts);
// the `tsconfig.test.json` program does NOT, so we declare it here too (this env.d.ts
// is included by both programs). TypeScript MERGES identical interface augments, so the
// two declarations co-exist as long as the member types match. The types are sourced
// from the shared contract (which the renderer may import), not from src/preload
// (which the sandboxed renderer must never reach into).
import type {
  WatchEventsPayload,
  WatchStatus,
  AttentionActivatePayload,
  Settings,
  SettingsPatch
} from '../../shared/ipc/contract'

declare global {
  interface Window {
    // Mirrors src/preload/index.ts `watchApi` — the watch subscription bridges.
    watch: {
      onEvents(cb: (payload: WatchEventsPayload) => void): () => void
      // Story 1.4 fix — the watch CONNECTION-state subscription (reconnect banner driver).
      onStatus(cb: (status: WatchStatus) => void): () => void
    }
    // Story 2.2 (FR-9) — mirrors src/preload/index.ts `attentionApi`. The in-app
    // jump-to-card subscription (the operator activated a notification). View-state only.
    attention: {
      onActivate(cb: (payload: AttentionActivatePayload) => void): () => void
    }
    // Story 2.4 — mirrors src/preload/index.ts `settingsApi`. The renderer reads/writes
    // settings ONLY through this typed bridge (never electron-store directly — F4). MAIN
    // owns the persisted authority; get/set are typed invokes over CH.settingsGet/Set.
    settings: {
      get(): Promise<Settings>
      set(patch: SettingsPatch): Promise<Settings>
    }
  }
}
