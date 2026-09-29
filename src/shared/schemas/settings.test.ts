// Story 2.4 — the versioned settings-schema tests (jsdom `unit` project).
//
// Asserts the OUR-shape fail-closed contract (the OPPOSITE of session.ts's
// additions-pass `.passthrough()`):
//   - a valid v1 shape round-trips through parseSettings;
//   - the version field is present + literal-gated (a wrong version FAILS);
//   - out-of-range / non-int terminalFontSize FAILS CLOSED (not clamped silently);
//   - a non-boolean soundEnabled FAILS CLOSED;
//   - DEFAULT_SETTINGS is itself valid (the fresh-start value);
//   - the patch schema accepts partials + rejects out-of-range / version mutation.
// [Source: story 2.4 Task 1; AC-4/5/6; .claude/rules/zod-boundaries.md]
import { describe, it, expect } from 'vitest'
import {
  SettingsSchema,
  SettingsPatchSchema,
  WALLPAPER_BY_THEME_MAX,
  parseSettings,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  REMINDER_COUNT_MAX,
  REMINDER_FIRST_DELAY_OPTIONS,
  DEFAULT_REMINDER_COUNT,
  DEFAULT_REMINDER_FIRST_DELAY_MINUTES,
  DEFAULT_EXPANDER_KEY,
  DEFAULT_API_PORT,
  expanderChord,
  type Settings
} from './settings'

describe('SettingsSchema — versioned, our-shape, fail-closed (AC-4/5/6)', () => {
  it('round-trips a valid v1 shape and the version field is present', () => {
    const valid: Settings = {
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
      notificationsEnabled: true
    }
    const parsed = parseSettings(valid)
    expect(parsed).toEqual(valid)
    expect(parsed.version).toBe(SETTINGS_VERSION)
  })

  it('DEFAULT_SETTINGS is itself valid (fresh-start value) — sound default ON', () => {
    expect(() => parseSettings(DEFAULT_SETTINGS)).not.toThrow()
    expect(DEFAULT_SETTINGS.soundEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION)
  })

  it('a WRONG version fails closed (literal-gated — migration seam)', () => {
    const r = SettingsSchema.safeParse({ version: 2, soundEnabled: true, terminalFontSize: 14 })
    expect(r.success).toBe(false)
  })

  it('a MISSING version fails closed', () => {
    const r = SettingsSchema.safeParse({ soundEnabled: true, terminalFontSize: 14 })
    expect(r.success).toBe(false)
  })

  it('out-of-range terminalFontSize fails closed (NOT silently clamped)', () => {
    const tooSmall = SettingsSchema.safeParse({
      version: 1,
      soundEnabled: true,
      terminalFontSize: TERMINAL_FONT_SIZE_MIN - 1
    })
    const tooBig = SettingsSchema.safeParse({
      version: 1,
      soundEnabled: true,
      terminalFontSize: TERMINAL_FONT_SIZE_MAX + 1
    })
    expect(tooSmall.success).toBe(false)
    expect(tooBig.success).toBe(false)
  })

  it('a non-integer terminalFontSize fails closed', () => {
    const r = SettingsSchema.safeParse({ version: 1, soundEnabled: true, terminalFontSize: 14.5 })
    expect(r.success).toBe(false)
  })

  it('a non-boolean soundEnabled fails closed', () => {
    const r = SettingsSchema.safeParse({ version: 1, soundEnabled: 'yes', terminalFontSize: 14 })
    expect(r.success).toBe(false)
  })

  it('a non-object blob fails closed (corrupt JSON value)', () => {
    expect(SettingsSchema.safeParse(null).success).toBe(false)
    expect(SettingsSchema.safeParse('garbage').success).toBe(false)
    expect(SettingsSchema.safeParse(42).success).toBe(false)
  })

  it('the boundaries (min/max) themselves are accepted', () => {
    expect(
      SettingsSchema.safeParse({
        version: 1,
        soundEnabled: true,
        terminalFontSize: TERMINAL_FONT_SIZE_MIN
      }).success
    ).toBe(true)
    expect(
      SettingsSchema.safeParse({
        version: 1,
        soundEnabled: true,
        terminalFontSize: TERMINAL_FONT_SIZE_MAX
      }).success
    ).toBe(true)
  })
})

describe('SettingsPatchSchema — partial, untrusted IPC arg (AC-6/7)', () => {
  it('accepts an empty patch', () => {
    expect(SettingsPatchSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a single-field patch (soundEnabled only)', () => {
    const r = SettingsPatchSchema.safeParse({ soundEnabled: false })
    expect(r.success).toBe(true)
    expect(r.success && r.data).toEqual({ soundEnabled: false })
  })

  it('accepts a single-field patch (terminalFontSize only)', () => {
    const r = SettingsPatchSchema.safeParse({ terminalFontSize: 20 })
    expect(r.success).toBe(true)
  })

  it('rejects an out-of-range terminalFontSize patch (untrusted input fails closed)', () => {
    expect(SettingsPatchSchema.safeParse({ terminalFontSize: 999 }).success).toBe(false)
  })

  it('rejects a non-boolean soundEnabled patch', () => {
    expect(SettingsPatchSchema.safeParse({ soundEnabled: 1 }).success).toBe(false)
  })

  it('a patch carrying `version` is IGNORED (version is owned by main, not the renderer)', () => {
    // The patch schema has no `version` field; Zod strips unknown keys, so a renderer
    // cannot rewrite the schema version through a patch.
    const r = SettingsPatchSchema.safeParse({ version: 99, soundEnabled: true })
    expect(r.success).toBe(true)
    expect(r.success && 'version' in r.data).toBe(false)
  })
})

// --- background-work timeout (the latch safety net; operator-configurable) ---
//
// The RETIRED `backgroundWorkTimeoutMinutes` field. It existed to bound how long a card
// could sit on `Working` after a turn ended with background work still running — a wait we
// had no way to end, because there is no "background task finished" hook. That guess is
// gone: a finishing background task WAKES the session by itself (probe-verified, claude
// 2.1.250 — the completion arrives as a `UserPromptSubmit`), and the turn it triggers ends
// with a fresh `Stop` carrying an empty `background_tasks`, so the card corrects itself in
// ~4s. Nothing times out any more, so the knob was removed.
//
// This test guards the REMOVAL, not the field: operators who ran the version that shipped
// it have the key sitting in their persisted settings file right now. Zod's default object
// stripping must drop it silently — if this ever fails closed instead, every one of those
// operators gets their sound and font-size reset on upgrade.
describe('backgroundWorkTimeoutMinutes — retired; a persisted blob carrying it still parses', () => {
  it('drops the stale key instead of failing closed, keeping the other settings', () => {
    const parsed = parseSettings({
      version: 1,
      soundEnabled: false,
      terminalFontSize: 16,
      backgroundWorkTimeoutMinutes: 45
    })
    expect(parsed.soundEnabled).toBe(false)
    expect(parsed.terminalFontSize).toBe(16)
    expect(parsed).not.toHaveProperty('backgroundWorkTimeoutMinutes')
  })

  it('the patch schema no longer accepts it as a settable field', () => {
    const parsed = SettingsPatchSchema.parse({ backgroundWorkTimeoutMinutes: 30 })
    expect(parsed).not.toHaveProperty('backgroundWorkTimeoutMinutes')
  })
})

// Attention reminders (spec 2026-09-10 D-12, §3). The two fields are ADDITIVE on the v1 shape:
// `.default()` fills them on a file written before they existed, so that file does not fail
// closed (a fail-closed read backs the file up and starts fresh — losing sound and font size).
describe('reminder settings — additive, default-filled, no version bump', () => {
  it('a v1 blob written before reminders parses, keeps sound + font size, and fills the defaults', () => {
    const parsed = parseSettings({ version: 1, soundEnabled: false, terminalFontSize: 16 })
    expect(parsed.soundEnabled).toBe(false)
    expect(parsed.terminalFontSize).toBe(16)
    expect(parsed.reminderCount).toBe(DEFAULT_REMINDER_COUNT)
    expect(parsed.reminderFirstDelayMinutes).toBe(DEFAULT_REMINDER_FIRST_DELAY_MINUTES)
  })

  it('defaults to 3 reminders, the first after 2 minutes, and stays at version 1', () => {
    expect(DEFAULT_REMINDER_COUNT).toBe(3)
    expect(DEFAULT_REMINDER_FIRST_DELAY_MINUTES).toBe(2)
    expect(DEFAULT_SETTINGS.reminderCount).toBe(3)
    expect(DEFAULT_SETTINGS.reminderFirstDelayMinutes).toBe(2)
    expect(SETTINGS_VERSION).toBe(1)
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
  })

  it('offers exactly 0–5 reminders and first delays of 1, 2, 5, 10, 15 min', () => {
    expect(REMINDER_COUNT_MAX).toBe(5)
    expect([...REMINDER_FIRST_DELAY_OPTIONS]).toEqual([1, 2, 5, 10, 15])
  })

  it('accepts every offered count and delay', () => {
    for (let count = 0; count <= REMINDER_COUNT_MAX; count++) {
      for (const delay of REMINDER_FIRST_DELAY_OPTIONS) {
        const r = SettingsSchema.safeParse({
          ...DEFAULT_SETTINGS,
          reminderCount: count,
          reminderFirstDelayMinutes: delay
        })
        expect(r.success).toBe(true)
      }
    }
  })

  it.each([-1, 6, 2.5, '3'])('a reminderCount of %j fails closed', (bad) => {
    expect(SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, reminderCount: bad }).success).toBe(
      false
    )
  })

  it.each([0, 3, 7, 60, '2'])(
    'a reminderFirstDelayMinutes of %j (not offered) fails closed',
    (bad) => {
      const r = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, reminderFirstDelayMinutes: bad })
      expect(r.success).toBe(false)
    }
  )

  // THE PATCH TRAP (§3): a defaulted field inside a `.partial()` patch is FILLED by zod, so a
  // patch that only toggles sound would silently reset the operator's reminder count. The patch
  // schema must declare these fields WITHOUT a default.
  it('a sound-only patch carries NO reminder keys', () => {
    const p = SettingsPatchSchema.parse({ soundEnabled: false })
    expect(p).toEqual({ soundEnabled: false })
    expect(p).not.toHaveProperty('reminderCount')
    expect(p).not.toHaveProperty('reminderFirstDelayMinutes')
  })

  it('the patch schema validates each reminder field', () => {
    expect(SettingsPatchSchema.parse({ reminderCount: 0 })).toEqual({ reminderCount: 0 })
    expect(SettingsPatchSchema.parse({ reminderFirstDelayMinutes: 5 })).toEqual({
      reminderFirstDelayMinutes: 5
    })
    expect(SettingsPatchSchema.safeParse({ reminderCount: 6 }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ reminderFirstDelayMinutes: 7 }).success).toBe(false)
  })
})

describe('expanderKey — the one Ctrl+Alt letter that opens the shortcut box', () => {
  it('defaults to X on a pre-change v1 blob', () => {
    const parsed = parseSettings({ version: 1, soundEnabled: true, terminalFontSize: 14 })
    expect(parsed.expanderKey).toBe('X')
    expect(DEFAULT_EXPANDER_KEY).toBe('X')
    expect(DEFAULT_SETTINGS.expanderKey).toBe('X')
  })

  it('round-trips a stored letter', () => {
    expect(
      parseSettings({ version: 1, soundEnabled: true, terminalFontSize: 14, expanderKey: 'Q' })
        .expanderKey
    ).toBe('Q')
  })

  it.each([['x'], ['XX'], [''], ['1'], ['Ctrl+Alt+X']])('rejects %s in the blob', (bad) => {
    expect(() =>
      parseSettings({ version: 1, soundEnabled: true, terminalFontSize: 14, expanderKey: bad })
    ).toThrow()
  })

  it('the patch accepts a single upper-case letter and nothing else', () => {
    expect(SettingsPatchSchema.parse({ expanderKey: 'Q' })).toEqual({ expanderKey: 'Q' })
    expect(SettingsPatchSchema.safeParse({ expanderKey: 'q' }).success).toBe(false)
    // No `.default()` on the patch: a sound-only patch must NOT carry a key.
    expect(SettingsPatchSchema.parse({ soundEnabled: false })).not.toHaveProperty('expanderKey')
  })

  it('expanderChord renders the chord the terminal compares against', () => {
    expect(expanderChord('X')).toBe('Ctrl+Alt+X')
  })
})

// The programmatic API's two settings. ADDITIVE on the v1 shape, same `.default()` reasoning as
// the reminder fields: a file written before the API existed must not fail closed (that would
// back it up and start fresh, losing every other setting). The port is range-gated because the
// listener binds it — a privileged (<1024) or impossible (>65535) port is corrupt input, not a
// preference, and the patch schema carries NO default so a sound-only patch cannot reset it.
describe('settings — programmatic API fields', () => {
  it('a v1 blob without the API keys parses with the API off on port 9281', () => {
    // A real pre-API v1 file: the two keys are absent, not undefined. (Written with `delete`
    // rather than a rest-destructure because the discarded bindings trip no-unused-vars.)
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete old.apiEnabled
    delete old.apiPort
    expect(parseSettings(old)).toMatchObject({ apiEnabled: false, apiPort: DEFAULT_API_PORT })
  })
  it('rejects a port below 1024 or above 65535, or a non-integer', () => {
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, apiPort: 80 })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, apiPort: 70000 })).toThrow()
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, apiPort: 9281.5 })).toThrow()
  })
  it('a patch without the API keys does not fill them (no default on the patch)', () => {
    expect(SettingsPatchSchema.parse({ soundEnabled: false })).toEqual({ soundEnabled: false })
  })
  it('a patch can carry them', () => {
    expect(SettingsPatchSchema.parse({ apiEnabled: true, apiPort: 9300 })).toEqual({
      apiEnabled: true,
      apiPort: 9300
    })
  })
})

describe('settings.themeId (custom themes, additive on v1)', () => {
  it('defaults to "default" on a v1 blob written before themes existed', () => {
    const r = SettingsSchema.safeParse({ version: 1, soundEnabled: true, terminalFontSize: 14 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.themeId).toBe('default')
  })
  it('accepts a folder id and fails closed on one that is not an id', () => {
    const base = { version: 1, soundEnabled: true, terminalFontSize: 14 }
    expect(SettingsSchema.safeParse({ ...base, themeId: 'liquid-glass' }).success).toBe(true)
    expect(SettingsSchema.safeParse({ ...base, themeId: 'Liquid Glass' }).success).toBe(false)
    expect(SettingsSchema.safeParse({ ...base, themeId: '../x' }).success).toBe(false)
  })
  it('the patch accepts themeId and a themeId-only patch fills nothing else', () => {
    expect(SettingsPatchSchema.parse({ themeId: 'paper' })).toEqual({ themeId: 'paper' })
    expect(SettingsPatchSchema.safeParse({ themeId: 'Bad' }).success).toBe(false)
  })
  it('DEFAULT_SETTINGS.themeId is default', () => {
    expect(DEFAULT_SETTINGS.themeId).toBe('default')
  })
})

describe('settings.wallpaperByTheme (theme wallpapers, additive on v1)', () => {
  const base = { version: 1, soundEnabled: true, terminalFontSize: 14 }
  it('defaults to {} on a v1 blob written before wallpapers existed', () => {
    const r = SettingsSchema.safeParse(base)
    expect(r.success && r.data.wallpaperByTheme).toEqual({})
  })
  it('accepts theme id → wallpaper id and fails closed on a non-id key or value', () => {
    const ok = { 'liquid-glass': 'aurora' }
    expect(SettingsSchema.safeParse({ ...base, wallpaperByTheme: ok }).success).toBe(true)
    expect(
      SettingsSchema.safeParse({ ...base, wallpaperByTheme: { 'Bad Key': 'a' } }).success
    ).toBe(false)
    expect(SettingsSchema.safeParse({ ...base, wallpaperByTheme: { g: '../a' } }).success).toBe(
      false
    )
  })
  it(`fails closed past ${WALLPAPER_BY_THEME_MAX} entries`, () => {
    const many = Object.fromEntries(
      Array.from({ length: WALLPAPER_BY_THEME_MAX + 1 }, (_, i) => [`t${i}`, 'a'])
    )
    expect(SettingsSchema.safeParse({ ...base, wallpaperByTheme: many }).success).toBe(false)
  })
  it('the patch accepts the map and a map-only patch fills nothing else', () => {
    expect(SettingsPatchSchema.parse({ wallpaperByTheme: { g: 'a' } })).toEqual({
      wallpaperByTheme: { g: 'a' }
    })
    expect(SettingsPatchSchema.parse({ themeId: 'paper' })).toEqual({ themeId: 'paper' })
  })
  it('DEFAULT_SETTINGS.wallpaperByTheme is {}', () => {
    expect(DEFAULT_SETTINGS.wallpaperByTheme).toEqual({})
  })
})

describe('settings.notificationsEnabled (UX-13, additive on v1)', () => {
  it('a v1 blob written before the toggle existed keeps its popups ON', () => {
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete old.notificationsEnabled
    expect(parseSettings(old).notificationsEnabled).toBe(true)
  })
  it('a patch carries it, and a patch without it does not fill it', () => {
    expect(SettingsPatchSchema.parse({ notificationsEnabled: false })).toEqual({
      notificationsEnabled: false
    })
    expect(SettingsPatchSchema.parse({ soundEnabled: true })).toEqual({ soundEnabled: true })
  })
})
