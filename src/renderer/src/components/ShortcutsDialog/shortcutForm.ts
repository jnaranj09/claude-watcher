// Phrase shortcuts — PURE form helpers, unit-tested without React (the widest test table lives
// on this file). No store access, no window access.
import {
  isReservedShortcutLetter,
  SHORTCUT_KEYS_PATTERN,
  ShortcutSaveSchema,
  type Shortcut,
  type ShortcutSaveRequest
} from '../../../../shared/schemas/shortcut'

export interface ShortcutDraft {
  /** null ⇒ a NEW shortcut (create); a string ⇒ an update. */
  id: string | null
  name: string
  keys: string
  text: string
}

export function emptyDraft(): ShortcutDraft {
  return { id: null, name: '', keys: '', text: '' }
}

export function toDraft(shortcut: Shortcut): ShortcutDraft {
  return { id: shortcut.id, name: shortcut.name, keys: shortcut.keys, text: shortcut.text }
}

/**
 * The canonical chord for a keydown, or null when the combination is not a legal shortcut.
 *
 * Uses `event.key` (NOT `event.code`) so recording and matching agree on any keyboard layout:
 * `event.code` is physical-position based, so on AZERTY it reports `KeyQ` for the key that
 * prints "A". `event.key` is the character the operator actually sees. The terminal-side
 * matcher in EmbeddedTerminal.tsx canonicalizes the same way.
 */
export function chordFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null
  const letter = event.key.toUpperCase()
  if (!/^[A-Z]$/.test(letter)) return null
  return `Ctrl+Shift+${letter}`
}

export type ChordProblem = 'shape' | 'reserved'

/** null ⇒ the chord is legal. */
export function chordProblem(keys: string): ChordProblem | null {
  if (!SHORTCUT_KEYS_PATTERN.test(keys)) return 'shape'
  if (isReservedShortcutLetter(keys.slice(-1))) return 'reserved'
  return null
}

export type DraftResult = { ok: true; req: ShortcutSaveRequest } | { ok: false; error: 'invalid' }

/** Runs the SAME schema main will run, so the form can disable Save before any IPC round-trip. */
export function draftToSaveRequest(draft: ShortcutDraft): DraftResult {
  const candidate =
    draft.id === null
      ? { name: draft.name, keys: draft.keys, text: draft.text }
      : { id: draft.id, name: draft.name, keys: draft.keys, text: draft.text }
  const parsed = ShortcutSaveSchema.safeParse(candidate)
  // NEVER surface the ZodError itself — it stringifies its input, which is operator content.
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return { ok: true, req: parsed.data }
}

export function isDraftDirty(draft: ShortcutDraft, shortcut: Shortcut | null): boolean {
  const base = shortcut === null ? emptyDraft() : toDraft(shortcut)
  return draft.name !== base.name || draft.keys !== base.keys || draft.text !== base.text
}

export type ShortcutErrorCode = 'shortcut_keys_taken' | 'shortcut_not_found' | 'unknown'

/**
 * Map a rejected save to a code the dialog can render.
 *
 * Matched with `.includes(...)`, not `===`: main throws `new Error('shortcut_keys_taken')` and
 * Electron wraps it as `Error invoking remote method '…': Error: <msg>` on the way across the
 * seam. Same reasoning (and the same verified behavior) as `templateErrorMessage` in
 * TemplatesDialog/templateForm.ts.
 */
export function shortcutErrorCode(err: unknown): ShortcutErrorCode {
  const message = err instanceof Error ? err.message : ''
  if (message.includes('shortcut_keys_taken')) return 'shortcut_keys_taken'
  if (message.includes('shortcut_not_found')) return 'shortcut_not_found'
  return 'unknown'
}

export const SHORTCUT_ERROR_COPY: Record<ShortcutErrorCode, string> = {
  shortcut_keys_taken: 'That chord is already used by another shortcut.',
  shortcut_not_found: 'That shortcut no longer exists.',
  unknown: 'Could not save the shortcut.'
}
