// Phrase shortcuts — PURE form helpers, unit-tested without React. No store access, no window
// access. Chord PARSING is deliberately not here: it lives in src/renderer/src/shortcuts/chord.ts
// so the dialog recorder and the terminal matcher share ONE definition of a chord.
import {
  shortcutKeysId,
  ShortcutSaveSchema,
  type Shortcut,
  type ShortcutSaveRequest
} from '../../../../shared/schemas/shortcut'

export interface ShortcutDraft {
  /** null ⇒ a NEW shortcut (create); a string ⇒ an update. */
  id: string | null
  name: string
  /** 1..3 chords; [] while the operator has not recorded one yet. */
  keys: string[]
  text: string
  /** Workspaces — round-trips the shortcut's scope through the draft UNCHANGED. There is no
   *  picker for it yet (Task 11 adds one); this field exists purely so `toDraft` →
   *  `draftToSaveRequest` does not silently reset an existing scope to GLOBAL on every edit. */
  workspaceId: string | null
}

export function emptyDraft(): ShortcutDraft {
  return { id: null, name: '', keys: [], text: '', workspaceId: null }
}

export function toDraft(shortcut: Shortcut): ShortcutDraft {
  // Copy the array: the draft is replaced wholesale by the recorder and must not alias store
  // state, which is a projection of main's truth.
  return {
    id: shortcut.id,
    name: shortcut.name,
    keys: [...shortcut.keys],
    text: shortcut.text,
    workspaceId: shortcut.workspaceId
  }
}

export type DraftResult = { ok: true; req: ShortcutSaveRequest } | { ok: false; error: 'invalid' }

/** Runs the SAME schema main will run, so the form can disable Save before any IPC round-trip. */
export function draftToSaveRequest(draft: ShortcutDraft): DraftResult {
  // Workspaces — workspaceId round-trips from the draft (toDraft copied it from the base
  // shortcut; a NEW draft's is null, i.e. GLOBAL, via emptyDraft). main's save() has no
  // partial-update path, so this dialog must re-send the existing scope on every edit or lose
  // it. There is still no PICKER here (Task 11 adds one) — this only stops an edit from
  // silently resetting an already-scoped shortcut to GLOBAL.
  const candidate =
    draft.id === null
      ? { name: draft.name, keys: draft.keys, text: draft.text, workspaceId: draft.workspaceId }
      : {
          id: draft.id,
          name: draft.name,
          keys: draft.keys,
          text: draft.text,
          workspaceId: draft.workspaceId
        }
  const parsed = ShortcutSaveSchema.safeParse(candidate)
  // NEVER surface the ZodError itself — it stringifies its input, which is operator content.
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return { ok: true, req: parsed.data }
}

// Task 11 — workspaceId IS part of this comparison now: the scope select is a real control, so
// changing ONLY the scope must mark the draft dirty or the operator has no way to save the
// change they just made (Save stays disabled forever).
export function isDraftDirty(draft: ShortcutDraft, shortcut: Shortcut | null): boolean {
  const base = shortcut === null ? emptyDraft() : toDraft(shortcut)
  return (
    draft.name !== base.name ||
    // By VALUE — two equal sequences are different array objects.
    shortcutKeysId(draft.keys) !== shortcutKeysId(base.keys) ||
    draft.text !== base.text ||
    draft.workspaceId !== base.workspaceId
  )
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
