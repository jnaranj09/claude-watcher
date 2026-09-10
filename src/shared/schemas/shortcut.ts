// Phrase shortcuts — the shortcut shape and its IPC/file boundaries. A binding is a SEQUENCE of
// 1..3 `Ctrl+Alt+<A-Z>` chords. OUR shape (fail-closed, NO passthrough, mirrors template.ts).
// NEVER log a shortcut value: `text` is operator prose bound for an LLM prompt and `name` is
// operator text — log path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'
import { WorkspaceIdSchema } from './workspace'

export const SHORTCUT_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH
export const SHORTCUT_TEXT_MAX_LENGTH = 500

/**
 * The ONLY legal CHORD shape: exactly `Ctrl+Alt+<A-Z>`.
 *
 * Why Ctrl+Alt and not Ctrl+Shift (which the first version used): the operator asked for the
 * freedom of all 26 letters plus multi-chord sequences. Ctrl+Alt IS encodable by a PTY — xterm
 * sends `ESC` + the control byte — so this namespace CAN shadow a terminal binding (bash
 * readline's default emacs keymap binds twelve `\e\C-<letter>` sequences). That cost is bounded
 * and chosen: only the letters the operator actually binds are shadowed, and an UNMATCHED
 * Ctrl+Alt chord falls through to the pty completely untouched. [design §5 hazard 3]
 *
 * There are NO reserved letters. `App.tsx`'s three global guards carry an `!e.altKey` term so
 * Ctrl+Alt+N/Q/W cannot double-fire the app, and neither the Electron default menu
 * (Ctrl+Shift+I/R) nor the Chromium DevTools conventions (Ctrl+Shift+J/C) live in this namespace.
 */
export const SHORTCUT_CHORD_PATTERN = /^Ctrl\+Alt\+[A-Z]$/

/** A binding is 1..3 chords. Depth 3 is the operator's stated limit. */
export const SHORTCUT_SEQUENCE_MAX_CHORDS = 3

/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const ShortcutNameSchema = SessionNameSchema

/** Not `.uuid()` — existence is the store's call (`shortcut_not_found`), the reasoning already
 *  recorded for SessionRenameSchema in launch.ts. */
export const ShortcutIdSchema = z.string().min(1)

export const ShortcutChordSchema = z
  .string()
  .regex(SHORTCUT_CHORD_PATTERN, { error: 'must be Ctrl+Alt+<A-Z>' })

/**
 * An ARRAY, not a delimited string: the matcher compares sequences, and a per-element schema
 * reports `path = ['keys', 1]` so the fail-closed log (PATH + CODE only, never the value) still
 * says something useful. A delimited string collapses every malformation into one opaque issue.
 */
export const ShortcutKeysSchema = z
  .array(ShortcutChordSchema)
  .min(1, { error: 'needs at least one chord' })
  .max(SHORTCUT_SEQUENCE_MAX_CHORDS, { error: 'at most 3 chords' })

/**
 * The canonical identity AND display form of a sequence — `"Ctrl+Alt+O Ctrl+Alt+A"`.
 *
 * ONE question asked in ONE place: main's uniqueness test, main's list ordering, the matcher's
 * index keys, the dialog's Keybinding column and the terminal's pending indicator all call this,
 * so they cannot drift. (Replaces the `isReservedShortcutLetter` helper, which followed the same
 * "one shared membership question" convention.) VSCode renders chorded bindings the same way.
 */
export function shortcutKeysId(keys: readonly string[]): string {
  return keys.join(' ')
}

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
  text: ShortcutTextSchema,
  // Workspaces — the item-level scope. Same field, same backward-compat reasoning as
  // `Template.workspaceId` in template.ts: null ⇒ GLOBAL, `.default(null)` protects a
  // pre-change file from failing closed. Do NOT bump SHORTCUTS_FILE_VERSION instead.
  workspaceId: WorkspaceIdSchema.nullable().default(null)
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

/**
 * 2: `keys` became a 1..3 chord ARRAY in the Ctrl+Alt namespace. There is deliberately NO
 * migration — the feature never shipped and no such file exists on any machine, so a stale v1
 * file takes the store's EXISTING corrupt path (backed up beside itself, list starts empty,
 * code-only log). [design §7]
 */
export const SHORTCUTS_FILE_VERSION = 2 as const
export const ShortcutsFileSchema = z.object({
  version: z.literal(SHORTCUTS_FILE_VERSION),
  shortcuts: z.array(ShortcutSchema)
})
export type ShortcutsFile = z.infer<typeof ShortcutsFileSchema>

export const EMPTY_SHORTCUTS_FILE: ShortcutsFile = {
  version: SHORTCUTS_FILE_VERSION,
  shortcuts: []
}
