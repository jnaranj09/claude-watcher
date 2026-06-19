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

/**
 * The minimal persisted-blob seam this module needs. Kept tiny so the test fake
 * implements exactly this — and so NO electron-store / fs import sits on this module's
 * (or the unit-test's) path. The blob is the FULL settings object (one JSON document),
 * read/written wholesale so the corrupt-read recovery can validate + back up the whole
 * thing.
 */
export interface PersistedBlobStore {
  /** Read the raw persisted blob (unknown — it may be corrupt/missing). `undefined`
   *  means "nothing persisted yet" (first install) → start from defaults (NOT a backup). */
  read(): unknown
  /** Persist the validated settings blob (wholesale). */
  write(value: Settings): void
  /** Back up the current bad blob (e.g. rename to a `.corrupt-<epoch>` sidecar) so a
   *  corrupt file is preserved for inspection, never silently destroyed (AC-6). Best-effort:
   *  it must NEVER throw out of the recovery path (the recovery proceeds regardless). */
  backup(): void
}

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

/** A no-op in-memory blob store — the default when no `blobStore` is injected. Nothing is
 *  persisted (read() → undefined → defaults), but the store still works in-session. This is
 *  a safe degrade (never-crash); production injects the real electron-store-backed store. */
const inMemoryBlobStore: PersistedBlobStore = {
  read: () => undefined,
  write: () => {},
  backup: () => {}
}

/**
 * Build the settings store (AC-5/6). On construction it reads the persisted blob and
 * recovers fail-closed on corruption (back up + start fresh — NEVER throws/crashes).
 * `set` re-validates + persists and THROWS on bad input. The blob store + log are
 * injectable DI seams (tests use a fake in-memory store + spy log — no electron-store,
 * no disk).
 */
export function createSettingsStore(options: SettingsStoreOptions = {}): SettingsStore {
  const blobStore = options.blobStore ?? inMemoryBlobStore
  // never-log-the-value: a `code=` ONLY, never a settings/file value (Guardrail #6).
  const log = options.log ?? ((message: string): void => console.warn(message))

  // --- Corrupt-read fail-closed recovery (AC-6) ---------------------------------------
  // Read the persisted blob ONCE at construction. `undefined` = nothing persisted yet
  // (first install) → start from defaults, NO backup. A present-but-INVALID blob is
  // CORRUPT → back up the bad file + start fresh; NEVER throw/crash. The log carries a
  // `code=` ONLY — never the file contents.
  let current: Settings
  let raw: unknown
  try {
    raw = blobStore.read()
  } catch {
    // Even READING the blob failed (e.g. fs error) — treat as corrupt-but-unbackable:
    // recover to defaults. Do not attempt a backup of an unreadable blob (best-effort).
    log('[c9watch][settings] code=settings_read_failed')
    raw = undefined
  }

  if (raw === undefined) {
    // First install (or unreadable, handled above): fresh defaults.
    current = { ...DEFAULT_SETTINGS }
  } else {
    const parsed = safeParseSettings(raw)
    if (parsed === null) {
      // CORRUPT persisted blob — back up the bad file + start fresh (AC-6). Never crash.
      // Log a code ONLY (never the blob). The backup is best-effort (never throws out).
      try {
        blobStore.backup()
      } catch {
        // a failed backup must not block recovery — still start fresh.
        log('[c9watch][settings] code=settings_backup_failed')
      }
      log('[c9watch][settings] code=settings_corrupt_reset_to_defaults')
      current = { ...DEFAULT_SETTINGS }
    } else {
      current = parsed
    }
  }

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

/** Parse a blob into Settings, returning `null` (not throwing) on invalid input — used by
 *  the corrupt-read recovery so it can branch to backup+defaults. Logs nothing (the caller
 *  logs a code on the null branch); never echoes the value. */
function safeParseSettings(raw: unknown): Settings | null {
  try {
    return parseSettings(raw)
  } catch {
    return null
  }
}
