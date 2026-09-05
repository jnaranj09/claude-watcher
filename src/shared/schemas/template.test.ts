import { describe, it, expect } from 'vitest'
import {
  TemplateSchema,
  TemplateSaveSchema,
  TemplateDeleteSchema,
  TemplatesFileSchema,
  PERMISSION_MODES,
  EFFORT_LEVELS,
  TEMPLATE_NAME_MAX_LENGTH,
  MODEL_NAME_MAX_LENGTH
} from './template'

const VALID = {
  id: 'tpl-1',
  name: 'work api',
  cwd: '/home/op/work/api',
  model: 'opus',
  permissionMode: 'acceptEdits',
  effort: 'high'
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
    const { id: _id, ...noId } = VALID
    expect(TemplateSaveSchema.parse(noId)).toEqual(noId)
    expect(TemplateSaveSchema.parse(VALID)).toEqual(VALID)
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
