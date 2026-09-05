// Phrase shortcuts — the shortcut shape and its IPC/file boundaries. OUR shape (fail-closed,
// NO passthrough, mirrors template.ts). NEVER log a shortcut value: `text` is operator prose
// bound for an LLM prompt and `name` is operator text — log path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'

export const SHORTCUT_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH
export const SHORTCUT_TEXT_MAX_LENGTH = 500

/**
 * The ONLY legal chord shape (spec S-2): exactly `Ctrl+Shift+<A-Z>`.
 *
 * Why Ctrl+Shift and nothing else: a PTY cannot encode Ctrl+Shift+<letter> distinctly from
 * Ctrl+<letter> (both send the same control byte), so terminal applications — claude and
 * readline included — never bind it; by convention it belongs to the terminal EMULATOR. Taking
 * it steals nothing from the agent, which UX-DR21 requires ("within the terminal, all keystrokes
 * belong to the agent; only modifier-chords apply").
 */
export const SHORTCUT_KEYS_PATTERN = /^Ctrl\+Shift\+[A-Z]$/

/**
 * Letters this app or the Electron/Chromium default menu already answers to.
 *
 * N/Q/W: `src/renderer/src/App.tsx`'s global keydown handler has NO `shiftKey` guard and matches
 * BOTH cases of the letter (`e.key === 'n' || e.key === 'N'`), so Ctrl+Shift+N/Q/W already fire
 * New-session / Quit / Stop-confirm today.
 * I/R: Electron's default application menu (never replaced — main only builds a Tray menu) binds
 * Ctrl+Shift+I (toggle DevTools) and Ctrl+Shift+R (force reload).
 * J/C: the Chromium DevTools conventions.
 */
export const RESERVED_SHORTCUT_LETTERS = ['N', 'Q', 'W', 'I', 'J', 'C', 'R'] as const

/**
 * True when `letter` is one the app or the Electron/Chromium defaults already own.
 *
 * Exported so the schema and the renderer's chord recorder ask ONE question rather than each
 * re-deriving the membership test (and its cast) over the readonly tuple.
 */
export function isReservedShortcutLetter(letter: string): boolean {
  return (RESERVED_SHORTCUT_LETTERS as readonly string[]).includes(letter)
}

/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const ShortcutNameSchema = SessionNameSchema

/** Not `.uuid()` — existence is the store's call (`shortcut_not_found`), the reasoning already
 *  recorded for SessionRenameSchema in launch.ts. */
export const ShortcutIdSchema = z.string().min(1)

export const ShortcutKeysSchema = z
  .string()
  .regex(SHORTCUT_KEYS_PATTERN, { error: 'must be Ctrl+Shift+<A-Z>' })
  // The pattern guarantees the last character IS the letter.
  .refine((k) => !isReservedShortcutLetter(k.slice(-1)), {
    error: 'that chord is reserved by the app'
  })

/**
 * The phrase. NOT trimmed — a trailing space is meaningful for a phrase the operator will
 * continue after ("run the tests and "), so the stored value keeps it; the refine only REJECTS
 * a whitespace-only phrase, it never rewrites the value.
 *
 * The control-character ban does double duty (spec S-1): it makes a submitting `\r` and an
 * injected ANSI escape structurally impossible, so "type, never submit" is enforced by the
 * schema rather than by convention.
 */
export const ShortcutTextSchema = z
  .string()
  .min(1)
  .max(SHORTCUT_TEXT_MAX_LENGTH)
  .regex(/^[^\p{Cc}]+$/u, { error: 'must not contain control characters' })
  .refine((t) => t.trim().length > 0, { error: 'must not be blank' })

export const ShortcutSchema = z.object({
  id: ShortcutIdSchema,
  name: ShortcutNameSchema,
  keys: ShortcutKeysSchema,
  text: ShortcutTextSchema
})
export type Shortcut = z.infer<typeof ShortcutSchema>

/** `shortcuts:save` arg — no id ⇒ create; id ⇒ update. */
export const ShortcutSaveSchema = ShortcutSchema.omit({ id: true }).extend({
  id: ShortcutIdSchema.optional()
})
export type ShortcutSaveRequest = z.infer<typeof ShortcutSaveSchema>

/** `shortcuts:delete` arg. */
export const ShortcutDeleteSchema = z.object({ id: ShortcutIdSchema })
export type ShortcutDeleteRequest = z.infer<typeof ShortcutDeleteSchema>

export const SHORTCUTS_FILE_VERSION = 1 as const
export const ShortcutsFileSchema = z.object({
  version: z.literal(SHORTCUTS_FILE_VERSION),
  shortcuts: z.array(ShortcutSchema)
})
export type ShortcutsFile = z.infer<typeof ShortcutsFileSchema>

export const EMPTY_SHORTCUTS_FILE: ShortcutsFile = {
  version: SHORTCUTS_FILE_VERSION,
  shortcuts: []
}
