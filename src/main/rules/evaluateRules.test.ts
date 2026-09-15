// Rules — the pure evaluation (spec §2; T-10, T-12, T-14, T-22, T-23). main-unit (node) project.
import { describe, it, expect } from 'vitest'
import {
  applyRules,
  conditionHolds,
  rulesInScope,
  triggerMatches,
  type RuleSubject,
  type RulesSnapshot
} from './evaluateRules'
import { launchTags } from './launchTags'
import type { Rule } from '../../shared/schemas/rule'

let n = 0
function rule(over: Partial<Rule> = {}): Rule {
  n += 1
  return {
    id: `r${n}`,
    name: `rule ${n}`,
    workspaceId: null,
    trigger: { kind: 'launched' },
    conditions: [],
    actions: [{ kind: 'add-tag', tagId: 't-new' }],
    ...over
  }
}

const SUBJECT: RuleSubject = {
  workspaceId: 'w1',
  tagIds: [],
  templateId: 'tpl-1',
  projectPath: '/home/op/work/API-prod',
  sessionName: 'billing api'
}
const snap = (...rules: Rule[]): RulesSnapshot => ({ rules, brokenIds: new Set() })
const LAUNCHED = { kind: 'launched' } as const
const W_TO_N = { kind: 'column-change', from: 'working', to: 'needs-you' } as const

describe('triggerMatches', () => {
  it('launched matches only a launched rule', () => {
    expect(triggerMatches(rule(), LAUNCHED)).toBe(true)
    expect(triggerMatches(rule(), W_TO_N)).toBe(false)
  })

  it('column-change matches from and to; "any" matches every column', () => {
    const exact = rule({ trigger: { kind: 'column-change', from: 'working', to: 'needs-you' } })
    const intoNeedsYou = rule({ trigger: { kind: 'column-change', from: 'any', to: 'needs-you' } })
    const outOfWorking = rule({ trigger: { kind: 'column-change', from: 'working', to: 'any' } })
    expect(triggerMatches(exact, W_TO_N)).toBe(true)
    expect(triggerMatches(exact, { kind: 'column-change', from: 'idle', to: 'needs-you' })).toBe(
      false
    )
    expect(
      triggerMatches(intoNeedsYou, { kind: 'column-change', from: 'idle', to: 'needs-you' })
    ).toBe(true)
    expect(
      triggerMatches(outOfWorking, { kind: 'column-change', from: 'working', to: 'idle' })
    ).toBe(true)
    expect(triggerMatches(outOfWorking, LAUNCHED)).toBe(false)
  })

  it('a time event matches its own rule only', () => {
    const timed = rule({ trigger: { kind: 'time-in-column', column: 'idle', minutes: 30 } })
    expect(triggerMatches(timed, { kind: 'time-in-column', ruleId: timed.id })).toBe(true)
    expect(triggerMatches(timed, { kind: 'time-in-column', ruleId: 'other' })).toBe(false)
  })
})

describe('rulesInScope (T-10 — a rule scope IS its workspace check)', () => {
  it('keeps global rules and the card workspace own ones, in list order', () => {
    const a = rule({ workspaceId: 'w1' })
    const b = rule({ workspaceId: null })
    const c = rule({ workspaceId: 'w2' })
    expect(rulesInScope([a, b, c], 'w1')).toEqual([a, b])
  })
})

describe('conditionHolds', () => {
  const S: RuleSubject = { ...SUBJECT, tagIds: ['t-pending'] }
  it('has-tag / lacks-tag read the tag list', () => {
    expect(conditionHolds({ kind: 'has-tag', tagId: 't-pending' }, S)).toBe(true)
    expect(conditionHolds({ kind: 'lacks-tag', tagId: 't-pending' }, S)).toBe(false)
  })
  it('template compares the launch template', () => {
    expect(conditionHolds({ kind: 'template', templateId: 'tpl-1' }, S)).toBe(true)
    expect(conditionHolds({ kind: 'template', templateId: 'tpl-2' }, S)).toBe(false)
  })
  it('folder reads the project path; name reads the session name', () => {
    expect(conditionHolds({ kind: 'folder', mode: 'contains', pattern: '-prod' }, S)).toBe(true)
    expect(conditionHolds({ kind: 'name', mode: 'regex', pattern: '^billing' }, S)).toBe(true)
    expect(conditionHolds({ kind: 'name', mode: 'regex', pattern: '^prod' }, S)).toBe(false)
  })
})

describe('applyRules', () => {
  it('AND — every condition must hold; no conditions means always', () => {
    const both = rule({
      conditions: [
        { kind: 'template', templateId: 'tpl-1' },
        { kind: 'folder', mode: 'contains', pattern: 'staging' }
      ]
    })
    expect(applyRules(snap(both), LAUNCHED, SUBJECT)).toEqual([])
    expect(applyRules(snap(rule()), LAUNCHED, SUBJECT)).toEqual(['t-new'])
  })

  it('SNAPSHOT (T-22) — rule 2 cannot see the tag rule 1 just added', () => {
    const r1 = rule({ actions: [{ kind: 'add-tag', tagId: 't-a' }] })
    const r2 = rule({
      conditions: [{ kind: 'has-tag', tagId: 't-a' }],
      actions: [{ kind: 'add-tag', tagId: 't-b' }]
    })
    expect(applyRules(snap(r1, r2), LAUNCHED, SUBJECT)).toEqual(['t-a'])
  })

  it('ORDER (T-14) — a later remove beats an earlier add, and a later add beats an earlier remove', () => {
    const add = rule({ actions: [{ kind: 'add-tag', tagId: 't-x' }] })
    const drop = rule({ actions: [{ kind: 'remove-tag', tagId: 't-x' }] })
    expect(applyRules(snap(add, drop), LAUNCHED, SUBJECT)).toEqual([])
    expect(applyRules(snap(drop, add), LAUNCHED, { ...SUBJECT, tagIds: ['t-x'] })).toEqual(['t-x'])
  })

  it('T-12 — a rule removes a tag that was added by hand (Jose’s pending_customer example)', () => {
    const clear = rule({
      trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
      conditions: [{ kind: 'has-tag', tagId: 't-pending' }],
      actions: [{ kind: 'remove-tag', tagId: 't-pending' }]
    })
    expect(
      applyRules(snap(clear), W_TO_N, { ...SUBJECT, tagIds: ['t-prod', 't-pending'] })
    ).toEqual(['t-prod'])
  })

  it('BROKEN (T-23) — a rule in brokenIds never fires', () => {
    const r = rule()
    expect(applyRules({ rules: [r], brokenIds: new Set([r.id]) }, LAUNCHED, SUBJECT)).toEqual([])
  })

  it('a rule scoped to another workspace never runs (T-10)', () => {
    expect(applyRules(snap(rule({ workspaceId: 'w2' })), LAUNCHED, SUBJECT)).toEqual([])
  })

  it('adding a tag the card already has adds nothing', () => {
    expect(applyRules(snap(rule()), LAUNCHED, { ...SUBJECT, tagIds: ['t-new'] })).toEqual(['t-new'])
  })
})

describe('launchTags (T-21 — the card is born tagged)', () => {
  const MINTED = {
    templateId: 'tpl-1',
    displayName: 'billing api',
    spawn: { cwd: '/home/op/work/API-prod' }
  }

  it('runs only the launched rules, against the launch template, folder and name', () => {
    const rules = snap(
      rule({
        conditions: [{ kind: 'template', templateId: 'tpl-1' }],
        actions: [{ kind: 'add-tag', tagId: 't-tpl' }]
      }),
      rule({
        conditions: [{ kind: 'folder', mode: 'contains', pattern: '-prod' }],
        actions: [{ kind: 'add-tag', tagId: 't-prod' }]
      }),
      rule({
        trigger: { kind: 'column-change', from: 'any', to: 'any' },
        actions: [{ kind: 'add-tag', tagId: 't-change' }]
      })
    )
    expect(launchTags(rules, MINTED, 'w1')).toEqual(['t-tpl', 't-prod'])
  })

  it('a blank display name falls back to the folder name, like the card title does', () => {
    const byName = rule({ conditions: [{ kind: 'name', mode: 'contains', pattern: 'API-prod' }] })
    expect(launchTags(snap(byName), { ...MINTED, displayName: '' }, 'w1')).toEqual(['t-new'])
  })
})
