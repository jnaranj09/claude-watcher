// Rules — the Rules form's PURE model: labels, defaults, validation and the one-line trigger
// summary. A .ts file (react-refresh allows only component exports in a .tsx) and unit-tested alone,
// like TemplatesDialog/templateForm.ts.
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { COLUMNS, type Column } from '../../../../shared/ipc/contract'
import {
  RuleSaveSchema,
  TEXT_MATCH_MODES,
  TIME_RULE_MINUTES,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleSaveRequest,
  type RuleTrigger,
  type TimeRuleMinutes
} from '../../../../shared/schemas/rule'
import { patternCompiles } from '../../../../shared/rules/matchText'
import { inRuleScope } from '../../../../shared/rules/ruleRefs'

export const COLUMN_LABELS: Record<Column, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  idle: 'Idle'
}

type TriggerKind = RuleTrigger['kind']
type ConditionKind = RuleCondition['kind']
type ActionKind = RuleAction['kind']

export const TRIGGER_CHOICES: { value: TriggerKind; label: string }[] = [
  { value: 'column-change', label: 'When the column changes' },
  { value: 'time-in-column', label: 'After time in a column' },
  { value: 'launched', label: 'When a session launches' }
]

export const FROM_TO_CHOICES: { value: Column | 'any'; label: string }[] = [
  { value: 'any', label: 'Any column' },
  ...COLUMNS.map((c) => ({ value: c, label: COLUMN_LABELS[c] }))
]

export const COLUMN_CHOICES: { value: Column; label: string }[] = COLUMNS.map((c) => ({
  value: c,
  label: COLUMN_LABELS[c]
}))

export function minutesLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`
}

export const MINUTES_CHOICES: { value: string; label: string }[] = TIME_RULE_MINUTES.map((m) => ({
  value: String(m),
  label: minutesLabel(m)
}))

/** The dropdown hands back a string; the list is the only source of legal minutes. */
export function minutesFrom(value: string): TimeRuleMinutes {
  return TIME_RULE_MINUTES.find((m) => String(m) === value) ?? 30
}

export const CONDITION_CHOICES: { value: ConditionKind; label: string }[] = [
  { value: 'has-tag', label: 'Has tag' },
  { value: 'lacks-tag', label: 'Lacks tag' },
  { value: 'template', label: 'Launched from template' },
  { value: 'folder', label: 'Folder' },
  { value: 'name', label: 'Session name' }
]

/** A label for every TEXT_MATCH_MODES entry — a Record, so a mode added to the shared constant
 *  without a label here is a COMPILE error, not a silently-omitted dropdown row. */
const MODE_LABELS: Record<(typeof TEXT_MATCH_MODES)[number], string> = {
  contains: 'contains',
  regex: 'matches regex'
}

export const MODE_CHOICES: { value: 'contains' | 'regex'; label: string }[] = TEXT_MATCH_MODES.map(
  (m) => ({ value: m, label: MODE_LABELS[m] })
)

export const ACTION_CHOICES: { value: ActionKind; label: string }[] = [
  { value: 'add-tag', label: 'Add tag' },
  { value: 'remove-tag', label: 'Remove tag' }
]

/** The form's editable state — a save request without its id. */
export type RuleDraft = Omit<RuleSaveRequest, 'id'>

/** A NEW rule is Global (the same non-surprising default as templates and tags). */
export function emptyDraft(): RuleDraft {
  return {
    name: '',
    workspaceId: null,
    trigger: triggerFor('column-change'),
    conditions: [],
    actions: []
  }
}

export function toDraft(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    workspaceId: rule.workspaceId,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions
  }
}

/** The trigger a kind starts from when the operator picks it. */
export function triggerFor(kind: TriggerKind): RuleTrigger {
  switch (kind) {
    case 'launched':
      return { kind }
    case 'column-change':
      return { kind, from: 'any', to: 'needs-you' }
    case 'time-in-column':
      return { kind, column: 'idle', minutes: 30 }
  }
}

/** A condition of `kind`, pre-filled with the first tag / template the rule may use ('' when there
 *  is none — validation then asks for one). */
export function conditionFor(
  kind: ConditionKind,
  firstTagId: string,
  firstTemplateId: string
): RuleCondition {
  switch (kind) {
    case 'has-tag':
    case 'lacks-tag':
      return { kind, tagId: firstTagId }
    case 'template':
      return { kind, templateId: firstTemplateId }
    case 'folder':
    case 'name':
      return { kind, mode: 'contains', pattern: '' }
  }
}

interface ScopedRef {
  id: string
  workspaceId: string | null
}

/**
 * R15 — the draft moved to `workspaceId`. Every tag / template ref the new scope can still see
 * (`inRuleScope`, the ONE predicate) is kept; the rest reset to the first item it can see, or ''
 * when there is none (validation then asks for one). Without it the dropdown showed a blank value
 * the new scope does not offer and Save failed `rule_ref_out_of_scope`.
 */
export function rescopeDraft(
  draft: RuleDraft,
  workspaceId: string | null,
  tags: readonly ScopedRef[],
  templates: readonly ScopedRef[]
): RuleDraft {
  const visible = (items: readonly ScopedRef[]): string[] =>
    items.filter((i) => inRuleScope(workspaceId, i.workspaceId)).map((i) => i.id)
  const tagIds = visible(tags)
  const templateIds = visible(templates)
  const keep = (id: string, ids: string[]): string => (ids.includes(id) ? id : (ids[0] ?? ''))
  return {
    ...draft,
    workspaceId,
    conditions: draft.conditions.map((c): RuleCondition => {
      if (c.kind === 'has-tag' || c.kind === 'lacks-tag')
        return { ...c, tagId: keep(c.tagId, tagIds) }
      if (c.kind === 'template') return { ...c, templateId: keep(c.templateId, templateIds) }
      return c
    }),
    actions: draft.actions.map((a): RuleAction => ({ ...a, tagId: keep(a.tagId, tagIds) }))
  }
}

const FIELD_ERRORS: Record<string, string> = {
  name: 'Give the rule a name.',
  trigger: 'Pick when the rule runs.',
  conditions: 'Finish or remove the unfinished condition.',
  actions: 'Add at least one action, with a tag.'
}
const FALLBACK_FIELD_ERROR = 'Finish the rule before saving.'

export type DraftValidation = { ok: true; request: RuleSaveRequest } | { ok: false; error: string }

/** Parses the draft with the SAME schema main uses (RuleSaveSchema), and checks regex patterns up
 *  front so the operator hears "not a valid regular expression" before a round-trip. */
export function validateDraft(draft: RuleDraft, id: string | undefined): DraftValidation {
  const badRegex = draft.conditions.some(
    (c) => (c.kind === 'folder' || c.kind === 'name') && c.pattern.length > 0 && !patternCompiles(c)
  )
  if (badRegex) return { ok: false, error: 'That pattern is not a valid regular expression.' }
  const parsed = RuleSaveSchema.safeParse(id === undefined ? draft : { ...draft, id })
  if (parsed.success) return { ok: true, request: parsed.data }
  const field = String(parsed.error.issues[0]?.path[0] ?? '')
  return { ok: false, error: FIELD_ERRORS[field] ?? FALLBACK_FIELD_ERROR }
}

/** Compares NORMALIZED drafts, so whitespace-only name edits do not count. */
export function isDraftDirty(draft: RuleDraft, base: Rule | null): boolean {
  const original = base === null ? emptyDraft() : toDraft(base)
  return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(original))
}

function normalize(draft: RuleDraft): RuleDraft {
  return { ...draft, name: draft.name.trim() }
}

/** The one line under a rule's name in the list: "Working → Needs you", "Idle for 30 min". */
export function triggerSummary(trigger: RuleTrigger): string {
  switch (trigger.kind) {
    case 'launched':
      return 'On launch'
    case 'column-change':
      return `${side(trigger.from)} → ${side(trigger.to)}`
    case 'time-in-column':
      return `${COLUMN_LABELS[trigger.column]} for ${minutesLabel(trigger.minutes)}`
  }
}

function side(column: Column | 'any'): string {
  return column === 'any' ? 'Any' : COLUMN_LABELS[column]
}

const ERROR_COPY: Record<string, string> = {
  rule_bad_pattern: 'That pattern is not a valid regular expression.',
  rule_ref_missing: 'A tag or template this rule uses no longer exists.',
  rule_ref_out_of_scope: 'This rule uses a tag or template its workspace cannot see.',
  rule_not_found: 'That rule no longer exists.',
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY
}

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <code>"; the
 *  code is matched as a substring (templateErrorMessage's verified rule). Never the raw message. */
export function ruleErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return 'Something went wrong. Try again.'
}
