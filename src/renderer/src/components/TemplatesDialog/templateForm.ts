// Session templates — PURE helpers behind TemplateForm.tsx: the editable draft, its validation
// into a TemplateSaveRequest, dirtiness, and the copy for IPC error codes. No React, no store.
import {
  MODEL_ALIASES,
  PERMISSION_MODES,
  TemplateSaveSchema,
  type ModelAlias,
  type PermissionMode,
  type Template,
  type TemplateSaveRequest
} from '../../../../shared/schemas/template'

export type ModelChoice = 'default' | ModelAlias | 'custom'
export type PermissionChoice = 'default' | PermissionMode

export interface TemplateDraft {
  id: string | null
  name: string
  cwd: string
  modelChoice: ModelChoice
  customModel: string
  permissionChoice: PermissionChoice
}

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  bypassPermissions: 'Bypass permissions',
  manual: 'Manual',
  dontAsk: "Don't ask",
  plan: 'Plan'
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
    permissionChoice: 'default'
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
    permissionChoice: template.permissionMode ?? 'default'
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
    permissionMode: draft.permissionChoice === 'default' ? null : draft.permissionChoice
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
function normalize(d: TemplateDraft): string {
  return JSON.stringify([
    d.id,
    d.name.trim(),
    d.cwd,
    d.modelChoice,
    d.customModel.trim(),
    d.permissionChoice
  ])
}

/** Electron wraps a thrown handler error as "Error invoking remote method '…': Error: <msg>";
 *  match the code as a substring rather than trusting the wrapper's format. */
export function templateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return FALLBACK_ERROR
}

export function describeTemplateFlags(t: Pick<Template, 'model' | 'permissionMode'>): string {
  const model = t.model ?? 'default model'
  const mode =
    t.permissionMode === null ? 'default permissions' : PERMISSION_MODE_LABELS[t.permissionMode]
  return `${model} · ${mode}`
}

/** Select options, in claude --help order. */
export const PERMISSION_CHOICES: ReadonlyArray<{ value: PermissionChoice; label: string }> = [
  { value: 'default', label: 'Default (claude decides)' },
  ...PERMISSION_MODES.map((mode) => ({ value: mode, label: PERMISSION_MODE_LABELS[mode] }))
]
export const MODEL_CHOICES: ReadonlyArray<{ value: ModelChoice; label: string }> = [
  { value: 'default', label: 'Default (claude decides)' },
  ...MODEL_ALIASES.map((alias) => ({ value: alias, label: alias })),
  { value: 'custom', label: 'Custom…' }
]
