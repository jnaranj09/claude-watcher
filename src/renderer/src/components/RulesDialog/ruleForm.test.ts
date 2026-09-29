import { describe, it, expect } from 'vitest'
import {
  MINUTES_CHOICES,
  MODE_CHOICES,
  conditionFor,
  emptyDraft,
  isDraftDirty,
  rescopeDraft,
  minutesFrom,
  ruleErrorMessage,
  toDraft,
  triggerFor,
  triggerSummary,
  validateDraft,
  type RuleDraft
} from './ruleForm'
import { usedByRulesCopy } from '../../stores/rulesStore'
import type { Rule } from '../../../../shared/ipc/contract'
import { TEXT_MATCH_MODES } from '../../../../shared/schemas/rule'

const RULE: Rule = {
  id: 'r1',
  name: 'clear pending',
  workspaceId: null,
  trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
  conditions: [{ kind: 'has-tag', tagId: 't-pending' }],
  actions: [{ kind: 'remove-tag', tagId: 't-pending' }]
}
const GOOD: RuleDraft = { ...toDraft(RULE), name: '  clear pending  ' }

describe('triggerSummary — the one line under a rule row', () => {
  it('names each trigger', () => {
    expect(triggerSummary({ kind: 'launched' })).toBe('On launch')
    expect(triggerSummary({ kind: 'column-change', from: 'working', to: 'needs-you' })).toBe(
      'Working → Needs you'
    )
    expect(triggerSummary({ kind: 'column-change', from: 'any', to: 'idle' })).toBe('Any → Idle')
    expect(triggerSummary({ kind: 'time-in-column', column: 'idle', minutes: 120 })).toBe(
      'Idle for 2 h'
    )
  })

  it('labels the minutes the way the dropdown does', () => {
    expect(MINUTES_CHOICES.map((c) => c.label)).toEqual([
      '5 min',
      '10 min',
      '15 min',
      '30 min',
      '1 h',
      '2 h',
      '4 h',
      '8 h',
      '24 h'
    ])
    expect(minutesFrom('240')).toBe(240)
  })

  it('MODE_CHOICES is derived from TEXT_MATCH_MODES, not a re-typed literal', () => {
    expect(MODE_CHOICES.map((c) => c.value)).toEqual([...TEXT_MATCH_MODES])
  })
})

describe('validateDraft', () => {
  it('a finished draft becomes the save request, name trimmed, id kept when editing', () => {
    const r = validateDraft(GOOD, 'r1')
    expect(r).toEqual({ ok: true, request: { ...RULE, name: 'clear pending' } })
  })

  it('says what is missing', () => {
    expect(validateDraft({ ...GOOD, name: '  ' }, undefined)).toEqual({
      ok: false,
      error: 'Give the rule a name.'
    })
    expect(validateDraft({ ...GOOD, actions: [] }, undefined)).toEqual({
      ok: false,
      error: 'Add at least one action, with a tag.'
    })
    expect(
      validateDraft({ ...GOOD, actions: [{ kind: 'add-tag', tagId: '' }] }, undefined)
    ).toEqual({
      ok: false,
      error: 'Add at least one action, with a tag.'
    })
    expect(
      validateDraft({ ...GOOD, conditions: [{ kind: 'lacks-tag', tagId: '' }] }, undefined)
    ).toEqual({ ok: false, error: 'Finish or remove the unfinished condition.' })
  })

  it('an invalid regex is named as such, before main ever sees it', () => {
    expect(
      validateDraft(
        { ...GOOD, conditions: [{ kind: 'name', mode: 'regex', pattern: '(' }] },
        undefined
      )
    ).toEqual({ ok: false, error: 'That pattern is not a valid regular expression.' })
  })
})

describe('draft helpers', () => {
  it('each trigger kind starts from a sensible value', () => {
    expect(triggerFor('launched')).toEqual({ kind: 'launched' })
    expect(triggerFor('column-change')).toEqual({
      kind: 'column-change',
      from: 'any',
      to: 'needs-you'
    })
    expect(triggerFor('time-in-column')).toEqual({
      kind: 'time-in-column',
      column: 'idle',
      minutes: 30
    })
  })

  it('a new condition is pre-filled with the first tag / template the rule may use', () => {
    expect(conditionFor('has-tag', 't1', 'tpl1')).toEqual({ kind: 'has-tag', tagId: 't1' })
    expect(conditionFor('template', 't1', 'tpl1')).toEqual({ kind: 'template', templateId: 'tpl1' })
    expect(conditionFor('folder', 't1', 'tpl1')).toEqual({
      kind: 'folder',
      mode: 'contains',
      pattern: ''
    })
  })

  it('dirty ignores whitespace-only name edits; a new empty draft is clean', () => {
    expect(isDraftDirty(toDraft(RULE), RULE)).toBe(false)
    expect(isDraftDirty({ ...toDraft(RULE), name: 'clear pending ' }, RULE)).toBe(false)
    expect(isDraftDirty({ ...toDraft(RULE), name: 'renamed' }, RULE)).toBe(true)
    expect(isDraftDirty(emptyDraft(), null)).toBe(false)
  })
})

describe('copy', () => {
  it('maps a wrapped main error to operator copy, never the raw message', () => {
    expect(
      ruleErrorMessage(
        new Error("Error invoking remote method 'rules:save': Error: rule_ref_out_of_scope")
      )
    ).toBe('This rule uses a tag or template its workspace cannot see.')
    expect(ruleErrorMessage(new Error('something/else'))).toBe('Something went wrong. Try again.')
  })

  it('"Used by N rules" is singular and plural', () => {
    expect(usedByRulesCopy(1)).toBe('Used by 1 rule. Change or delete it first.')
    expect(usedByRulesCopy(3)).toBe('Used by 3 rules. Change or delete them first.')
  })
})

// R15 — the pure half: a scope change keeps every ref the new scope can see, and resets the rest
// to the first visible item ('' when there is none, which validation then asks for).
describe('rescopeDraft', () => {
  const tags = [
    { id: 't-ops', workspaceId: 'w1' },
    { id: 't-pending', workspaceId: null }
  ]
  const templates = [
    { id: 'tpl-ops', workspaceId: 'w1' },
    { id: 'tpl-web', workspaceId: 'w2' }
  ]
  const draft: RuleDraft = {
    ...emptyDraft(),
    workspaceId: 'w1',
    conditions: [
      { kind: 'has-tag', tagId: 't-ops' },
      { kind: 'lacks-tag', tagId: 't-pending' },
      { kind: 'template', templateId: 'tpl-ops' },
      { kind: 'name', mode: 'contains', pattern: 'api' }
    ],
    actions: [{ kind: 'add-tag', tagId: 't-ops' }]
  }

  it('resets out-of-scope refs and keeps the visible ones', () => {
    const next = rescopeDraft(draft, null, tags, templates)
    expect(next.workspaceId).toBeNull()
    expect(next.conditions).toEqual([
      { kind: 'has-tag', tagId: 't-pending' },
      { kind: 'lacks-tag', tagId: 't-pending' },
      { kind: 'template', templateId: '' },
      { kind: 'name', mode: 'contains', pattern: 'api' }
    ])
    expect(next.actions).toEqual([{ kind: 'add-tag', tagId: 't-pending' }])
  })

  it('changes nothing but the scope when every ref stays visible', () => {
    const next = rescopeDraft(draft, 'w1', tags, templates)
    expect(next).toEqual(draft)
  })

  it('picks the new workspace’s own template', () => {
    const next = rescopeDraft(draft, 'w2', tags, templates)
    expect(next.conditions[2]).toEqual({ kind: 'template', templateId: 'tpl-web' })
  })
})
