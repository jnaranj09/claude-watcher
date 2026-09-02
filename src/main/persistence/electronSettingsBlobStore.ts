// Story 2.4 — the REAL electron-store-backed `PersistedBlobStore` (MAIN only).
//
// This is imported ONLY by `src/main/index.ts` (the real main process), NEVER by `./settings.ts`
// or any unit test — because electron-store@11 executes `ipcMain.on(...)` at MODULE EVAL (it
// imports `electron` at the top), which would crash the bare-node `main-unit` test runtime.
// Keeping it out of `settings.ts` (injected as the `blobStore` DI seam into `createSettingsStore`)
// preserves the unit-testability of that module. [Source: story 2.4 Task 2; src/main/kde/tray.ts
//  (Electron-touching defaults kept OFF the unit-test path)]
//
// The actual electron-store construction + JSON-file backup now live in the generic
// `createElectronBlobStore` (`./electronBlobStore.ts`) — this is a thin wrapper that supplies
// the settings-specific `name`/`key` so the on-disk file name and shape stay exactly as before
// (a PENDING rename per CLAUDE.md "Naming": changing the file name would orphan every
// operator's settings without a migration).
import type { Settings } from '../../shared/schemas/settings'
import type { PersistedBlobStore } from './settings'
import { createElectronBlobStore } from './electronBlobStore'

export function createElectronSettingsBlobStore(): PersistedBlobStore {
  return createElectronBlobStore<Settings>({ name: 'c9watch-settings', key: 'settings' })
}
