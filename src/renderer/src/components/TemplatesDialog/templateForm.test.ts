import { describe, it, expect } from 'vitest'
import {
  emptyDraft,
  toDraft,
  modelChoiceOf,
  placeholderCount,
  syncParamRows,
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
      initialPrompt: '',
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
      initialPrompt: '',
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
  // Programmatic API (Task 19) — the three codes main can now reject a save with. Without them
  // every prompt/param refusal reads as the generic fallback and the operator learns nothing.
  it('templateErrorMessage maps the prompt and param codes', () => {
    expect(templateErrorMessage(new Error('prompt_invalid'))).toBe(
      'The prompt is 1–2000 characters, newlines allowed, no other control characters.'
    )
    expect(templateErrorMessage(new Error('param_pattern_invalid'))).toBe(
      'A parameter pattern does not compile.'
    )
    expect(templateErrorMessage(new Error('params_mismatch'))).toBe(
      'Each $n in the prompt needs one parameter row.'
    )
  })
})

describe('templateForm — initial prompt and params', () => {
  it('placeholderCount is the highest $n; $$ does not count', () => {
    expect(placeholderCount('')).toBe(0)
    expect(placeholderCount('a $1 b $$2')).toBe(1)
    expect(placeholderCount('$2 then $1')).toBe(2)
  })
  it('syncParamRows pads with empty rows and trims extra ones, keeping existing values', () => {
    const one = [{ label: 'Ticket', pattern: 'x', maxLength: '10' }]
    expect(syncParamRows(one, 2)).toEqual([one[0], { label: '', pattern: '', maxLength: '50' }])
    expect(syncParamRows(one, 0)).toEqual([])
  })
  it('a blank prompt saves as null with no params', () => {
    const v = validateDraft({ ...emptyDraft(), name: 'n', cwd: '/w', initialPrompt: '   ' })
    expect(v.ok && v.request.initialPrompt).toBeNull()
    expect(v.ok && v.request.params).toEqual([])
  })
  it('a prompt with $1 needs a filled row; the errors name the field', () => {
    const base = { ...emptyDraft(), name: 'n', cwd: '/w', initialPrompt: 'Do $1' }
    expect(
      validateDraft({ ...base, params: [{ label: '', pattern: 'x', maxLength: '10' }] })
    ).toEqual({ ok: false, error: 'Give parameter $1 a label.' })
    expect(
      validateDraft({ ...base, params: [{ label: 'T', pattern: '(', maxLength: '10' }] })
    ).toEqual({ ok: false, error: 'Parameter $1: the pattern does not compile.' })
    expect(
      validateDraft({ ...base, params: [{ label: 'T', pattern: 'x', maxLength: '0' }] })
    ).toEqual({ ok: false, error: 'Parameter $1: max length must be 1–200.' })
    const ok = validateDraft({ ...base, params: [{ label: 'T', pattern: 'x', maxLength: '10' }] })
    expect(ok.ok && ok.request.params).toEqual([{ label: 'T', pattern: 'x', maxLength: 10 }])
  })
  it('a prompt starting with - or using $* is refused with copy', () => {
    const base = { ...emptyDraft(), name: 'n', cwd: '/w' }
    expect(validateDraft({ ...base, initialPrompt: '-x' })).toEqual({
      ok: false,
      error: 'The prompt must not start with “-” and must not use $*.'
    })
    expect(validateDraft({ ...base, initialPrompt: 'a $*' })).toEqual({
      ok: false,
      error: 'The prompt must not start with “-” and must not use $*.'
    })
  })
  // Review round 1, Important — a GAP used to dead-end the operator: the form drew rows for
  // `$1`/`$2` (the COUNT, not the numbers used) while the prompt said `$1`/`$3`, and the only
  // refusal came from the schema's continuity refine, whose issue path is `initialPrompt` — so
  // the hint read the length/control-character sentence and named nothing. The form names the
  // missing number itself now. Dropping the gap loop turns this red.
  it('a prompt that skips a number says which one is missing', () => {
    const base = { ...emptyDraft(), name: 'n', cwd: '/w' }
    expect(validateDraft({ ...base, initialPrompt: 'Do $1 $3' })).toEqual({
      ok: false,
      error: 'The prompt uses $3 but not $2. Number the placeholders from $1 with no gaps.'
    })
    expect(validateDraft({ ...base, initialPrompt: 'Do $2' })).toEqual({
      ok: false,
      error: 'The prompt uses $2 but not $1. Number the placeholders from $1 with no gaps.'
    })
    const rows = [
      { label: 'A', pattern: 'x', maxLength: '10' },
      { label: 'B', pattern: 'y', maxLength: '10' }
    ]
    const ok = validateDraft({ ...base, initialPrompt: 'Do $1 $2', params: rows })
    expect(ok.ok && ok.request.initialPrompt).toBe('Do $1 $2')
  })
  it('toDraft round-trips prompt and params as strings', () => {
    const d = toDraft({
      id: 'a',
      name: 'n',
      cwd: '/w',
      model: null,
      permissionMode: null,
      effort: null,
      workspaceId: null,
      initialPrompt: 'Do $1',
      params: [{ label: 'T', pattern: 'x', maxLength: 10 }]
    })
    expect(d.initialPrompt).toBe('Do $1')
    expect(d.params).toEqual([{ label: 'T', pattern: 'x', maxLength: '10' }])
  })
  // Carry-over — normalize() is the dirtiness key. Leaving initialPrompt (or params) out of it
  // means editing ONLY the prompt never enables Save: a silently dead field. Dropping either
  // line from normalize() must turn this red.
  it('changing only the prompt — or only a param row — makes the draft dirty', () => {
    const withPrompt: Template = {
      ...T,
      initialPrompt: 'Do $1',
      params: [{ label: 'T', pattern: 'x', maxLength: 10 }]
    }
    expect(isDraftDirty(toDraft(T), T)).toBe(false)
    expect(isDraftDirty({ ...toDraft(T), initialPrompt: 'Do it' }, T)).toBe(true)
    expect(isDraftDirty(toDraft(withPrompt), withPrompt)).toBe(false)
    expect(
      isDraftDirty(
        { ...toDraft(withPrompt), params: [{ label: 'Ticket', pattern: 'x', maxLength: '10' }] },
        withPrompt
      )
    ).toBe(true)
  })
  // Carry-over — toDraft must COPY the rows. Handing the editor the store's own param objects
  // lets an in-place edit write into the template the board still renders.
  it('toDraft copies the param rows instead of aliasing the template object', () => {
    const template: Template = {
      ...T,
      initialPrompt: 'Do $1',
      params: [{ label: 'T', pattern: 'x', maxLength: 10 }]
    }
    const row = toDraft(template).params[0]
    if (row === undefined) throw new Error('expected one param row')
    row.label = 'edited'
    expect(template.params[0]?.label).toBe('T')
  })
})
