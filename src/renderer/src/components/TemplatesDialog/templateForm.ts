// Session templates — PURE helpers behind TemplateForm.tsx: the editable draft, its validation
// into a TemplateSaveRequest, dirtiness, and the copy for IPC error codes. No React, no store.
import {
  MODEL_ALIASES,
  PERMISSION_MODES,
  EFFORT_LEVELS,
  TemplateSaveSchema,
  type ModelAlias,
  type PermissionMode,
  type EffortLevel,
  type Template,
  type TemplateSaveRequest
} from '../../../../shared/schemas/template'

export type ModelChoice = 'default' | ModelAlias | 'custom'
export type PermissionChoice = 'default' | PermissionMode
/** `'default'` ⇒ no `--effort` flag at all — claude keeps its own default. */
export type EffortChoice = 'default' | EffortLevel

export interface TemplateDraft {
  id: string | null
  name: string
  cwd: string
  modelChoice: ModelChoice
  customModel: string
  permissionChoice: PermissionChoice
  effortChoice: EffortChoice
  /** Workspaces — round-trips the template's scope through the draft UNCHANGED. There is no
   *  picker for it yet (Task 11 adds one); this field exists purely so `toDraft` → `validateDraft`
   *  does not silently reset an existing scope to GLOBAL on every edit. */
  workspaceId: string | null
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

const ERROR_COPY: Record<string, string> = {
  template_name_taken: 'A template with this name already exists.',
  template_not_found: 'This template no longer exists.'
}
const FALLBACK_ERROR = 'Could not save the template.'
const FIELD_ERRORS: Record<string, string> = {
  name: 'Name must be 1–60 characters without control characters.',
  model: 'Model name must not contain spaces.',
  cwd: 'Pick a folder.'
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
    workspaceId: null
  }
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
    workspaceId: template.workspaceId
  }
}

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
  const candidate: TemplateSaveRequest = {
    ...(draft.id !== null ? { id: draft.id } : {}),
    name: draft.name,
    cwd: draft.cwd,
    model,
    permissionMode: draft.permissionChoice === 'default' ? null : draft.permissionChoice,
    effort: draft.effortChoice === 'default' ? null : draft.effortChoice,
    // Workspaces — round-tripped from the draft (toDraft copied it from the base template; a
    // NEW draft's is null, i.e. GLOBAL, via emptyDraft). main's save() has no partial-update
    // path, so this dialog must re-send the existing scope on every edit or lose it. There is
    // still no PICKER here (Task 11 adds one) — this only stops an edit from silently resetting
    // an already-scoped template to GLOBAL.
    workspaceId: draft.workspaceId
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
// workspaceId is deliberately OUT of this comparison: there is no control that can change it
// (Task 11 adds one), so `toDraft(base).workspaceId` always equals `draft.workspaceId` for any
// draft actually produced by this file, and including it here would be a no-op either way.
function normalize(d: TemplateDraft): string {
  return JSON.stringify([
    d.id,
    d.name.trim(),
    d.cwd,
    d.modelChoice,
    d.customModel.trim(),
    d.permissionChoice,
    d.effortChoice
  ])
}

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <msg>";
 *  match the code as a substring rather than trusting the wrapper's format. */
export function templateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
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
  { value: 'custom', label: 'Custom…' }
]
