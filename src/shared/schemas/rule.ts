// Rules — the rule shape and its IPC/file boundaries (spec 2026-09-11 §1.2). OUR shape: fail-closed,
// NO passthrough (mirrors template.ts / tag.ts). NEVER log a rule value — the name is operator text
// and a pattern can hold a path; log issue path + code only.
//
// The FILE never compiles a pattern (T-23): `pattern` is a bounded string here. The compile check
// happens in main — `rules:save` refuses with `rule_bad_pattern`, and a stored rule whose pattern
// does not compile is reported broken and never fires. One bad row never resets the file.
import { z } from 'zod'
import { COLUMNS } from '../ipc/contract'
import { SESSION_NAME_MAX_LENGTH, SessionNameSchema } from './launch'
import { TagIdSchema } from './tag'
import { TemplateIdSchema } from './template'
import { WorkspaceIdSchema } from './workspace'

/** Not `.uuid()` — existence is the store's call (`rule_not_found`). */
export const RuleIdSchema = z.string().min(1)

export const RULE_NAME_MAX_LENGTH = SESSION_NAME_MAX_LENGTH
/** Same rules as a session name: trimmed, 1..60, no control characters. */
export const RuleNameSchema = SessionNameSchema

export const RULE_PATTERN_MAX_LENGTH = 200

/** The time-in-column choices, in minutes. A FIXED list: the form offers them in a Select (a bare
 *  number input is banned — design.md), so a stored value is always one the dropdown offers. */
export const TIME_RULE_MINUTES = [5, 10, 15, 30, 60, 120, 240, 480, 1440] as const
export type TimeRuleMinutes = (typeof TIME_RULE_MINUTES)[number]

/** A column-change trigger's `from` / `to`: a real column, or `any`. */
export const COLUMN_OR_ANY = [...COLUMNS, 'any'] as const

export const TEXT_MATCH_MODES = ['contains', 'regex'] as const

export const RuleConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['has-tag', 'lacks-tag']), tagId: TagIdSchema }),
  z.object({ kind: z.literal('template'), templateId: TemplateIdSchema }),
  z.object({
    kind: z.enum(['folder', 'name']),
    // `contains` is case-insensitive; `regex` is used as written (matchText.ts).
    mode: z.enum(TEXT_MATCH_MODES),
    pattern: z.string().min(1).max(RULE_PATTERN_MAX_LENGTH)
  })
])
export type RuleCondition = z.infer<typeof RuleConditionSchema>

export const RuleTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('launched') }),
  z.object({
    kind: z.literal('column-change'),
    from: z.enum(COLUMN_OR_ANY),
    to: z.enum(COLUMN_OR_ANY)
  }),
  z.object({
    kind: z.literal('time-in-column'),
    column: z.enum(COLUMNS),
    minutes: z.literal(TIME_RULE_MINUTES)
  })
])
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>

export const RuleActionSchema = z.object({
  kind: z.enum(['add-tag', 'remove-tag']),
  tagId: TagIdSchema
})
export type RuleAction = z.infer<typeof RuleActionSchema>

export const RuleSchema = z.object({
  id: RuleIdSchema,
  name: RuleNameSchema,
  // null ⇒ GLOBAL; an id ⇒ that workspace only. The scope IS the rule's workspace check (T-10).
  // `.default(null)` is BACKWARD COMPATIBILITY, exactly as on Template.workspaceId — do not remove
  // it and do NOT bump RULES_FILE_VERSION instead.
  workspaceId: WorkspaceIdSchema.nullable().default(null),
  trigger: RuleTriggerSchema,
  /** AND — every condition must hold. Empty ⇒ always. */
  conditions: z.array(RuleConditionSchema),
  actions: z.array(RuleActionSchema).min(1)
})
export type Rule = z.infer<typeof RuleSchema>

/** `rules:save` arg — no id ⇒ create (appended LAST); id ⇒ update (keeps its place). */
export const RuleSaveSchema = RuleSchema.omit({ id: true }).extend({ id: RuleIdSchema.optional() })
export type RuleSaveRequest = z.infer<typeof RuleSaveSchema>

/** `rules:delete` arg. */
export const RuleDeleteSchema = z.object({ id: RuleIdSchema })
export type RuleDeleteRequest = z.infer<typeof RuleDeleteSchema>

/** `rules:move` arg — the rule's FINAL index in the run order (clamped by the store). */
export const RuleMoveSchema = z.object({
  id: RuleIdSchema,
  toIndex: z.number().int().nonnegative()
})
export type RuleMoveRequest = z.infer<typeof RuleMoveSchema>

export const RULES_FILE_VERSION = 1 as const
/** ARRAY ORDER = RUN ORDER (T-14). */
export const RulesFileSchema = z.object({
  version: z.literal(RULES_FILE_VERSION),
  rules: z.array(RuleSchema)
})
export type RulesFile = z.infer<typeof RulesFileSchema>

export const EMPTY_RULES_FILE: RulesFile = { version: RULES_FILE_VERSION, rules: [] }
