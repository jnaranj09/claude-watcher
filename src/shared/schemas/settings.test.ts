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
  parseSettings,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  type Settings
} from './settings'

describe('SettingsSchema — versioned, our-shape, fail-closed (AC-4/5/6)', () => {
  it('round-trips a valid v1 shape and the version field is present', () => {
    const valid: Settings = {
      version: 1,
      soundEnabled: false,
      terminalFontSize: 16
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
