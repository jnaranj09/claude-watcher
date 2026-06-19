/// <reference types="vite/client" />

// Story 1.4 — the renderer-side `Window` augment for the preload bridges. The web
// build program ALSO sees the preload's own augment (it includes src/preload/*.d.ts);
// the `tsconfig.test.json` program does NOT, so we declare it here too (this env.d.ts
// is included by both programs). TypeScript MERGES identical interface augments, so the
// two declarations co-exist as long as the member types match. The types are sourced
// from the shared contract (which the renderer may import), not from src/preload
// (which the sandboxed renderer must never reach into).
import type { WatchEventsPayload, WatchStatus } from '../../shared/ipc/contract'

declare global {
  interface Window {
    // Mirrors src/preload/index.ts `watchApi` — the watch subscription bridges.
    watch: {
      onEvents(cb: (payload: WatchEventsPayload) => void): () => void
      // Story 1.4 fix — the watch CONNECTION-state subscription (reconnect banner driver).
      onStatus(cb: (status: WatchStatus) => void): () => void
    }
  }
}
