// Story 2.4 — the settings store tests (main-unit / node project).
//
// Inject a FAKE in-memory PersistedBlobStore (the DI seam) + a spy `log` so NO real
// electron-store, NO disk, and NO electron import are loaded on the test path. Asserts:
//   - AC-5: first-install returns defaults; set+get round-trip; set returns the validated value.
//   - AC-6: a CORRUPT persisted blob → backup taken + DEFAULTS returned (NOT a throw); the log
//     carries a `code=` ONLY (never the corrupt value).
//   - AC-6/7: an invalid `set` THROWS a typed error (untrusted cross-process input) and never
//     logs the value.
//   - first-install read===undefined → NO backup taken (only a real corrupt blob backs up).
// [Source: story 2.4 Task 2.5; AC-5/6/8; .claude/rules/zod-boundaries.md; tray.test.ts style]
import { describe, it, expect, vi } from 'vitest'
import { createSettingsStore, type PersistedBlobStore } from './settings'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../../shared/schemas/settings'

/** A capturing fake blob store: holds an in-memory blob, records writes + backup calls.
 *  `seed` is the initial persisted blob (use `undefined` for first-install, a malformed
 *  object for the corrupt-read case). */
function makeFakeBlobStore(seed: unknown): {
  blobStore: PersistedBlobStore
  writes: Settings[]
  backupCount: number
  current: () => unknown
} {
  let blob: unknown = seed
  const writes: Settings[] = []
  let backupCount = 0
  const blobStore: PersistedBlobStore = {
    read: () => blob,
    write: (value) => {
      writes.push(value)
      blob = value
    },
    backup: () => {
      backupCount++
    }
  }
  return {
    blobStore,
    writes,
    get backupCount() {
      return backupCount
    },
    current: () => blob
  }
}

describe('createSettingsStore — first install + round-trip (AC-5)', () => {
  it('first install (nothing persisted) returns DEFAULT_SETTINGS and persists them', () => {
    const fake = makeFakeBlobStore(undefined)
    const log = vi.fn()
    const store = createSettingsStore({ blobStore: fake.blobStore, log })

    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    // The defaults were seeded to disk so the file exists going forward.
    expect(fake.writes).toContainEqual(DEFAULT_SETTINGS)
    // First-install is NOT a corruption — no backup taken, no corrupt log.
    expect(fake.backupCount).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })

  it('set + get round-trips a soundEnabled change and returns the validated value', () => {
    const fake = makeFakeBlobStore(undefined)
    const store = createSettingsStore({ blobStore: fake.blobStore })

    const next = store.set({ soundEnabled: false })
    expect(next.soundEnabled).toBe(false)
    expect(store.get().soundEnabled).toBe(false)
    // version stays main-owned + valid through the merge.
    expect(next.version).toBe(DEFAULT_SETTINGS.version)
    // The new value was persisted.
    expect(fake.current()).toEqual(next)
  })

  it('set merges a terminalFontSize change without touching soundEnabled', () => {
    const fake = makeFakeBlobStore(undefined)
    const store = createSettingsStore({ blobStore: fake.blobStore })

    const next = store.set({ terminalFontSize: 20 })
    expect(next.terminalFontSize).toBe(20)
    expect(next.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled)
  })

  it('a fresh file starts from the injected defaults (the dev profile API port)', () => {
    const defaults: Settings = { ...DEFAULT_SETTINGS, apiPort: 19281 }
    const fake = makeFakeBlobStore(undefined)
    const store = createSettingsStore({ blobStore: fake.blobStore, log: vi.fn(), defaults })

    expect(store.get()).toEqual(defaults)
    expect(fake.writes).toContainEqual(defaults)
  })

  it('injected defaults never override a saved file', () => {
    const saved: Settings = { ...DEFAULT_SETTINGS, apiPort: 9300 }
    const fake = makeFakeBlobStore(saved)
    const defaults: Settings = { ...DEFAULT_SETTINGS, apiPort: 19281 }
    const store = createSettingsStore({ blobStore: fake.blobStore, log: vi.fn(), defaults })

    expect(store.get().apiPort).toBe(9300)
  })

  it('loads a VALID persisted blob as-is (no defaults, no backup)', () => {
    const persisted: Settings = {
      version: 1,
      soundEnabled: false,
      terminalFontSize: 22,
      reminderCount: 3,
      reminderFirstDelayMinutes: 2,
      expanderKey: 'X',
      apiEnabled: false,
      apiPort: 9281,
      themeId: 'default',
      wallpaperByTheme: {},
      notificationsEnabled: true,
      shellPaneRatio: 0.3,
      terminalScheme: 'dark',
      terminalMenuTrigger: 'shift-right-click'
    }
    const fake = makeFakeBlobStore(persisted)
    const log = vi.fn()
    const store = createSettingsStore({ blobStore: fake.blobStore, log })

    expect(store.get()).toEqual(persisted)
    expect(fake.backupCount).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })

  it('loads a v1 blob written BEFORE reminders existed — keeps it, defaults only the new fields (D-12)', () => {
    // A real pre-reminders v1 file: no reminderCount/reminderFirstDelayMinutes keys at all.
    const preReminders = { version: 1, soundEnabled: false, terminalFontSize: 16 }
    const fake = makeFakeBlobStore(preReminders)
    const log = vi.fn()
    const store = createSettingsStore({ blobStore: fake.blobStore, log })

    // Additive, not corrupt: the missing fields default — the rest of the file is untouched.
    expect(fake.backupCount).toBe(0)
    expect(log).not.toHaveBeenCalled()
    expect(store.get()).toEqual({
      version: 1,
      soundEnabled: false,
      terminalFontSize: 16,
      reminderCount: 3,
      reminderFirstDelayMinutes: 2,
      expanderKey: 'X',
      apiEnabled: false,
      apiPort: 9281,
      themeId: 'default',
      wallpaperByTheme: {},
      notificationsEnabled: true,
      shellPaneRatio: 0.3,
      terminalScheme: 'theme',
      terminalMenuTrigger: 'right-click'
    })
  })
})

describe('createSettingsStore — corrupt read fails closed: backup + start fresh (AC-6)', () => {
  it('a CORRUPT persisted blob backs up the bad file and returns DEFAULTS (does NOT throw)', () => {
    // A malformed blob (wrong types / out of range) — must NOT crash the app.
    const corrupt = { version: 1, soundEnabled: 'nope', terminalFontSize: 9999 }
    const fake = makeFakeBlobStore(corrupt)
    const log = vi.fn()

    let store: ReturnType<typeof createSettingsStore> | undefined
    expect(() => {
      store = createSettingsStore({ blobStore: fake.blobStore, log })
    }).not.toThrow()

    expect(store?.get()).toEqual(DEFAULT_SETTINGS)
    // The bad blob was backed up (preserved), not silently destroyed.
    expect(fake.backupCount).toBe(1)
  })

  it('the corrupt-read log carries a `code=` ONLY — never the corrupt value (never-log-the-value)', () => {
    const corrupt = { version: 1, soundEnabled: 'nope', terminalFontSize: 9999 }
    const fake = makeFakeBlobStore(corrupt)
    const log = vi.fn()
    createSettingsStore({ blobStore: fake.blobStore, log })

    expect(log).toHaveBeenCalled()
    const allLogged = log.mock.calls.map((c) => String(c[0])).join('\n')
    // The recovery code is logged…
    expect(allLogged).toContain('code=settings_corrupt_reset_to_defaults')
    // …and NOTHING of the corrupt value leaks (neither the bad field name's value nor the number).
    expect(allLogged).not.toContain('nope')
    expect(allLogged).not.toContain('9999')
  })

  it('a totally non-object corrupt blob (string) recovers to defaults + backs up', () => {
    const fake = makeFakeBlobStore('totally not json settings')
    const store = createSettingsStore({ blobStore: fake.blobStore, log: vi.fn() })
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(fake.backupCount).toBe(1)
  })

  it('a WRONG-version blob is treated as corrupt (no migration) → backup + defaults', () => {
    const fake = makeFakeBlobStore({ version: 2, soundEnabled: true, terminalFontSize: 14 })
    const store = createSettingsStore({ blobStore: fake.blobStore, log: vi.fn() })
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(fake.backupCount).toBe(1)
  })
})

describe('createSettingsStore — invalid set throws typed (untrusted IPC arg, AC-6/7)', () => {
  it('an out-of-range terminalFontSize set THROWS (fails closed)', () => {
    const fake = makeFakeBlobStore(undefined)
    const store = createSettingsStore({ blobStore: fake.blobStore })
    // Cast through unknown: the IPC handler receives `raw: unknown`; we simulate a bad arg.
    expect(() => store.set({ terminalFontSize: 9999 })).toThrow()
  })

  it('a non-boolean soundEnabled set THROWS and does NOT log the value', () => {
    const fake = makeFakeBlobStore(undefined)
    const log = vi.fn()
    const store = createSettingsStore({ blobStore: fake.blobStore, log })
    expect(() => store.set({ soundEnabled: 'yes' } as unknown as SettingsPatch)).toThrow()
    // The throw is the boundary signal; we never log the bad value.
    const allLogged = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(allLogged).not.toContain('yes')
  })

  it('a failed set leaves the prior value intact (in-memory authority unchanged)', () => {
    const fake = makeFakeBlobStore(undefined)
    const store = createSettingsStore({ blobStore: fake.blobStore })
    const before = store.get()
    expect(() => store.set({ terminalFontSize: 9999 })).toThrow()
    expect(store.get()).toEqual(before)
  })
})
