import { describe, it, expect } from 'vitest'
import {
  EMPTY_RULES_FILE,
  RULE_PATTERN_MAX_LENGTH,
  RULES_FILE_VERSION,
  RuleMoveSchema,
  RuleSaveSchema,
  RuleSchema,
  RulesFileSchema,
  TIME_RULE_MINUTES
} from './rule'

const RULE = {
  id: 'r1',
  name: 'clear pending on needs-you',
  workspaceId: null,
  trigger: { kind: 'column-change', from: 'working', to: 'needs-you' },
  conditions: [{ kind: 'has-tag', tagId: 't-pending' }],
  actions: [{ kind: 'remove-tag', tagId: 't-pending' }]
}
const ok = (input: unknown): boolean => RuleSchema.safeParse(input).success

describe('RuleSchema', () => {
  it('accepts each trigger kind', () => {
    expect(ok(RULE)).toBe(true)
    expect(ok({ ...RULE, trigger: { kind: 'launched' } })).toBe(true)
    expect(ok({ ...RULE, trigger: { kind: 'column-change', from: 'any', to: 'any' } })).toBe(true)
    expect(ok({ ...RULE, trigger: { kind: 'time-in-column', column: 'idle', minutes: 30 } })).toBe(
      true
    )
  })

  // W-11 — removing `.default(null)` from RuleSchema.workspaceId must turn this red.
  it('reads a rule written without workspaceId back as GLOBAL', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { workspaceId: _drop, ...old } = RULE
    expect(RuleSchema.parse(old).workspaceId).toBeNull()
  })

  it('a time rule offers only the fixed minutes, and names a real column (never "any")', () => {
    expect([...TIME_RULE_MINUTES]).toEqual([5, 10, 15, 30, 60, 120, 240, 480, 1440])
    expect(ok({ ...RULE, trigger: { kind: 'time-in-column', column: 'idle', minutes: 7 } })).toBe(
      false
    )
    expect(ok({ ...RULE, trigger: { kind: 'time-in-column', column: 'any', minutes: 30 } })).toBe(
      false
    )
  })

  it('needs at least one action; no conditions means "always"', () => {
    expect(ok({ ...RULE, actions: [] })).toBe(false)
    expect(ok({ ...RULE, conditions: [] })).toBe(true)
  })

  it('accepts every condition kind and fails closed on a mismatched shape', () => {
    for (const condition of [
      { kind: 'has-tag', tagId: 't' },
      { kind: 'lacks-tag', tagId: 't' },
      { kind: 'template', templateId: 'tpl' },
      { kind: 'folder', mode: 'contains', pattern: '/prod' },
      { kind: 'name', mode: 'regex', pattern: '^api' }
    ]) {
      expect(ok({ ...RULE, conditions: [condition] }), JSON.stringify(condition)).toBe(true)
    }
    expect(ok({ ...RULE, conditions: [{ kind: 'name', tagId: 't' }] })).toBe(false)
    expect(ok({ ...RULE, conditions: [{ kind: 'folder', mode: 'contains', pattern: '' }] })).toBe(
      false
    )
    expect(
      ok({
        ...RULE,
        conditions: [
          { kind: 'folder', mode: 'contains', pattern: 'x'.repeat(RULE_PATTERN_MAX_LENGTH + 1) }
        ]
      })
    ).toBe(false)
  })

  // T-23 — the FILE never compiles patterns: one bad regex makes one rule inert, never a reset.
  it('a pattern that is not a valid regex still PARSES', () => {
    expect(ok({ ...RULE, conditions: [{ kind: 'folder', mode: 'regex', pattern: '(' }] })).toBe(
      true
    )
  })
})

describe('RuleSaveSchema / RuleMoveSchema / RulesFileSchema', () => {
  it('no id ⇒ create; an id ⇒ update', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...create } = RULE
    expect(RuleSaveSchema.safeParse(create).success).toBe(true)
    expect(RuleSaveSchema.parse(RULE).id).toBe('r1')
  })

  it('a move names a rule and a non-negative whole index', () => {
    expect(RuleMoveSchema.safeParse({ id: 'r1', toIndex: 0 }).success).toBe(true)
    expect(RuleMoveSchema.safeParse({ id: 'r1', toIndex: -1 }).success).toBe(false)
    expect(RuleMoveSchema.safeParse({ id: 'r1', toIndex: 1.5 }).success).toBe(false)
  })

  it('parses the empty v1 file and refuses any other version', () => {
    expect(RulesFileSchema.parse(EMPTY_RULES_FILE)).toEqual({
      version: RULES_FILE_VERSION,
      rules: []
    })
    expect(RulesFileSchema.safeParse({ version: 2, rules: [] }).success).toBe(false)
  })
})
