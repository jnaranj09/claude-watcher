// Rules — the PURE evaluation (spec §2): the rules + ONE event + a card snapshot → the card's new
// tag list. No store, no clock, no IO: the per-window engine and the launch path both call it.
//
//   SCOPE    (T-10) only rules that are global or scoped to the card's workspace run — delegated
//            to `inRuleScope` (ruleRefs.ts), the ONE place that comparison lives.
//   ORDER    (T-14) top to bottom; a later rule's action overrides an earlier one's.
//   SNAPSHOT (T-22) every condition reads the card as it was BEFORE this event's rules ran, so
//                   nothing chains inside one event — which keeps T-3's no-loops guarantee simple.
//   BROKEN   (T-23) a rule in `brokenIds` never fires.
import type { Column } from '../../shared/ipc/contract'
import type { Rule, RuleCondition } from '../../shared/schemas/rule'
import type { Session } from '../../shared/schemas/session'
import { textMatches } from '../../shared/rules/matchText'
import { inRuleScope } from '../../shared/rules/ruleRefs'

export type RuleEvent =
  | { kind: 'launched' }
  | { kind: 'column-change'; from: Column; to: Column }
  | { kind: 'time-in-column'; ruleId: string }

/** What a rule may look at on a card. */
export interface RuleSubject {
  workspaceId: string
  tagIds: readonly string[]
  templateId: string | null
  projectPath: string
  sessionName: string
}

/** The rules as the engine reads them: run order + the ids that can never fire. */
export interface RulesSnapshot {
  rules: readonly Rule[]
  brokenIds: ReadonlySet<string>
}

export function rulesInScope(rules: readonly Rule[], workspaceId: string): Rule[] {
  // inRuleScope(ruleWorkspaceId, itemWorkspaceId) reads "itemWorkspaceId===null || itemWorkspaceId
  // ===ruleWorkspaceId". Here the RULE plays the item role (its workspaceId may be null = global)
  // and the card's workspace plays the viewer role, so the rule's own workspaceId is the second arg.
  return rules.filter((r) => inRuleScope(workspaceId, r.workspaceId))
}

export function triggerMatches(rule: Rule, event: RuleEvent): boolean {
  const trigger = rule.trigger
  switch (event.kind) {
    case 'launched':
      return trigger.kind === 'launched'
    case 'column-change':
      return (
        trigger.kind === 'column-change' &&
        (trigger.from === 'any' || trigger.from === event.from) &&
        (trigger.to === 'any' || trigger.to === event.to)
      )
    case 'time-in-column':
      return trigger.kind === 'time-in-column' && rule.id === event.ruleId
  }
}

export function conditionHolds(condition: RuleCondition, subject: RuleSubject): boolean {
  switch (condition.kind) {
    case 'has-tag':
      return subject.tagIds.includes(condition.tagId)
    case 'lacks-tag':
      return !subject.tagIds.includes(condition.tagId)
    case 'template':
      return subject.templateId === condition.templateId
    case 'folder':
      return textMatches(condition, subject.projectPath)
    case 'name':
      return textMatches(condition, subject.sessionName)
  }
}

/** The card's tag list after `event`'s rules ran: the card's own order, new tags appended. */
export function applyRules(
  snapshot: RulesSnapshot,
  event: RuleEvent,
  subject: RuleSubject
): string[] {
  let tags = [...subject.tagIds]
  for (const rule of rulesInScope(snapshot.rules, subject.workspaceId)) {
    if (snapshot.brokenIds.has(rule.id) || !triggerMatches(rule, event)) continue
    // T-22 — conditions read the ORIGINAL subject, never the `tags` being built.
    if (!rule.conditions.every((c) => conditionHolds(c, subject))) continue
    for (const action of rule.actions) {
      if (action.kind === 'add-tag') {
        if (!tags.includes(action.tagId)) tags = [...tags, action.tagId]
      } else {
        tags = tags.filter((id) => id !== action.tagId)
      }
    }
  }
  return tags
}

/** What a live card presents to the rules. */
export function subjectOf(session: Session): RuleSubject {
  return {
    workspaceId: session.workspaceId,
    tagIds: session.tagIds,
    templateId: session.templateId,
    projectPath: session.projectPath,
    sessionName: session.sessionName
  }
}
