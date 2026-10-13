// Shortcuts — the shortcut shape and its IPC/file boundaries. A shortcut is reached by its
// ALIAS (the first word typed in the expander box), never by a chord of its own: the ONE chord
// that opens the box lives in settings (`expanderKey`). OUR shape (fail-closed, NO passthrough,
// mirrors template.ts).
// NEVER log a shortcut value: `text` is operator prose bound for an LLM prompt, `name` and
// `alias` are operator text — log path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'
import { WorkspaceIdSchema } from './workspace'

export const SHORTCUT_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH
export const SHORTCUT_TEXT_MAX_LENGTH = 500
export const SHORTCUT_ALIAS_MAX_LENGTH = 20

/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const ShortcutNameSchema = SessionNameSchema

/** Not `.uuid()` — existence is the store's call (`shortcut_not_found`), the reasoning already
 *  recorded for SessionRenameSchema in launch.ts. */
export const ShortcutIdSchema = z.string().min(1)

/**
 * The alias: what the operator types first in the expander box. Lowercase letters and digits,
 * so `HT` and `ht` are the same shortcut and a space can never split it from its values. The
 * transform runs BEFORE the regex, so `'  HT '` parses to `'ht'`.
 */
export const ShortcutAliasSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1, { error: 'must not be blank' })
      .max(SHORTCUT_ALIAS_MAX_LENGTH)
      .regex(/^[a-z0-9]+$/, { error: 'letters and digits only' })
  )

/**
 * The placeholder tokens a phrase may carry. `$$` is a literal `$`, `$*` is "every value not
 * taken by a number", `$1`..`$9` take values by position. The alternation is ordered so `$$1`
 * reads as an escaped `$` followed by a literal `1`. Sticky-free and global: callers clone it
 * or use `matchAll`/`replace`, never `exec` in a loop on the shared object.
 */
export const PLACEHOLDER_RE = /\$(\$|\*|[1-9])/g

export interface PlaceholderScan {
  numbers: Set<number>
  rest: boolean
}

/** The numbers a text uses and whether `$*` appears. Shared by the schema refine (below) and
 *  the renderer's expand step, so "what is a placeholder" is asked in ONE place. */
export function scanPlaceholders(text: string): PlaceholderScan {
  const numbers = new Set<number>()
  let rest = false
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const tok = m[1]
    if (tok === '*') rest = true
    else if (tok !== '$' && tok !== undefined) numbers.add(Number(tok))
  }
  return { numbers, rest }
}

/** True when the numbers used are exactly 1..max with no hole. `{}` is continuous. */
function isContinuousFromOne(numbers: ReadonlySet<number>): boolean {
  for (let n = 1; n <= numbers.size; n++) if (!numbers.has(n)) return false
  return true
}

/**
 * Base text validation: the four checks shared by v3 (ShortcutTextSchema) and v2 migration.
 * NOT trimmed — a trailing space is meaningful for a phrase the operator will continue after
 * ("run the tests and "). The control-character ban (spec S-1) makes `\r` and ANSI escapes
 * structurally impossible. `\n` is the ONE control char allowed: the terminal types a multi-line
 * phrase as a bracketed paste (and refuses it when the session has bracketed paste off), so a
 * newline never submits. The blank check rejects whitespace-only phrases.
 */
const ShortcutTextBaseSchema = z
  .string()
  .min(1)
  .max(SHORTCUT_TEXT_MAX_LENGTH)
  .refine((t) => !/(?!\n)\p{Cc}/u.test(t), { error: 'must not contain control characters' })
  .refine((t) => t.trim().length > 0, { error: 'must not be blank' })

/**
 * The phrase with placeholder validation. The placeholder refine rejects a GAP (`$1 $3`
 * without `$2`): the expander fails closed on a missing value, so a gap would make the
 * shortcut impossible to run.
 */
export const ShortcutTextSchema = ShortcutTextBaseSchema.refine(
  (t) => isContinuousFromOne(scanPlaceholders(t).numbers),
  { error: 'text_placeholder_gap' }
)

export const ShortcutSchema = z.object({
  id: ShortcutIdSchema,
  name: ShortcutNameSchema,
  alias: ShortcutAliasSchema,
  text: ShortcutTextSchema,
  // Workspaces — the item-level scope. null ⇒ GLOBAL, `.default(null)` protects a row written
  // before scoping from failing closed.
  workspaceId: WorkspaceIdSchema.nullable().default(null),
  // Favorites — `.default(false)` protects a row written before stars from failing closed. Not
  // in the save arg: only `shortcuts:set-favorite` changes it, so a form Save keeps the star.
  favorite: z.boolean().default(false)
})
export type Shortcut = z.infer<typeof ShortcutSchema>

/** `shortcuts:save` arg — no id ⇒ create; id ⇒ update. */
export const ShortcutSaveSchema = ShortcutSchema.omit({ id: true, favorite: true }).extend({
  id: ShortcutIdSchema.optional()
})
export type ShortcutSaveRequest = z.infer<typeof ShortcutSaveSchema>

/** `shortcuts:delete` arg. */
export const ShortcutDeleteSchema = z.object({ id: ShortcutIdSchema })
export type ShortcutDeleteRequest = z.infer<typeof ShortcutDeleteSchema>

/** `shortcuts:set-favorite` arg — the ONE way `favorite` changes. */
export const ShortcutSetFavoriteSchema = z
  .object({ id: ShortcutIdSchema, favorite: z.boolean() })
  .strict()
export type ShortcutSetFavoriteRequest = z.infer<typeof ShortcutSetFavoriteSchema>

/**
 * 3: `keys` (a 1..3 `Ctrl+Alt+<A-Z>` chord sequence) became `alias`. Unlike the 1 → 2 bump,
 * v2 files DO exist on operator machines, so `parseShortcutsFile` migrates them instead of
 * letting them hit the corrupt path.
 */
export const SHORTCUTS_FILE_VERSION = 3 as const
export const ShortcutsFileSchema = z.object({
  version: z.literal(SHORTCUTS_FILE_VERSION),
  shortcuts: z.array(ShortcutSchema)
})
export type ShortcutsFile = z.infer<typeof ShortcutsFileSchema>

export const EMPTY_SHORTCUTS_FILE: ShortcutsFile = {
  version: SHORTCUTS_FILE_VERSION,
  shortcuts: []
}

// ── v2 (migration source only) ──────────────────────────────────────────────────────────────

/** The v2 chord shape, kept ONLY so a v2 file can be read once and rewritten as v3. */
const ShortcutChordV2Schema = z.string().regex(/^Ctrl\+Alt\+[A-Z]$/)

const ShortcutV2Schema = z.object({
  id: ShortcutIdSchema,
  name: ShortcutNameSchema,
  keys: z.array(ShortcutChordV2Schema).min(1).max(3),
  // V2 text uses the base validation without the placeholder-continuity refine: a v2 phrase
  // never carried placeholders on purpose, and a literal `$2` in old prose must not block the
  // whole file from loading.
  text: ShortcutTextBaseSchema,
  workspaceId: WorkspaceIdSchema.nullable().default(null)
})

const ShortcutsFileV2Schema = z.object({
  version: z.literal(2),
  shortcuts: z.array(ShortcutV2Schema)
})

/** `["Ctrl+Alt+O","Ctrl+Alt+A"]` → `"oa"`. Chord sequences were unique per file, so the derived
 *  aliases are unique too. */
export function aliasFromChords(keys: readonly string[]): string {
  return keys.map((chord) => chord.slice(-1).toLowerCase()).join('')
}

/**
 * The shortcuts file parser the main store hands to `loadPersistedOrReset`. v3 parses as is; a
 * v2 file is migrated in memory (the store persists it as v3 on its first write); anything else
 * throws, which the loader turns into the corrupt path. The thrown ZodError carries the file —
 * the loader never logs it.
 */
export function parseShortcutsFile(raw: unknown): ShortcutsFile {
  const v3 = ShortcutsFileSchema.safeParse(raw)
  if (v3.success) return v3.data
  const v2 = ShortcutsFileV2Schema.safeParse(raw)
  if (!v2.success) throw v3.error
  return {
    version: SHORTCUTS_FILE_VERSION,
    shortcuts: v2.data.shortcuts.map(({ keys, text, ...rest }) => ({
      ...rest,
      alias: aliasFromChords(keys),
      favorite: false,
      // v2 had no placeholder semantics — every "$" in a v2 phrase was literal. Doubling it
      // ($ -> $$) preserves that exact meaning under v3's placeholder rules (a lone $5 would
      // otherwise become a missing-arg placeholder the shortcut can no longer run).
      //
      // Done UNCONDITIONALLY, even though doubling can push a near-cap phrase past
      // SHORTCUT_TEXT_MAX_LENGTH: the migrated object is NOT re-validated here (no
      // ShortcutsFileSchema.parse() net — that would run the v3 placeholder refine over
      // migrated text and turn a broken row into a whole-file corrupt-and-reset), so the row
      // still loads either way. If it now exceeds the cap the operator meets the normal
      // length error on their next edit — a legible failure. A conditional skip would
      // silently leave SOME rows with the wrong placeholder semantics, which is the harder
      // bug to diagnose.
      //
      // NOT `text.replaceAll('$', '$$')`: '$$' in a STRING replacement arg is itself a special
      // pattern (it means "insert one literal $"), so that call is a silent no-op. `split` +
      // `join` sidesteps the special-pattern machinery entirely.
      text: text.split('$').join('$$')
    }))
  }
}
