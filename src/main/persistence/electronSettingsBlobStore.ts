// Story 2.4 — the REAL electron-store-backed `PersistedBlobStore` (MAIN only).
//
// This is the ONLY place electron-store is imported/constructed. It is imported ONLY by
// `src/main/index.ts` (the real main process), NEVER by `./settings.ts` or any unit test —
// because electron-store@11 executes `ipcMain.on(...)` at MODULE EVAL (it imports `electron`
// at the top), which would crash the bare-node `main-unit` test runtime. Keeping it in this
// dedicated file (injected as the `blobStore` DI seam into `createSettingsStore`) preserves
// the unit-testability of `settings.ts`. [Source: story 2.4 Task 2; src/main/kde/tray.ts
//  (Electron-touching defaults kept OFF the unit-test path)]
//
// PACKAGING (the load-bearing risk for this story): electron-store@11 is ESM-only
// (`"type":"module"`). The CJS packaged main bundle CANNOT `require()` it, so electron-vite
// is configured to BUNDLE it (`externalizeDepsPlugin({ exclude: ['electron-store'] })` in
// electron.vite.config.ts) — this static `import` is transpiled INTO the main bundle. node-pty
// stays externalized (native .node, loaded from node_modules). `npm run smoke` proves both
// still work after packaging.
import Store from 'electron-store'
import { renameSync } from 'node:fs'
import type { Settings } from '../../shared/schemas/settings'
import type { PersistedBlobStore } from './settings'

/** The single key the whole settings document is stored under (read/backup operate on the
 *  one document). */
const SETTINGS_KEY = 'settings'

/**
 * Construct the electron-store-backed blob store. Stores the whole `Settings` object under
 * one key so the corrupt-read recovery validates + backs up a single document. The backup
 * renames electron-store's JSON file to a timestamped `.corrupt-<epoch>.json` sidecar under
 * userData (best-effort — never throws out of the recovery path).
 *
 * `new Store(...)` is constructed lazily inside this factory (called once from main AFTER
 * `app` is ready), not at module eval — so importing this file does not itself touch the
 * electron app lifecycle.
 */
export function createElectronSettingsBlobStore(): PersistedBlobStore {
  const store = new Store<{ settings?: Settings }>({
    name: 'c9watch-settings',
    fileExtension: 'json'
  })

  return {
    read(): unknown {
      return store.get(SETTINGS_KEY)
    },
    write(value: Settings): void {
      store.set(SETTINGS_KEY, value)
    },
    backup(): void {
      // Preserve the corrupt blob: rename the on-disk JSON to a timestamped sidecar.
      const from = store.path
      const to = from.replace(/\.json$/i, '') + `.corrupt-${Date.now()}.json`
      try {
        renameSync(from, to)
      } catch {
        // Best-effort: if the rename fails (file missing/locked), recovery still proceeds.
      }
    }
  }
}
