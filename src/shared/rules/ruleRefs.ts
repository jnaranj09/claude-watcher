// Rules — reference & scope predicates shared by the rules store (save-time refusal, view-time
// broken detection), the tags store's `ruleRefs` wiring (T-16), and later phases (engine, UI).
// Written ONCE here: "does this rule use tag/template X" and "can a rule in scope A see an item in
// scope B" must never be re-derived inline at a second call site (spec §1.4, T-11).
import { isTagVisibleIn } from '../tags/tagScope'
import type { Rule } from '../schemas/rule'

type RuleRefShape = Pick<Rule, 'conditions' | 'actions'>

/** True when `rule` references `tagId` — in a `has-tag`/`lacks-tag` condition, or an action. */
export function ruleUsesTag(rule: RuleRefShape, tagId: string): boolean {
  return (
    rule.actions.some((action) => action.tagId === tagId) ||
    rule.conditions.some(
      (condition) =>
        (condition.kind === 'has-tag' || condition.kind === 'lacks-tag') &&
        condition.tagId === tagId
    )
  )
}

/** True when `rule` references `templateId` in a `template` condition. */
export function ruleUsesTemplate(rule: Pick<Rule, 'conditions'>, templateId: string): boolean {
  return rule.conditions.some(
    (condition) => condition.kind === 'template' && condition.templateId === templateId
  )
}

/**
 * T-11 — a rule scoped to `ruleWorkspaceId` (`null` = global) may reference an item (a tag or a
 * template) scoped to `itemWorkspaceId`: a global item is visible everywhere; a scoped item only
 * to its own workspace's rule. This is exactly `isTagVisibleIn`'s comparison, generalized to a
 * nullable viewer (a rule, unlike a card, may itself be global) — delegate to it rather than
 * repeat the comparison a second time.
 */
export function inRuleScope(
  ruleWorkspaceId: string | null,
  itemWorkspaceId: string | null
): boolean {
  return isTagVisibleIn({ workspaceId: itemWorkspaceId }, ruleWorkspaceId)
}
