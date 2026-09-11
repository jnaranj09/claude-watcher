// Story 2.4 — the versioned Zod settings adapter (the FIRST persistence shape).
//
// This is OUR shape, NOT c9watch's — so the fail-closed posture is the OPPOSITE of
// `src/shared/schemas/session.ts`: that adapter uses `.passthrough()` so c9watch
// ADDITIONS pass and only known-key malformations fail (drift-tolerant). Settings is
// a shape WE own end-to-end, so it does NOT `.passthrough()` — an unknown/malformed
// blob is treated as corrupt and FAILS CLOSED (the persisted-file boundary then backs
// up the bad file + starts fresh; the IPC-arg boundary throws a typed error). This is
// the deliberate difference from the c9watch additions-pass rule.
// [Source: src/shared/schemas/session.ts (schema-style precedent — note the difference);
//  .claude/rules/zod-boundaries.md (persisted-file = back up + start fresh; renderer→main
//  IPC arg = parse-and-throw-typed); architecture.md "versioned persistence"]
//
// NEVER-LOG-THE-VALUE (Critical Guardrail #6): a ZodError stringifies its INPUT. The
// settings blob carries operator preferences (not secrets today, but the rule is
// uniform) — callers that catch a parse failure log the error PATH + CODE only, never
// the value. The store + IPC handlers below follow this.

import { z } from 'zod'

/** The current persisted-settings schema version. Bumping this is how a future
 *  migration is introduced (the store reads `version` and migrates older blobs).
 *  Versioning the shape NOW keeps additions (e.g. the Epic-4 window-bounds row)
 *  non-breaking. [architecture.md "versioned persistence"] */
export const SETTINGS_VERSION = 1 as const

/** Terminal font-size clamp (px). The control + persistence cover this range; values
 *  outside it FAIL CLOSED (corrupt → defaults on a file read; throw on an IPC set).
 *  Epic-3's embedded terminal will CONSUME this value (no terminal exists yet to
 *  preview it — F5). [DESIGN.md:208 — font-size is operator-controllable, not bound
 *  by the chrome type-ramp] */
export const TERMINAL_FONT_SIZE_MIN = 8
export const TERMINAL_FONT_SIZE_MAX = 32
/** Default terminal font-size (px) — a comfortable legible default (EXPERIENCE.md:135). */
export const DEFAULT_TERMINAL_FONT_SIZE = 14

/** Attention reminders (spec 2026-09-10). How many times a session still blocked on a permission
 *  prompt or a question is re-notified after the first alert. 0 = off (no separate toggle). */
export const REMINDER_COUNT_MAX = 5
/** The first-reminder delays the Settings dropdown offers, in minutes. Every later gap doubles
 *  the one before (`src/shared/attention/reminderSchedule.ts`). A stored value outside this list
 *  fails closed, so the dropdown can never sit on a value it does not offer. */
export const REMINDER_FIRST_DELAY_OPTIONS = [1, 2, 5, 10, 15] as const
export type ReminderFirstDelayMinutes = (typeof REMINDER_FIRST_DELAY_OPTIONS)[number]
/** Defaults: 3 reminders, the first after 2 min → +2, +6, +14 min. */
export const DEFAULT_REMINDER_COUNT = 3
export const DEFAULT_REMINDER_FIRST_DELAY_MINUTES: ReminderFirstDelayMinutes = 2

const ReminderCountSchema = z.number().int().min(0).max(REMINDER_COUNT_MAX)
const ReminderFirstDelaySchema = z.literal(REMINDER_FIRST_DELAY_OPTIONS)

/**
 * The versioned settings shape (v1): `version` + `soundEnabled` + `terminalFontSize` +
 * `reminderCount` + `reminderFirstDelayMinutes`.
 *
 * - `version` is a `z.literal(SETTINGS_VERSION)` — a blob carrying a DIFFERENT version
 *   fails THIS schema (the store treats that as a no-known-migration → corrupt → fresh).
 * - `soundEnabled` defaults to `true` (sound default ON — UX-DR26).
 * - `terminalFontSize` is an integer clamped to [MIN, MAX]; out-of-range FAILS CLOSED.
 * - `reminderCount` / `reminderFirstDelayMinutes` are ADDITIVE on the v1 shape: they
 *   `.default()` so a v1 blob written before they existed still parses (see below).
 *
 * NO `.passthrough()` (this is our shape — unknown keys are not silently kept). `.strict()`
 * is intentionally NOT used either: a future version may add fields, and the version gate
 * is the migration seam — but for v1 reads/writes we validate exactly these fields and
 * IGNORE nothing silently beyond what Zod's default object stripping does (unknown keys
 * are dropped, not failed; a MALFORMED known key fails closed, which is the load-bearing
 * guarantee for AC-6).
 */
export const SettingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  soundEnabled: z.boolean(),
  terminalFontSize: z.number().int().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX),
  // Attention reminders. `.default()` is LOAD-BEARING, not a convenience: a v1 file written
  // before these fields existed has no such keys, and without the default the WHOLE file would
  // fail closed → backup → start fresh (the operator's sound and font size lost). This is why
  // SETTINGS_VERSION stays 1.
  reminderCount: ReminderCountSchema.default(DEFAULT_REMINDER_COUNT),
  reminderFirstDelayMinutes: ReminderFirstDelaySchema.default(DEFAULT_REMINDER_FIRST_DELAY_MINUTES)
})

/** The settings type — INFERRED from the schema (one source of truth). */
export type Settings = z.infer<typeof SettingsSchema>

/**
 * A PARTIAL settings patch — the renderer→main `settings:set` payload. Every field is
 * optional EXCEPT it must NOT carry `version` (the version is owned by main; a renderer
 * cannot rewrite the schema version). A patch is parse-and-throw-typed at the IPC arg
 * boundary; the store then MERGES it onto the current settings and re-validates the
 * whole shape. An out-of-range `terminalFontSize` or a non-boolean `soundEnabled` here
 * FAILS CLOSED (throws) — untrusted cross-process input. [zod-boundaries.md IPC-arg row]
 */
export const SettingsPatchSchema = z
  .object({
    soundEnabled: z.boolean(),
    terminalFontSize: z.number().int().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX),
    // NO `.default()` here, and never derive this schema from SettingsSchema: zod FILLS a
    // defaulted field inside a `.partial()` object, so a sound-only patch would silently reset
    // the reminder count to its default (verified on zod 4.4.3).
    reminderCount: ReminderCountSchema,
    reminderFirstDelayMinutes: ReminderFirstDelaySchema
  })
  .partial()

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

/**
 * The fresh-start default — used on first install AND on corrupt-read recovery (AC-6).
 * Sound default ON (UX-DR26); a comfortable terminal font-size (Epic-3 will consume it).
 */
export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  soundEnabled: true,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  reminderCount: DEFAULT_REMINDER_COUNT,
  reminderFirstDelayMinutes: DEFAULT_REMINDER_FIRST_DELAY_MINUTES
}

/**
 * Parse an unknown blob into a validated `Settings`, or THROW a Zod error on invalid
 * input. Used by BOTH boundaries:
 *   - the persisted-file read (the store catches the throw → backs up + starts fresh);
 *   - the IPC `settings:set` arg path validates a PATCH (via `SettingsPatchSchema`),
 *     merges, then re-validates the full shape via THIS helper before persisting.
 * On invalid input the underlying Zod parse throws — callers handle/log by error PATH +
 * CODE only, NEVER the parsed value (Guardrail #6).
 */
export function parseSettings(raw: unknown): Settings {
  return SettingsSchema.parse(raw)
}
