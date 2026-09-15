import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  toDraft,
  modelChoiceOf,
  validateDraft,
  isDraftDirty,
  templateErrorMessage,
  describeTemplateFlags,
  PERMISSION_MODE_LABELS,
  EFFORT_CHOICES,
  EFFORT_LABELS
} from './templateForm'
import { PERMISSION_MODES, EFFORT_LEVELS, type Template } from '../../../../shared/schemas/template'

const T: Template = {
  id: 'a',
  name: 'api',
  cwd: '/api',
  model: 'opus',
  permissionMode: 'plan',
  effort: 'high',
  workspaceId: null,
  initialPrompt: null,
  params: []
}

describe('draft ⇄ template', () => {
  it('emptyDraft is a new, default-flag draft', () => {
    expect(emptyDraft()).toEqual({
      id: null,
      name: '',
      cwd: '',
      modelChoice: 'default',
      customModel: '',
      permissionChoice: 'default',
      effortChoice: 'default',
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
  })
  it('modelChoiceOf: null → default, alias → alias, anything else → custom with the text', () => {
    expect(modelChoiceOf(null)).toEqual({ choice: 'default', custom: '' })
    expect(modelChoiceOf('sonnet')).toEqual({ choice: 'sonnet', custom: '' })
    expect(modelChoiceOf('claude-fable-5')).toEqual({ choice: 'custom', custom: 'claude-fable-5' })
  })
  it('toDraft maps a template; null permission and null effort → default', () => {
    expect(toDraft({ ...T, model: 'claude-x', permissionMode: null, effort: null })).toEqual({
      id: 'a',
      name: 'api',
      cwd: '/api',
      modelChoice: 'custom',
      customModel: 'claude-x',
      permissionChoice: 'default',
      effortChoice: 'default',
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
  })
  // Fix round 1, Finding 1 — the clobber this guards against: main's save() has no
  // partial-update path, so an edit that does not carry the existing scope resets it to
  // GLOBAL. toDraft must carry a NON-null scope through unchanged (a null-only assertion
  // would pass even if toDraft hardcoded null).
  it('toDraft carries a SCOPED template workspaceId through unchanged', () => {
    expect(toDraft({ ...T, workspaceId: 'w1' }).workspaceId).toBe('w1')
  })
})

describe('validateDraft', () => {
  it('a full draft becomes a save request (id kept when editing)', () => {
    expect(validateDraft(toDraft(T))).toEqual({
      ok: true,
      request: {
        id: 'a',
        name: 'api',
        cwd: '/api',
        model: 'opus',
        permissionMode: 'plan',
        effort: 'high',
        workspaceId: null,
        initialPrompt: null,
        params: []
      }
    })
  })
  // Fix round 1, Finding 1 — THE test that pins the fix: editing a SCOPED template must
  // preserve its scope, not reset it to GLOBAL. Hardcoding `workspaceId: null` in
  // validateDraft's candidate (the reverted defect) would turn this red.
  it('editing a SCOPED template preserves the scope (does not clobber it to GLOBAL)', () => {
    const v = validateDraft(toDraft({ ...T, workspaceId: 'w1' }))
    expect(v.ok && v.request.workspaceId).toBe('w1')
  })
  // Programmatic API (Task 4) — the SAME clobber as the scope above, one field further on. The
  // form has no prompt control yet, so hardcoding `initialPrompt: null, params: []` in the
  // candidate would WIPE a template's prompt on any unrelated edit (main's save() replaces the
  // whole row). Round-tripping them through the draft is what stops that; reverting it turns
  // this red.
  it('editing a template with a prompt preserves the prompt and its params', () => {
    const params = [{ label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 20 }]
    const v = validateDraft(toDraft({ ...T, initialPrompt: 'Work on $1', params }))
    expect(v.ok && v.request.initialPrompt).toBe('Work on $1')
    expect(v.ok ? v.request.params : null).toEqual(params)
  })
  it('a new draft has NO id key at all (exactOptionalPropertyTypes)', () => {
    const v = validateDraft({ ...emptyDraft(), name: 'x', cwd: '/x' })
    expect(v).toEqual({
      ok: true,
      request: {
        name: 'x',
        cwd: '/x',
        model: null,
        permissionMode: null,
        effort: null,
        workspaceId: null,
        initialPrompt: null,
        params: []
      }
    })
    expect(v.ok && 'id' in v.request).toBe(false)
  })
  it('custom model uses the trimmed text; default flags become null', () => {
    const v = validateDraft({
      ...emptyDraft(),
      name: 'x',
      cwd: '/x',
      modelChoice: 'custom',
      customModel: ' claude-x '
    })
    expect(v.ok && v.request.model).toBe('claude-x')
  })
  it.each([
    ['blank name', { ...emptyDraft(), cwd: '/x' }, 'Name is required.'],
    ['blank folder', { ...emptyDraft(), name: 'x' }, 'Pick a folder.'],
    [
      'custom with empty text',
      { ...emptyDraft(), name: 'x', cwd: '/x', modelChoice: 'custom' as const },
      'Type a model name, or pick one from the list.'
    ],
    [
      'custom with a space',
      { ...emptyDraft(), name: 'x', cwd: '/x', modelChoice: 'custom' as const, customModel: 'a b' },
      'Model name must not contain spaces.'
    ],
    [
      'name too long',
      { ...emptyDraft(), name: 'n'.repeat(61), cwd: '/x' },
      'Name must be 1–60 characters without control characters.'
    ]
  ])('%s → error', (_l, draft, message) => {
    expect(validateDraft(draft)).toEqual({ ok: false, error: message })
  })
})

describe('isDraftDirty', () => {
  it('a fresh empty draft is clean; typing makes it dirty', () => {
    expect(isDraftDirty(emptyDraft(), null)).toBe(false)
    expect(isDraftDirty({ ...emptyDraft(), name: 'x' }, null)).toBe(true)
  })
  it('an unchanged template draft is clean; a changed flag is dirty', () => {
    expect(isDraftDirty(toDraft(T), T)).toBe(false)
    expect(isDraftDirty({ ...toDraft(T), permissionChoice: 'auto' }, T)).toBe(true)
  })
  // `toDraft` round-trips workspaceId UNCHANGED, so an already-scoped template that nobody
  // edited must still read clean. (The companion test below covers the other direction — an
  // actual scope CHANGE does make the draft dirty.)
  it('an unchanged SCOPED template draft stays clean', () => {
    const scoped: Template = { ...T, workspaceId: 'w1' }
    expect(isDraftDirty(toDraft(scoped), scoped)).toBe(false)
  })
  // Task 11 — the scope select IS a real control now, so normalize() must include workspaceId.
  // Reverting that inclusion (the pre-Task-11 state) must turn this red.
  it('changing only the scope (workspaceId) makes the draft dirty', () => {
    expect(isDraftDirty(toDraft(T), T)).toBe(false)
    expect(isDraftDirty({ ...toDraft(T), workspaceId: 'w1' }, T)).toBe(true)
  })
})

describe('effort choice', () => {
  it('toDraft round-trips every level; validateDraft emits it', () => {
    for (const level of EFFORT_LEVELS) {
      const draft = toDraft({ ...T, effort: level })
      expect(draft.effortChoice).toBe(level)
      const v = validateDraft(draft)
      expect(v.ok && v.request.effort).toBe(level)
    }
  })

  it("'default' means null — nothing is passed to the spawn", () => {
    const v = validateDraft({ ...emptyDraft(), name: 'x', cwd: '/x', effortChoice: 'default' })
    expect(v.ok && v.request.effort).toBeNull()
  })

  // Without effortChoice in normalize(), changing ONLY the effort leaves Save disabled —
  // a silently broken feature. Reverting that line must turn this red.
  it('changing only the effort makes the draft dirty', () => {
    expect(isDraftDirty(toDraft(T), T)).toBe(false)
    expect(isDraftDirty({ ...toDraft(T), effortChoice: 'low' }, T)).toBe(true)
  })

  it('an untouched PRE-CHANGE template (effort null) is not dirty', () => {
    const legacy: Template = { ...T, effort: null }
    expect(isDraftDirty(toDraft(legacy), legacy)).toBe(false)
  })

  it('EFFORT_CHOICES opens with the default row, then the five levels in --help order', () => {
    expect(EFFORT_CHOICES.map((c) => c.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(EFFORT_CHOICES[0]?.label).toBe('Default (claude decides)')
    for (const level of EFFORT_LEVELS) expect(EFFORT_LABELS[level]).toBeTruthy()
  })
})

describe('copy', () => {
  it('templateErrorMessage maps the two known codes and falls back', () => {
    expect(
      templateErrorMessage(
        new Error("Error invoking remote method 'templates:save': Error: template_name_taken")
      )
    ).toBe('A template with this name already exists.')
    expect(templateErrorMessage(new Error('template_not_found'))).toBe(
      'This template no longer exists.'
    )
    expect(templateErrorMessage('boom')).toBe('Could not save the template.')
  })
  it('every permission mode has a label; describeTemplateFlags reads "model · mode · effort"', () => {
    for (const mode of PERMISSION_MODES) expect(PERMISSION_MODE_LABELS[mode]).toBeTruthy()
    expect(describeTemplateFlags(T)).toBe('opus · Plan · High effort')
    expect(describeTemplateFlags({ ...T, model: null, permissionMode: null, effort: null })).toBe(
      'default model · default permissions · default effort'
    )
  })
})
