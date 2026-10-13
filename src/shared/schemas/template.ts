// Session templates — the template shape and its IPC/file boundaries. OUR shape (fail-closed,
// NO passthrough, mirrors settings.ts / launch.ts). `permissionMode` IS enum-locked on purpose:
// it is a CLI arg WE generate, not claude output. NEVER log a template value (cwd = filesystem
// layout, name = operator text) — log path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'
import { scanPlaceholders } from './shortcut'
import { WorkspaceIdSchema } from './workspace'

/** The `--permission-mode` choices as printed by `claude --help` on 2.1.258. */
export const PERMISSION_MODES = [
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan'
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** Dropdown suggestions only — `model` itself is free text so a full model name also passes. */
export const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

/** The `--effort` levels as printed by `claude --help` on 2.1.261. Enum-locked for the same
 *  reason as PERMISSION_MODES: this is a CLI arg WE generate, not claude output. All five
 *  predate MIN_CLAUDE_VERSION 2.1.245 (`--effort` itself ≲2.1.72, `max` ≤2.1.98, `xhigh`
 *  2.1.111), so no version gate change is needed. Re-verify against `claude --help` if the
 *  floor is ever bumped, alongside --model / --permission-mode. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const TEMPLATE_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH
export const MODEL_NAME_MAX_LENGTH = 100

/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const TemplateNameSchema = SessionNameSchema

/** An alias or a full model name: trimmed, 1..100, no whitespace / control characters. */
export const ModelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MODEL_NAME_MAX_LENGTH)
  .regex(/^[^\s\p{Cc}]+$/u, { error: 'must not contain whitespace or control characters' })

/** Not `.uuid()` — existence is the store's call (`template_not_found`), same reasoning as
 *  SessionRenameSchema in launch.ts. */
export const TemplateIdSchema = z.string().min(1)

/** Programmatic API — the human-written prompt an API launch starts claude with. */
export const INITIAL_PROMPT_MAX_LENGTH = 2000
export const TEMPLATE_PARAM_LABEL_MAX_LENGTH = 30
export const TEMPLATE_PARAM_PATTERN_MAX_LENGTH = 200
export const TEMPLATE_PARAM_VALUE_MAX_LENGTH = 200
export const TEMPLATE_PARAMS_MAX = 9

/** The anchored, unicode-flagged RegExp for a param, or null when the pattern does not compile.
 *  Anchoring is the app's job so a template author cannot forget it — and it is a GUARANTEE, so
 *  the pattern is compiled ON ITS OWN first. Wrapping is not enough by itself: an unbalanced
 *  pattern closes the wrapper's group and escapes the anchors, `a)|(.*` composing to
 *  `^(?:a)|(.*)$` — an alternation anchored on NEITHER branch, matching every value, i.e. a
 *  param that constrains nothing. Such a pattern is invalid standalone, so the first compile
 *  rejects it. */
export function compileParamPattern(pattern: string): RegExp | null {
  try {
    new RegExp(pattern, 'u')
    return new RegExp(`^(?:${pattern})$`, 'u')
  } catch {
    return null
  }
}

/** True when `text` holds a C0/DEL/C1 control character other than `\n`. */
function hasControlCharExceptNewline(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === undefined || cp === 0x0a) continue
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true
  }
  return false
}

/** Newlines allowed (a prompt is prose), every other control char banned, not blank, never
 *  starting with `-` (claude would parse it as a flag), no `$*` (an unconstrained rest has no
 *  rule), `$n` continuous from `$1`. */
export const InitialPromptSchema = z
  .string()
  .max(INITIAL_PROMPT_MAX_LENGTH)
  .refine((t) => t.trim().length > 0, { error: 'prompt_invalid' })
  .refine((t) => !hasControlCharExceptNewline(t), { error: 'prompt_invalid' })
  .refine((t) => !t.startsWith('-'), { error: 'prompt_invalid' })
  .refine(
    (t) => {
      const scan = scanPlaceholders(t)
      if (scan.rest) return false
      for (let n = 1; n <= scan.numbers.size; n++) if (!scan.numbers.has(n)) return false
      return true
    },
    { error: 'prompt_invalid' }
  )

export const TemplateParamSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(TEMPLATE_PARAM_LABEL_MAX_LENGTH)
    .regex(/^[^\p{Cc}]+$/u, { error: 'must not contain control characters' }),
  pattern: z
    .string()
    .min(1)
    .max(TEMPLATE_PARAM_PATTERN_MAX_LENGTH)
    .refine((p) => compileParamPattern(p) !== null, { error: 'param_pattern_invalid' }),
  maxLength: z.number().int().min(1).max(TEMPLATE_PARAM_VALUE_MAX_LENGTH)
})
export type TemplateParam = z.infer<typeof TemplateParamSchema>

/** The highest `$n` in the prompt must equal `params.length`; a null prompt has no params. */
function promptAndParamsAgree(t: {
  initialPrompt: string | null
  params: TemplateParam[]
}): boolean {
  if (t.initialPrompt === null) return t.params.length === 0
  return scanPlaceholders(t.initialPrompt).numbers.size === t.params.length
}

const TemplateObjectSchema = z.object({
  id: TemplateIdSchema,
  name: TemplateNameSchema,
  cwd: z.string().min(1),
  model: ModelNameSchema.nullable(), // null ⇒ no --model flag
  permissionMode: z.enum(PERMISSION_MODES).nullable(), // null ⇒ no --permission-mode flag
  // `.default(null)` is BACKWARD COMPATIBILITY, not sugar: a templates file written before
  // this field existed has no `effort` key, and without the default that row — and therefore
  // the whole file — fails closed, so loadPersistedOrReset backs it up and starts EMPTY.
  // Every saved template would be lost. Do not remove the default; do not bump the file
  // version instead (a `z.literal(2)` has exactly that failure mode).
  effort: z.enum(EFFORT_LEVELS).nullable().default(null), // null ⇒ no --effort flag
  // Workspaces — the item-level scope. null ⇒ GLOBAL (visible in every workspace); a workspace
  // id ⇒ visible only there. `.default(null)` is BACKWARD COMPATIBILITY for exactly the reason
  // spelled out on `effort` above: a file written before this field existed has no key, and
  // without the default that row — and therefore the WHOLE FILE — fails closed, so
  // loadPersistedOrReset backs it up and starts EMPTY. Every saved template would be lost.
  // Do not remove the default; do NOT bump TEMPLATES_FILE_VERSION instead.
  //
  // A workspaceId naming a workspace that no longer exists does NOT fail the file: the resolver
  // treats it as "belongs to a gone workspace" — invisible in every workspace's list, still
  // listed under `(no workspace)` in the Manage dialog so it can be re-scoped or deleted.
  workspaceId: WorkspaceIdSchema.nullable().default(null),
  // Programmatic API — additive with `.default()` for the SAME backward-compat reason as `effort`
  // and `workspaceId`: an older file has neither key and must still load. Never bump the version.
  initialPrompt: InitialPromptSchema.nullable().default(null),
  params: z.array(TemplateParamSchema).max(TEMPLATE_PARAMS_MAX).default([]),
  // Favorites — additive with `.default(false)` for the SAME backward-compat reason as `effort`:
  // an older file has no key and must still load. Never bump the version. Not in the save arg:
  // only `templates:set-favorite` changes it, so a form Save can never reset a star.
  favorite: z.boolean().default(false)
})

/** The prompt/params agreement is a whole-object rule, so it is applied to the row schema AND to
 *  the save arg — `.omit()`/`.extend()` are taken off the raw object, which carries no refine. */
export const TemplateSchema = TemplateObjectSchema.refine(promptAndParamsAgree, {
  error: 'params_mismatch',
  path: ['params']
})
export type Template = z.infer<typeof TemplateSchema>

/** `templates:save` arg — no id ⇒ create; id ⇒ update. */
export const TemplateSaveSchema = TemplateObjectSchema.omit({ id: true, favorite: true })
  .extend({ id: TemplateIdSchema.optional() })
  .refine(promptAndParamsAgree, { error: 'params_mismatch', path: ['params'] })
export type TemplateSaveRequest = z.infer<typeof TemplateSaveSchema>

/** `templates:delete` arg. */
export const TemplateDeleteSchema = z.object({ id: TemplateIdSchema })
export type TemplateDeleteRequest = z.infer<typeof TemplateDeleteSchema>

/** `templates:set-favorite` arg — the ONE way `favorite` changes. */
export const TemplateSetFavoriteSchema = z
  .object({ id: TemplateIdSchema, favorite: z.boolean() })
  .strict()
export type TemplateSetFavoriteRequest = z.infer<typeof TemplateSetFavoriteSchema>

export const TEMPLATES_FILE_VERSION = 1 as const
export const TemplatesFileSchema = z.object({
  version: z.literal(TEMPLATES_FILE_VERSION),
  templates: z.array(TemplateSchema)
})
export type TemplatesFile = z.infer<typeof TemplatesFileSchema>

export const EMPTY_TEMPLATES_FILE: TemplatesFile = {
  version: TEMPLATES_FILE_VERSION,
  templates: []
}
