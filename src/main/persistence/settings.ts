// Story 2.4 — the settings store in MAIN, behind a DI seam.
//
// MAIN owns the persisted settings; the renderer reads/writes ONLY via typed IPC
// (CH.settingsGet/CH.settingsSet) — never electron-store directly (AC-5/F4). The shape
// is the versioned Zod `Settings` (src/shared/schemas/settings.ts); this module is the
// persistence + fail-closed boundary around it.
//
// FAIL-CLOSED on a CORRUPT persisted read (AC-6 / .claude/rules/zod-boundaries.md
// persisted-file row): on construction we read the persisted blob and `parseSettings`;
// on failure we BACK UP the bad blob (so it is not silently lost) and START FRESH from
// DEFAULT_SETTINGS. We NEVER throw / crash on corrupt prefs (PRECEDENCE #1 fail-closed,
// realized as back-up-and-recover, not as a crash). The log on that path carries a
// `code=` ONLY — never the file contents (never-log-the-value, Guardrail #6).
//
// `set(patch)` re-validates the MERGED shape via the schema and persists; an invalid set
// THROWS a typed error (the IPC handler maps that to a rejected invoke — untrusted
// cross-process input parse-and-throw, zod-boundaries.md IPC-arg row).
//
// DI seam (mirrors createTrayController / createAttentionNotifier): the underlying blob
// store + the `log` sink are injectable, so the unit tests use a FAKE in-memory blob store
// (no real electron-store, no disk) and a spy log. The REAL electron-store-backed blob
// store lives in `./electronSettingsBlobStore.ts` and is constructed + injected by
// `src/main/index.ts` — this module imports NEITHER electron NOR electron-store, so the
// `main-unit` (bare-node) test can import it without crashing on electron-store's
// module-eval `ipcMain.on(...)`.
// [Source: story 2.4 Task 2; AC-5/6/8; F4; src/main/kde/tray.ts (DI-seam + never-crash +
//  code-only-log precedent); src/shared/schemas/settings.ts]
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SettingsPatchSchema,
  type Settings,
  type SettingsPatch
} from '../../shared/schemas/settings'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore as GenericPersistedBlobStore
} from './persistedBlob'

/** Kept under its historical name: settings.test.ts and electronSettingsBlobStore.ts import it. */
export type PersistedBlobStore = GenericPersistedBlobStore<Settings>

export interface SettingsStoreOptions {
  /** The persisted-blob seam (DI). Tests inject a fake; main injects the real
   *  electron-store-backed store from `./electronSettingsBlobStore`. If omitted, the
   *  store runs IN-MEMORY ONLY (no persistence) — a safe degrade, never a crash. */
  blobStore?: PersistedBlobStore
  /** Log sink — a `code=` ONLY, NEVER a settings/file value (Guardrail #6). Defaults to
   *  console.warn. Injectable so tests can spy without a real console write. */
  log?: (message: string) => void
}

export interface SettingsStore {
  /** The current validated settings (in-memory, authoritative for the running session). */
  get(): Settings
  /** Merge a PARTIAL patch, re-validate the whole shape, persist, and return the new
   *  validated settings. THROWS a typed error on invalid input (untrusted IPC arg). The
   *  param type is the schema-inferred `SettingsPatch` (single source of truth); the body
   *  re-parses it anyway so a direct main-side caller can't bypass the boundary. */
  set(patch: SettingsPatch): Settings
}

/**
 * Build the settings store (AC-5/6). On construction it reads the persisted blob and
 * recovers fail-closed on corruption (back up + start fresh — NEVER throws/crashes).
 * `set` re-validates + persists and THROWS on bad input. The blob store + log are
 * injectable DI seams (tests use a fake in-memory store + spy log — no electron-store,
 * no disk). The read → parse → backup-on-corrupt → fallback pattern itself lives in the
 * generic, pure `loadPersistedOrReset` (`./persistedBlob.ts`) — this module supplies the
 * settings-specific `parse`/`fallback`/`onProblem` (the log-line prefix stays byte-identical
 * to the pre-extraction strings so `settings.test.ts` keeps asserting the same `code=`).
 */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<Settings>()
  // never-log-the-value: a `code=` ONLY, never a settings/file value (Guardrail #6).
  const log = options.log ?? ((message: string): void => console.warn(message))

  // --- Corrupt-read fail-closed recovery (AC-6) ---------------------------------------
  // Read the persisted blob ONCE at construction. `undefined` = nothing persisted yet
  // (first install) → start from defaults, NO backup. A present-but-INVALID blob is
  // CORRUPT → back up the bad file + start fresh; NEVER throw/crash. The log carries a
  // `code=` ONLY — never the file contents.
  let current: Settings = loadPersistedOrReset<Settings>({
    blobStore,
    parse: parseSettings,
    fallback: () => ({ ...DEFAULT_SETTINGS }),
    onProblem: (code) => log(`[c9watch][settings] code=settings_${code}`)
  })

  // Persist the recovered/seeded value so the on-disk file always reflects a valid shape.
  // A write failure here must not crash construction (degrade to in-memory only).
  try {
    blobStore.write(current)
  } catch {
    log('[c9watch][settings] code=settings_write_failed')
  }

  function get(): Settings {
    return current
  }

  function set(patch: SettingsPatch): Settings {
    // Untrusted-input parse-and-throw (zod-boundaries.md IPC-arg row): validate the PATCH
    // shape first (the IPC handler also parses, but the store re-guards so a direct
    // main-side caller can't bypass it). A bad patch THROWS a typed Zod error here.
    const cleanPatch: SettingsPatch = SettingsPatchSchema.parse(patch)
    // Merge onto the current settings (version stays main-owned — the patch can't carry it),
    // then re-validate the WHOLE shape (this also fails closed on any out-of-range merge).
    const merged = parseSettings({ ...current, ...cleanPatch })
    current = merged
    try {
      blobStore.write(current)
    } catch {
      // A persist failure must not lose the in-memory change nor crash the caller; the
      // value still took effect in-session. Log a code only.
      log('[c9watch][settings] code=settings_write_failed')
    }
    return current
  }

  return { get, set }
}
