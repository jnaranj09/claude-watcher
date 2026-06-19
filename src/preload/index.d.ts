import type { PtyApi, WatchApi } from './index'

declare global {
  interface Window {
    pty: PtyApi
    // Story 1.4 — the watch-events subscription bridge (main→renderer push).
    watch: WatchApi
  }
}
