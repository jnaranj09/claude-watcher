import { describe, it, expect } from 'vitest'
import {
  TemplateSchema,
  TemplateSaveSchema,
  TemplateDeleteSchema,
  TemplatesFileSchema,
  PERMISSION_MODES,
  EFFORT_LEVELS,
  TEMPLATE_NAME_MAX_LENGTH,
  MODEL_NAME_MAX_LENGTH,
  TEMPLATES_FILE_VERSION,
  compileParamPattern
} from './template'

const VALID = {
  id: 'tpl-1',
  name: 'work api',
  cwd: '/home/op/work/api',
  model: 'opus',
  permissionMode: 'acceptEdits',
  effort: 'high',
  workspaceId: null,
  initialPrompt: null,
  params: [],
  favorite: false
}

describe('TemplateSchema — fail-closed (our shape, no passthrough)', () => {
  it('accepts a full template and null flags', () => {
    expect(TemplateSchema.parse(VALID)).toEqual(VALID)
    expect(TemplateSchema.parse({ ...VALID, model: null, permissionMode: null })).toEqual({
      ...VALID,
      model: null,
      permissionMode: null
    })
  })

  it('trims the name and accepts a full model name', () => {
    const t = TemplateSchema.parse({ ...VALID, name: '  blog  ', model: 'claude-fable-5[1m]' })
    expect(t.name).toBe('blog')
    expect(t.model).toBe('claude-fable-5[1m]')
  })

  it.each([
    ['blank id', { ...VALID, id: '' }],
    ['blank name', { ...VALID, name: '   ' }],
    ['control char in name', { ...VALID, name: 'a\u0001b' }],
    ['name too long', { ...VALID, name: 'x'.repeat(TEMPLATE_NAME_MAX_LENGTH + 1) }],
    ['blank cwd', { ...VALID, cwd: '' }],
    ['whitespace in model', { ...VALID, model: 'opus 4' }],
    ['control char in model', { ...VALID, model: 'op\u0007us' }],
    ['model too long', { ...VALID, model: 'm'.repeat(MODEL_NAME_MAX_LENGTH + 1) }],
    ['empty model string (null is the way to say default)', { ...VALID, model: '' }],
    ['unknown permission mode', { ...VALID, permissionMode: 'yolo' }],
    ['not an object', 'nope']
  ])('rejects %s', (_label, input) => {
    expect(TemplateSchema.safeParse(input).success).toBe(false)
  })

  it('strips an unknown key (fail-closed = our shape, no passthrough)', () => {
    expect(TemplateSchema.parse({ ...VALID, extra: 1 })).toEqual(VALID)
  })

  it('lists exactly the six claude permission modes', () => {
    expect([...PERMISSION_MODES]).toEqual([
      'acceptEdits',
      'auto',
      'bypassPermissions',
      'manual',
      'dontAsk',
      'plan'
    ])
  })
})

describe('TemplateSaveSchema / TemplateDeleteSchema / TemplatesFileSchema', () => {
  it('save: id is optional (create) or a non-empty string (update)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, favorite: _favorite, ...noId } = VALID
    expect(TemplateSaveSchema.parse(noId)).toEqual(noId)
    expect(TemplateSaveSchema.parse({ ...noId, id: 'tpl-1' })).toEqual({ ...noId, id: 'tpl-1' })
    expect(TemplateSaveSchema.safeParse({ ...VALID, id: '' }).success).toBe(false)
  })

  it('delete: needs a non-empty id and nothing else', () => {
    expect(TemplateDeleteSchema.parse({ id: 'tpl-1' })).toEqual({ id: 'tpl-1' })
    expect(TemplateDeleteSchema.safeParse({ id: '' }).success).toBe(false)
    expect(TemplateDeleteSchema.parse({ id: 'tpl-1', name: 'x' })).toEqual({ id: 'tpl-1' })
  })

  it('file: version 1 with a template array; one bad row fails the whole file (backup+reset)', () => {
    expect(TemplatesFileSchema.parse({ version: 1, templates: [VALID] }).templates).toHaveLength(1)
    expect(TemplatesFileSchema.safeParse({ version: 2, templates: [] }).success).toBe(false)
    expect(
      TemplatesFileSchema.safeParse({ version: 1, templates: [VALID, { ...VALID, name: '' }] })
        .success
    ).toBe(false)
  })
})

describe('effort — the --effort level (additive, backward compatible)', () => {
  it('pins the level list to `claude --help` (low, medium, high, xhigh, max)', () => {
    expect([...EFFORT_LEVELS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('accepts every level and an explicit null', () => {
    for (const level of EFFORT_LEVELS) {
      expect(TemplateSchema.parse({ ...VALID, effort: level }).effort).toBe(level)
    }
    expect(TemplateSchema.parse({ ...VALID, effort: null }).effort).toBeNull()
  })

  // THE load-bearing case: a templates file written BEFORE this change has no `effort` key.
  // Without `.default(null)` the row fails, the FILE fails, and the store backs it up and
  // starts EMPTY — the operator loses every template. Reverting the `.default(null)` must
  // turn this test red.
  it('a row with no effort key parses as null (a pre-change file must still load)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effort: _effort, ...preChangeRow } = VALID
    expect('effort' in preChangeRow).toBe(false)
    expect(TemplateSchema.parse(preChangeRow).effort).toBeNull()
    expect(
      TemplatesFileSchema.parse({ version: 1, templates: [preChangeRow, preChangeRow] })
    ).toEqual({
      version: 1,
      templates: [
        { ...preChangeRow, effort: null },
        { ...preChangeRow, effort: null }
      ]
    })
  })

  it('TemplateSaveSchema inherits the field and the default', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, effort: _effort, ...saveRow } = VALID
    expect(TemplateSaveSchema.parse(saveRow).effort).toBeNull()
    expect(TemplateSaveSchema.parse({ ...saveRow, effort: 'xhigh' }).effort).toBe('xhigh')
  })

  it.each([
    ['an unknown level', 'ultracode'],
    ['a wrong-case level', 'LOW'],
    ['a blank string', ''],
    ['a number', 0],
    ['an object', {}]
  ])('rejects %s', (_label, effort) => {
    expect(TemplateSchema.safeParse({ ...VALID, effort }).success).toBe(false)
  })
})

describe('workspaceId — the item-level scope (Task 6)', () => {
  it('defaults workspaceId to null for a file written before the field existed', () => {
    const legacy = {
      version: 1,
      templates: [
        { id: 't1', name: 'T', cwd: '/p', model: null, permissionMode: null, effort: null }
      ]
    }
    const parsed = TemplatesFileSchema.parse(legacy)
    expect(parsed.templates[0]?.workspaceId).toBeNull()
  })

  it('keeps TEMPLATES_FILE_VERSION at 1 — a bump would wipe every saved template', () => {
    expect(TEMPLATES_FILE_VERSION).toBe(1)
  })
})

const BASE = {
  id: 't1',
  name: 'tickets',
  cwd: '/home/op/work',
  model: null,
  permissionMode: null,
  effort: null,
  workspaceId: null
}
const PARAM = { label: 'Ticket', pattern: '[A-Z]+-\\d+', maxLength: 20 }

describe('TemplateSchema — initialPrompt + params (programmatic API)', () => {
  it('a row without the new keys parses with null prompt and no params (backward compat)', () => {
    expect(TemplateSchema.parse(BASE)).toMatchObject({ initialPrompt: null, params: [] })
  })
  it('accepts a prompt with $1 and one matching param', () => {
    const t = TemplateSchema.parse({ ...BASE, initialPrompt: 'Work on $1', params: [PARAM] })
    expect(t.params).toHaveLength(1)
  })
  it('rejects a prompt whose highest $n differs from params.length', () => {
    const r = TemplateSchema.safeParse({
      ...BASE,
      initialPrompt: 'Work on $1 and $2',
      params: [PARAM]
    })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('params_mismatch')
  })
  it('rejects params on a null prompt', () => {
    expect(
      TemplateSchema.safeParse({ ...BASE, initialPrompt: null, params: [PARAM] }).success
    ).toBe(false)
  })
  it('rejects $* in a prompt', () => {
    expect(TemplateSchema.safeParse({ ...BASE, initialPrompt: 'Do $*', params: [] }).success).toBe(
      false
    )
  })
  it('rejects a prompt starting with a dash (claude would read a flag)', () => {
    expect(TemplateSchema.safeParse({ ...BASE, initialPrompt: '-x', params: [] }).success).toBe(
      false
    )
  })
  it('allows newlines but no other control characters', () => {
    expect(TemplateSchema.safeParse({ ...BASE, initialPrompt: 'a\nb', params: [] }).success).toBe(
      true
    )
    expect(TemplateSchema.safeParse({ ...BASE, initialPrompt: 'a\x1bb', params: [] }).success).toBe(
      false
    )
  })
  it('rejects a blank prompt and one over 2000 chars', () => {
    expect(TemplateSchema.safeParse({ ...BASE, initialPrompt: '   ', params: [] }).success).toBe(
      false
    )
    expect(
      TemplateSchema.safeParse({ ...BASE, initialPrompt: 'x'.repeat(2001), params: [] }).success
    ).toBe(false)
  })
  it('rejects a param pattern that does not compile', () => {
    const r = TemplateSchema.safeParse({
      ...BASE,
      initialPrompt: '$1',
      params: [{ ...PARAM, pattern: '(' }]
    })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('param_pattern_invalid')
  })
  // Review fix round 1 — the schema must reject the anchor-escaping pattern too, not just the
  // helper: `a)|(.*` would otherwise be saved as a param that accepts ANY value.
  it('rejects a param pattern that would escape the anchors', () => {
    const r = TemplateSchema.safeParse({
      ...BASE,
      initialPrompt: '$1',
      params: [{ label: 'x', pattern: 'a)|(.*', maxLength: 10 }]
    })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('param_pattern_invalid')
  })
  it('bounds label 1..30, pattern 1..200, maxLength 1..200', () => {
    expect(
      TemplateSchema.safeParse({ ...BASE, initialPrompt: '$1', params: [{ ...PARAM, label: '' }] })
        .success
    ).toBe(false)
    expect(
      TemplateSchema.safeParse({
        ...BASE,
        initialPrompt: '$1',
        params: [{ ...PARAM, maxLength: 201 }]
      }).success
    ).toBe(false)
    expect(
      TemplateSchema.safeParse({
        ...BASE,
        initialPrompt: '$1',
        params: [{ ...PARAM, maxLength: 0 }]
      }).success
    ).toBe(false)
  })
  it('TemplateSaveSchema carries the same fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...save } = BASE
    expect(
      TemplateSaveSchema.parse({ ...save, initialPrompt: '$1', params: [PARAM] }).params
    ).toHaveLength(1)
  })
  // `.omit()`/`.extend()` are taken off the RAW object, which carries no refine, so the save arg
  // needs its own copy of the agreement check. Without it the IPC seam would accept a request
  // TemplateSchema rejects — and the store would persist a row its own file schema fails closed
  // on, backing up the file and starting EMPTY on the next boot. Dropping the second refine
  // turns this red.
  it('TemplateSaveSchema enforces the prompt/params agreement too', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...save } = BASE
    const r = TemplateSaveSchema.safeParse({
      ...save,
      initialPrompt: 'Work on $1 and $2',
      params: [PARAM]
    })
    expect(r.success).toBe(false)
    expect(r.success ? '' : r.error.issues[0]?.message).toBe('params_mismatch')
  })
})

describe('compileParamPattern', () => {
  it('anchors the whole value', () => {
    const re = compileParamPattern('[A-Z]+-\\d+')
    expect(re?.test('HT-12')).toBe(true)
    expect(re?.test('xHT-12')).toBe(false)
    expect(re?.test('HT-12 ignore this')).toBe(false)
  })
  it('returns null for a pattern that does not compile', () => {
    expect(compileParamPattern('(')).toBeNull()
  })
  // Review fix round 1 — an UNBALANCED paren pattern escapes the anchoring by closing the
  // wrapper's own group: `a)|(.*` composes to `^(?:a)|(.*)$`, which is an alternation anchored
  // on NEITHER branch, so it matches every value and the param constrains nothing. `)(` composes
  // to the equally nonsensical `^(?:)()$`. Both fail to compile ON THEIR OWN, which is what the
  // standalone check catches. Removing that first `new RegExp(pattern, 'u')` turns this red.
  it('returns null for an unbalanced pattern that would escape the anchors', () => {
    expect(compileParamPattern('a)|(.*')).toBeNull()
    expect(compileParamPattern(')(')).toBeNull()
  })
})

describe('favorite', () => {
  it('an old row without favorite loads as false', () => {
    const file = TemplatesFileSchema.parse({
      version: 1,
      templates: [{ id: 't1', name: 'a', cwd: '/x', model: null, permissionMode: null }]
    })
    expect(file.templates[0]?.favorite).toBe(false)
  })
  it('the save schema does not carry favorite', () => {
    const parsed = TemplateSaveSchema.parse({
      name: 'a',
      cwd: '/x',
      model: null,
      permissionMode: null,
      favorite: true
    })
    expect('favorite' in parsed).toBe(false)
  })
})
