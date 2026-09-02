// The ONE place electron-store is imported and constructed (settings + templates both wrap
// this). Imported ONLY from `src/main/index.ts` — electron-store@11 runs `ipcMain.on(...)` at
// MODULE EVAL, which would crash the bare-node `main-unit` runtime; every store module that
// must stay unit-testable takes this as a DI seam instead.
//
// PACKAGING (load-bearing): electron-store@11 is ESM-only (`"type":"module"`), and the
// packaged main bundle is CommonJS — a runtime `require('electron-store')` throws
// ERR_REQUIRE_ESM. So electron-vite BUNDLES it rather than externalizing it:
// `externalizeDepsPlugin({ exclude: ['electron-store'] })` in `electron.vite.config.ts` (read
// that file before touching this import). node-pty stays EXTERNALIZED (native .node, loaded
// from node_modules); `npm run smoke` proves both survive packaging.
import Store from 'electron-store'
import { app } from 'electron'
import { renameSync } from 'node:fs'
import { join } from 'node:path'
import type { PersistedBlobStore } from './persistedBlob'

export interface ElectronBlobStoreOptions {
  /** electron-store file name (without extension) under app.getPath('userData'). */
  name: string
  /** The top-level key the blob lives under. */
  key: string
}

/** conf detects this class by `error.name === 'SyntaxError'`, NOT by `instanceof` — and it is
 *  right to: `instanceof` is realm-sensitive, so a future bundling change that loads conf in a
 *  separate realm would silently stop matching and we would be back to "no backup". Keep both. */
function isJsonSyntaxError(err: unknown): boolean {
  return err instanceof SyntaxError || (err instanceof Error && err.name === 'SyntaxError')
}

/** `<file>.json` → `<file>.corrupt-<ts>.json`, beside the original — a reset never destroys
 *  the operator's data. */
function corruptPathFor(file: string): string {
  return `${file.replace(/\.json$/i, '')}.corrupt-${Date.now()}.json`
}

/** One JSON file per `name`; `backup()` renames it to `<name>.corrupt-<ts>.json` so a reset
 *  never destroys the operator's data. Requires app-ready (electron-store needs userData). */
export function createElectronBlobStore<T>({
  name,
  key
}: ElectronBlobStoreOptions): PersistedBlobStore<T> {
  const construct = (): Store<Record<string, T | undefined>> =>
    new Store<Record<string, T | undefined>>({ name, fileExtension: 'json' })

  // A SYNTACTICALLY corrupt file throws a SyntaxError out of conf's CONSTRUCTOR
  // (`clearInvalidConfig` defaults to false), so `loadPersistedOrReset` never gets to run its
  // corrupt path — the store does not exist yet. Back the file up here and reconstruct, which
  // makes the "a corrupt file is backed up + reset" contract true for this class too.
  // Anything that is NOT a SyntaxError propagates (index.ts degrades to in-memory defaults),
  // and so does a SECOND SyntaxError — we do not loop.
  let store: Store<Record<string, T | undefined>>
  try {
    store = construct()
  } catch (err) {
    if (!isJsonSyntaxError(err)) throw err
    const file = join(app.getPath('userData'), `${name}.json`)
    try {
      renameSync(file, corruptPathFor(file))
    } catch {
      // nothing to back up (or an unwritable dir) — the reset still proceeds
    }
    store = construct()
  }

  return {
    read(): unknown {
      return store.get(key)
    },
    write(value: T): void {
      store.set(key, value)
    },
    backup(): void {
      try {
        renameSync(store.path, corruptPathFor(store.path))
      } catch {
        // nothing to back up (or an unwritable dir) — the in-memory reset still proceeds
      }
    }
  }
}
