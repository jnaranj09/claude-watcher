// Template schema rules the mutation run (StrykerJS) showed no test pinned: the trims, the
// `prompt_invalid` code the Templates dialog maps, the `$n` continuity check, the `params` path
// the dialog reads, and a save that never carries `favorite`.
import { describe, it, expect } from 'vitest'
import {
  ModelNameSchema,
  InitialPromptSchema,
  TemplateParamSchema,
  TemplateSchema,
  TemplateSaveSchema,
  compileParamPattern
} from './template'

const SAVE = {
  name: 'work api',
  cwd: '/work/api',
  model: null,
  permissionMode: null,
  effort: null,
  workspaceId: null,
  initialPrompt: null,
  params: []
}

const PARAM = { label: 'Ticket', pattern: '[A-Z]+-[0-9]+', maxLength: 20 }

describe('ModelNameSchema', () => {
  it('trims the model name', () => {
    expect(ModelNameSchema.parse('  opus  ')).toBe('opus')
  })

  it('refuses a model name with a space inside', () => {
    expect(ModelNameSchema.safeParse('opus 4').success).toBe(false)
  })
})

describe('compileParamPattern', () => {
  it('compiles with unicode so a property escape matches letters', () => {
    expect(compileParamPattern('\\p{L}+')?.test('abc')).toBe(true)
  })
})

describe('InitialPromptSchema — prompt_invalid', () => {
  it.each([
    ['a blank prompt', '   '],
    ['a control character', 'fix\u0007 it'],
    ['a leading dash', '-p do it'],
    ['a gap in $n', 'see $2']
  ])('refuses %s with the code prompt_invalid', (_case, prompt) => {
    const r = InitialPromptSchema.safeParse(prompt)
    expect(r.error?.issues[0]?.message).toBe('prompt_invalid')
  })

  it('refuses $1 and $3 without $2', () => {
    expect(InitialPromptSchema.safeParse('see $1 and $3').success).toBe(false)
  })

  it('accepts $1 and $2 in any order', () => {
    expect(InitialPromptSchema.safeParse('see $2 then $1').success).toBe(true)
  })
})

describe('TemplateParamSchema — label', () => {
  it('trims the label', () => {
    expect(TemplateParamSchema.parse({ ...PARAM, label: '  Ticket  ' }).label).toBe('Ticket')
  })

  it('refuses a control character in the middle of a label', () => {
    expect(TemplateParamSchema.safeParse({ ...PARAM, label: 'Tic\u0007ket' }).success).toBe(false)
  })
})

describe('the prompt and params agreement', () => {
  it('a template row whose params do not match the prompt fails at the params path', () => {
    const r = TemplateSchema.safeParse({
      ...SAVE,
      id: 'tpl-1',
      favorite: false,
      initialPrompt: 'see $1'
    })
    expect(r.error?.issues[0]?.path).toEqual(['params'])
  })

  it('a save whose params do not match the prompt fails at the params path', () => {
    const r = TemplateSaveSchema.safeParse({ ...SAVE, initialPrompt: 'see $1' })
    expect(r.error?.issues[0]?.path).toEqual(['params'])
  })
})

describe('TemplateSaveSchema', () => {
  it('a parsed save carries no favorite key, so a form Save never resets a pin', () => {
    expect(Object.keys(TemplateSaveSchema.parse(SAVE))).not.toContain('favorite')
  })
})
