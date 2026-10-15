// Session templates — PURE helpers behind TemplateForm.tsx: the editable draft, its validation
// into a TemplateSaveRequest, dirtiness, and the copy for IPC error codes. No React, no store.
import { STORE_WRITE_FAILED } from '../../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from '../../lib/storageHealthCopy'
import { scanPlaceholders } from '../../../../shared/schemas/shortcut'
import {
  MODEL_ALIASES,
  PERMISSION_MODES,
  EFFORT_LEVELS,
  TEMPLATE_PARAM_VALUE_MAX_LENGTH,
  TemplateSaveSchema,
  compileParamPattern,
  type ModelAlias,
  type PermissionMode,
  type EffortLevel,
  type Template,
  type TemplateParam,
  type TemplateSaveRequest
} from '../../../../shared/schemas/template'
import { usedByRulesCopy } from '../../stores/rulesStore'

export type ModelChoice = 'default' | ModelAlias | 'custom'
export type PermissionChoice = 'default' | PermissionMode
/** `'default'` ⇒ no `--effort` flag at all — claude keeps its own default. */
export type EffortChoice = 'default' | EffortLevel

/** One parameter row as the form holds it: every field a STRING, because that is what a text
 *  box gives back. `maxLength` becomes a number only in `validateDraft`, where a value that is
 *  not a whole number in range is refused with copy instead of silently becoming NaN. */
export interface ParamDraft {
  label: string
  pattern: string
  maxLength: string
}
/** What a fresh row starts at — long enough for a ticket key or a short branch name. */
export const DEFAULT_PARAM_MAX = '50'

export interface TemplateDraft {
  id: string | null
  name: string
  cwd: string
  modelChoice: ModelChoice
  customModel: string
  permissionChoice: PermissionChoice
  effortChoice: EffortChoice
  /** Workspaces — round-trips the template's scope through the draft UNCHANGED, so `toDraft` →
   *  `validateDraft` does not silently reset an existing scope to GLOBAL on every edit. */
  workspaceId: string | null
  /** Programmatic API — the prompt an API launch starts claude with. `''` (not null) is "no
   *  prompt": a textarea's value is always a string, and `validateDraft` is the ONE place that
   *  turns a blank one back into null. */
  initialPrompt: string
  /** One row per `$n` in the prompt, kept in step with it by `syncParamRows`. */
  params: ParamDraft[]
}

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  bypassPermissions: 'Bypass permissions',
  manual: 'Manual',
  dontAsk: "Don't ask",
  plan: 'Plan'
}

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

/** Programmatic API — the LAST-RESORT sentence for a prompt `InitialPromptSchema` refuses. The
 *  form checks the three shape rules it can name itself (leading `-`, `$*`, a `$n` gap), so what
 *  reaches this copy is a control character or the length cap — the two the sentence spells out.
 *  It is also what `prompt_invalid` from main maps to, where the path is all we get. */
const PROMPT_ERROR =
  'The prompt is 1–2000 characters, newlines allowed, no other control characters.'
const PARAMS_ERROR = 'Each $n in the prompt needs one parameter row.'

const ERROR_COPY: Record<string, string> = {
  template_name_taken: 'A template with this name already exists.',
  template_not_found: 'This template no longer exists.',
  template_in_use: 'A rule uses this template. Change or delete that rule first.',
  prompt_invalid: PROMPT_ERROR,
  param_pattern_invalid: 'A parameter pattern does not compile.',
  params_mismatch: PARAMS_ERROR,
  [STORE_WRITE_FAILED]: STORE_WRITE_FAILED_COPY
}
const FALLBACK_ERROR = 'Could not save the template.'
const FIELD_ERRORS: Record<string, string> = {
  name: 'Name must be 1–60 characters without control characters.',
  model: 'Model name must not contain spaces.',
  cwd: 'Pick a folder.',
  initialPrompt: PROMPT_ERROR,
  params: PARAMS_ERROR
}

function isAlias(model: string): model is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(model)
}

export function emptyDraft(): TemplateDraft {
  return {
    id: null,
    name: '',
    cwd: '',
    modelChoice: 'default',
    customModel: '',
    permissionChoice: 'default',
    effortChoice: 'default',
    workspaceId: null,
    initialPrompt: '',
    params: []
  }
}

/** How many parameter rows the prompt asks for. `$$` is an escaped `$` and never counts;
 *  `scanPlaceholders` already knows that, so "what is a placeholder" stays asked in ONE place. */
export function placeholderCount(prompt: string): number {
  return scanPlaceholders(prompt).numbers.size
}

/** The rows the prompt asks for, keeping what the operator already typed: extra rows are
 *  trimmed off the end, missing ones padded with an empty row. PURE — the form calls it on
 *  every prompt keystroke. */
export function syncParamRows(params: ParamDraft[], count: number): ParamDraft[] {
  const out = params.slice(0, count)
  while (out.length < count) out.push({ label: '', pattern: '', maxLength: DEFAULT_PARAM_MAX })
  return out
}

export function modelChoiceOf(model: string | null): { choice: ModelChoice; custom: string } {
  if (model === null) return { choice: 'default', custom: '' }
  if (isAlias(model)) return { choice: model, custom: '' }
  return { choice: 'custom', custom: model }
}

export function toDraft(template: Template): TemplateDraft {
  const { choice, custom } = modelChoiceOf(template.model)
  return {
    id: template.id,
    name: template.name,
    cwd: template.cwd,
    modelChoice: choice,
    customModel: custom,
    permissionChoice: template.permissionMode ?? 'default',
    effortChoice: template.effort ?? 'default',
    workspaceId: template.workspaceId,
    initialPrompt: template.initialPrompt ?? '',
    // COPIED row by row, never aliased: the editor mutates these objects in place, and the
    // template they came from is the one the store (and the board) still renders.
    params: template.params.map((p) => ({
      label: p.label,
      pattern: p.pattern,
      maxLength: String(p.maxLength)
    }))
  }
}

/** The prompt-shape rules the FORM checks itself, so the operator gets the reason instead of the
 *  schema's one-size sentence. (The gap message names the number, so it is built inline.) */
const PROMPT_SHAPE_ERROR = 'The prompt must not start with “-” and must not use $*.'

export type DraftValidation =
  | { ok: true; request: TemplateSaveRequest }
  | { ok: false; error: string }

export function validateDraft(draft: TemplateDraft): DraftValidation {
  if (draft.name.trim().length === 0) return { ok: false, error: 'Name is required.' }
  if (draft.cwd.length === 0) return { ok: false, error: 'Pick a folder.' }
  if (draft.modelChoice === 'custom' && draft.customModel.trim().length === 0) {
    return { ok: false, error: 'Type a model name, or pick one from the list.' }
  }
  const model =
    draft.modelChoice === 'default'
      ? null
      : draft.modelChoice === 'custom'
        ? draft.customModel.trim()
        : draft.modelChoice
  // Programmatic API — a blank box is NO prompt (null), never an empty string the schema would
  // refuse. Every prompt-shape rule the form can explain itself is checked here, before the
  // rows: a leading `-` would reach claude as a flag, `$*` is an unconstrained rest with no rule
  // to validate it against, and a GAP (`$1 $3`) is a dead end — the rows are drawn by COUNT, so
  // the form would offer `$1`/`$2` for a prompt that says `$1`/`$3`, and the only refusal left
  // would be the schema's continuity refine, whose issue path is `initialPrompt` (i.e. the
  // length/control-character sentence, naming nothing). Say which number is missing instead.
  const prompt = draft.initialPrompt.trim().length === 0 ? null : draft.initialPrompt
  const scan = prompt === null ? null : scanPlaceholders(prompt)
  if (prompt !== null && scan !== null) {
    if (prompt.startsWith('-') || scan.rest) return { ok: false, error: PROMPT_SHAPE_ERROR }
    for (let n = 1; n <= scan.numbers.size; n++) {
      if (scan.numbers.has(n)) continue
      const highest = Math.max(...scan.numbers)
      return {
        ok: false,
        error: `The prompt uses $${highest} but not $${n}. Number the placeholders from $1 with no gaps.`
      }
    }
  }
  const params: TemplateParam[] = []
  if (prompt !== null) {
    // One row per `$n`, read in prompt order so the error names the placeholder the operator
    // sees. A missing row (the prompt grew before the form re-rendered) reads as an empty one.
    const count = placeholderCount(prompt)
    for (let i = 0; i < count; i++) {
      const row = draft.params[i] ?? { label: '', pattern: '', maxLength: '' }
      if (row.label.trim().length === 0) {
        return { ok: false, error: `Give parameter $${i + 1} a label.` }
      }
      if (row.pattern.length === 0 || compileParamPattern(row.pattern) === null) {
        return { ok: false, error: `Parameter $${i + 1}: the pattern does not compile.` }
      }
      const max = Number(row.maxLength)
      if (!Number.isInteger(max) || max < 1 || max > TEMPLATE_PARAM_VALUE_MAX_LENGTH) {
        return {
          ok: false,
          error: `Parameter $${i + 1}: max length must be 1–${TEMPLATE_PARAM_VALUE_MAX_LENGTH}.`
        }
      }
      params.push({ label: row.label.trim(), pattern: row.pattern, maxLength: max })
    }
  }
  const candidate: TemplateSaveRequest = {
    ...(draft.id !== null ? { id: draft.id } : {}),
    name: draft.name,
    cwd: draft.cwd,
    model,
    permissionMode: draft.permissionChoice === 'default' ? null : draft.permissionChoice,
    effort: draft.effortChoice === 'default' ? null : draft.effortChoice,
    // Workspaces — round-tripped from the draft (toDraft copied it from the base template; a
    // NEW draft's is null, i.e. GLOBAL, via emptyDraft). main's save() has no partial-update
    // path, so this dialog must re-send the existing scope on every edit or lose it.
    workspaceId: draft.workspaceId,
    // Programmatic API — built above from the prompt and its rows. Same no-partial-update
    // reasoning as workspaceId: main's save() replaces the whole row, so these always ship.
    initialPrompt: prompt,
    params
  }
  const parsed = TemplateSaveSchema.safeParse(candidate)
  if (parsed.success) return { ok: true, request: parsed.data }
  const field = String(parsed.error.issues[0]?.path[0] ?? '')
  return { ok: false, error: FIELD_ERRORS[field] ?? FALLBACK_ERROR }
}

/** Compares the NORMALIZED drafts, so whitespace-only edits do not count. */
export function isDraftDirty(draft: TemplateDraft, base: Template | null): boolean {
  return normalize(draft) !== normalize(base === null ? emptyDraft() : toDraft(base))
}
// Task 11 — workspaceId IS part of this comparison now: the scope select is a real control, so
// changing ONLY the scope must mark the draft dirty or the operator has no way to save the
// change they just made (Save stays disabled forever). Task 19 — the prompt and its rows are
// real controls for exactly the same reason; leave either out and editing ONLY the prompt
// leaves Save disabled forever.
function normalize(d: TemplateDraft): string {
  return JSON.stringify([
    d.id,
    d.name.trim(),
    d.cwd,
    d.modelChoice,
    d.customModel.trim(),
    d.permissionChoice,
    d.effortChoice,
    d.workspaceId,
    d.initialPrompt,
    d.params
  ])
}

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <msg>";
 *  match the code as a substring rather than trusting the wrapper's format.
 *
 *  `ruleCount` is how many rules use the template (the caller counts them in the rules
 *  projection): main's `template_in_use` carries only the code. */
export function templateErrorMessage(err: unknown, ruleCount = 0): string {
  const text = err instanceof Error ? err.message : ''
  if (text.includes('template_in_use') && ruleCount > 0) return usedByRulesCopy(ruleCount)
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return FALLBACK_ERROR
}

export function describeTemplateFlags(
  t: Pick<Template, 'model' | 'permissionMode' | 'effort'>
): string {
  const model = t.model ?? 'default model'
  const mode =
    t.permissionMode === null ? 'default permissions' : PERMISSION_MODE_LABELS[t.permissionMode]
  const effort = t.effort === null ? 'default effort' : `${EFFORT_LABELS[t.effort]} effort`
  return `${model} · ${mode} · ${effort}`
}

/** Select options, in claude --help order. */
export const PERMISSION_CHOICES: ReadonlyArray<{ value: PermissionChoice; label: string }> = [
  { value: 'default', label: 'Default (claude decides)' },
  ...PERMISSION_MODES.map((mode) => ({ value: mode, label: PERMISSION_MODE_LABELS[mode] }))
]
export const EFFORT_CHOICES: ReadonlyArray<{ value: EffortChoice; label: string }> = [
  { value: 'default', label: 'Default (claude decides)' },
  ...EFFORT_LEVELS.map((level) => ({ value: level, label: EFFORT_LABELS[level] }))
]
export const MODEL_CHOICES: ReadonlyArray<{ value: ModelChoice; label: string }> = [
  { value: 'default', label: 'Default (claude decides)' },
  ...MODEL_ALIASES.map((alias) => ({ value: alias, label: alias })),
  { value: 'custom', label: 'Custom' }
]
