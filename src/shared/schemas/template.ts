// Session templates — the template shape and its IPC/file boundaries. OUR shape (fail-closed,
// NO passthrough, mirrors settings.ts / launch.ts). `permissionMode` IS enum-locked on purpose:
// it is a CLI arg WE generate, not claude output. NEVER log a template value (cwd = filesystem
// layout, name = operator text) — log path + code only.
import { z } from 'zod'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'

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

export const TemplateSchema = z.object({
  id: TemplateIdSchema,
  name: TemplateNameSchema,
  cwd: z.string().min(1),
  model: ModelNameSchema.nullable(), // null ⇒ no --model flag
  permissionMode: z.enum(PERMISSION_MODES).nullable() // null ⇒ no --permission-mode flag
})
export type Template = z.infer<typeof TemplateSchema>

/** `templates:save` arg — no id ⇒ create; id ⇒ update. */
export const TemplateSaveSchema = TemplateSchema.omit({ id: true }).extend({
  id: TemplateIdSchema.optional()
})
export type TemplateSaveRequest = z.infer<typeof TemplateSaveSchema>

/** `templates:delete` arg. */
export const TemplateDeleteSchema = z.object({ id: TemplateIdSchema })
export type TemplateDeleteRequest = z.infer<typeof TemplateDeleteSchema>

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
