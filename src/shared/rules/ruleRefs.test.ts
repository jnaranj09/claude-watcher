import { describe, it, expect } from 'vitest'
import { inRuleScope, ruleUsesTag, ruleUsesTemplate } from './ruleRefs'
import type { Rule } from '../schemas/rule'

const RULE: Pick<Rule, 'conditions' | 'actions'> = {
  conditions: [
    { kind: 'has-tag', tagId: 't1' },
    { kind: 'template', templateId: 'tpl1' }
  ],
  actions: [{ kind: 'add-tag', tagId: 't2' }]
}

describe('ruleUsesTag', () => {
  it('finds a tag referenced by a has-tag condition', () => {
    expect(ruleUsesTag(RULE, 't1')).toBe(true)
  })

  it('finds a tag referenced by an action', () => {
    expect(ruleUsesTag(RULE, 't2')).toBe(true)
  })

  it('a lacks-tag condition counts too', () => {
    const rule: Pick<Rule, 'conditions' | 'actions'> = {
      conditions: [{ kind: 'lacks-tag', tagId: 't3' }],
      actions: [{ kind: 'add-tag', tagId: 't2' }]
    }
    expect(ruleUsesTag(rule, 't3')).toBe(true)
  })

  it('is false for a tag the rule never mentions', () => {
    expect(ruleUsesTag(RULE, 't-nobody')).toBe(false)
  })
})

describe('ruleUsesTemplate', () => {
  it('finds a template referenced by a template condition', () => {
    expect(ruleUsesTemplate(RULE, 'tpl1')).toBe(true)
  })

  it('is false for a template the rule never mentions', () => {
    expect(ruleUsesTemplate(RULE, 'tpl-nobody')).toBe(false)
  })
})

describe('inRuleScope (T-11 — a rule sees global items plus its own workspace’s)', () => {
  it('a global rule (null) sees a global item only', () => {
    expect(inRuleScope(null, null)).toBe(true)
    expect(inRuleScope(null, 'w1')).toBe(false)
  })

  it('a workspace rule sees global items and its own workspace’s', () => {
    expect(inRuleScope('w1', null)).toBe(true)
    expect(inRuleScope('w1', 'w1')).toBe(true)
    expect(inRuleScope('w1', 'w2')).toBe(false)
  })
})
