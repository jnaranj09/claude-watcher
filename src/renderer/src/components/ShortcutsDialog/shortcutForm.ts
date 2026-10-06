// Phrase shortcuts — PURE form helpers, unit-tested without React. No store access, no window
// access. The "Open with" chord recorder uses src/renderer/src/shortcuts/chord.ts directly.
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import {
  SHORTCUT_ALIAS_MAX_LENGTH,
  SHORTCUT_NAME_MAX_LENGTH,
  SHORTCUT_TEXT_MAX_LENGTH,
  ShortcutSaveSchema,
  scanPlaceholders,
  type Shortcut,
  type ShortcutSaveRequest
} from '../../../../shared/schemas/shortcut'

export interface ShortcutDraft {
  /** null ⇒ a NEW shortcut (create); a string ⇒ an update. */
  id: string | null
  name: string
  /** The word typed first in the box. Kept as typed here; the schema lowercases on save. */
  alias: string
  text: string
  workspaceId: string | null
}

export function emptyDraft(): ShortcutDraft {
  return { id: null, name: '', alias: '', text: '', workspaceId: null }
}

export function toDraft(shortcut: Shortcut): ShortcutDraft {
  return {
    id: shortcut.id,
    name: shortcut.name,
    alias: shortcut.alias,
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
  // it.
  const candidate =
    draft.id === null
      ? { name: draft.name, alias: draft.alias, text: draft.text, workspaceId: draft.workspaceId }
      : {
          id: draft.id,
          name: draft.name,
          alias: draft.alias,
          text: draft.text,
          workspaceId: draft.workspaceId
        }
  const parsed = ShortcutSaveSchema.safeParse(candidate)
  // NEVER surface the ZodError itself — it stringifies its input, which is operator content.
  if (!parsed.success) return { ok: false, error: 'invalid' }
  return { ok: true, req: parsed.data }
}

/**
 * R26 — WHY Save is disabled, as operator copy, or null when the draft saves. Runs the same schema
 * as `draftToSaveRequest` and picks the sentence by the failing FIELD (the issue path) plus the
 * draft's own shape — never the ZodError's message, which is our copy for logs, not the operator.
 */
export function shortcutDraftProblem(draft: ShortcutDraft): string | null {
  const parsed = ShortcutSaveSchema.safeParse({
    name: draft.name,
    alias: draft.alias,
    text: draft.text,
    workspaceId: draft.workspaceId
  })
  if (parsed.success) return null
  const field = String(parsed.error.issues[0]?.path[0] ?? '')
  if (field === 'name')
    return `Give the shortcut a name, up to ${SHORTCUT_NAME_MAX_LENGTH} characters.`
  if (field === 'alias') {
    return draft.alias.trim() === ''
      ? 'Give the shortcut an alias.'
      : `The alias is letters and digits only, up to ${SHORTCUT_ALIAS_MAX_LENGTH}.`
  }
  if (field === 'text') {
    if (draft.text.trim() === '') return 'Type the phrase.'
    const { numbers } = scanPlaceholders(draft.text)
    for (let n = 1; n <= numbers.size; n++) {
      if (!numbers.has(n)) return 'Use $1, $2… in order, with no gap.'
    }
    if (draft.text.length > SHORTCUT_TEXT_MAX_LENGTH)
      return `The phrase is up to ${SHORTCUT_TEXT_MAX_LENGTH} characters.`
    return 'The phrase cannot hold tabs or other control characters.'
  }
  return 'Finish the shortcut before saving.'
}

// Task 11 — workspaceId IS part of this comparison now: the scope select is a real control, so
// changing ONLY the scope must mark the draft dirty or the operator has no way to save the
// change they just made (Save stays disabled forever).
export function isDraftDirty(draft: ShortcutDraft, shortcut: Shortcut | null): boolean {
  const base = shortcut === null ? emptyDraft() : toDraft(shortcut)
  return (
    draft.name !== base.name ||
    draft.alias !== base.alias ||
    draft.text !== base.text ||
    draft.workspaceId !== base.workspaceId
  )
}

export type ShortcutErrorCode =
  | 'shortcut_alias_taken'
  | 'shortcut_not_found'
  | typeof STORE_WRITE_FAILED
  | 'unknown'

/**
 * Map a rejected save to a code the dialog can render.
 *
 * Matched with `.includes(...)`, not `===`: main throws `new Error('shortcut_alias_taken')` and
 * Electron wraps it as `Error invoking remote method '…': Error: <msg>` on the way across the
 * seam. Same reasoning (and the same verified behavior) as `templateErrorMessage` in
 * TemplatesDialog/templateForm.ts.
 */
export function shortcutErrorCode(err: unknown): ShortcutErrorCode {
  const message = err instanceof Error ? err.message : ''
  if (message.includes('shortcut_alias_taken')) return 'shortcut_alias_taken'
  if (message.includes('shortcut_not_found')) return 'shortcut_not_found'
  if (message.includes(STORE_WRITE_FAILED)) return STORE_WRITE_FAILED
  return 'unknown'
}

export const SHORTCUT_ERROR_COPY: Record<ShortcutErrorCode, string> = {
  shortcut_alias_taken: 'That alias is already used by another shortcut.',
  shortcut_not_found: 'That shortcut no longer exists.',
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY,
  unknown: 'Could not save the shortcut.'
}

/** R26 — a refused DELETE. Its own table: the save table's fallback says "save". */
export const SHORTCUT_DELETE_ERROR_COPY: Record<ShortcutErrorCode, string> = {
  ...SHORTCUT_ERROR_COPY,
  unknown: 'Could not delete the shortcut.'
}
