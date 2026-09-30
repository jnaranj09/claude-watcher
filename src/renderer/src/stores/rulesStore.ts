// Rules — the renderer PROJECTION of main's rule list (state.md: main is truth; this is a hydrated
// copy, replaced wholesale from every IPC result). The RUN order is kept exactly as main sends it —
// never re-sorted here (spec T-14: the order you see is the order that runs).
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Rule, RuleSaveRequest, RulesListResult } from '../../../shared/ipc/contract'
import { inRuleScope, ruleUsesTag, ruleUsesTemplate } from '../../../shared/rules/ruleRefs'

export interface RulesState {
  rules: Rule[]
  /** Rules that can never fire (T-23) — the dialog marks them. */
  brokenIds: string[]
  loaded: boolean
  /** Action feedback (spec 2026-09-29 §2.6) — the startup load failed; any hydrate clears it. */
  loadFailed: boolean
  hydrate: (view: RulesListResult) => void
  markLoadFailed: () => void
}

export function createRulesViewStore(): StoreApi<RulesState> {
  return createStore<RulesState>((set) => ({
    rules: [],
    brokenIds: [],
    loaded: false,
    loadFailed: false,
    hydrate: (view) =>
      set({ rules: view.rules, brokenIds: view.brokenIds, loaded: true, loadFailed: false }),
    markLoadFailed: () => set({ loadFailed: true })
  }))
}

export const rulesStore = createRulesViewStore()

export function useRules<T>(selector: (state: RulesState) => T): T {
  return useStore(rulesStore, selector)
}

export const selectRules = (s: RulesState): Rule[] => s.rules
export const selectBrokenIds = (s: RulesState): string[] => s.brokenIds
export const selectRulesLoaded = (s: RulesState): boolean => s.loaded
/** True only while nothing loaded AND the load failed — the dialog says so instead of "none yet". */
export const selectRulesLoadFailed = (s: RulesState): boolean =>
  !selectRulesLoaded(s) && s.loadFailed

/** How many rules use a tag, in a condition or an action — the "Used by N rules" copy (T-16).
 *  Delegates to the shared `ruleUsesTag` predicate (ruleRefs.ts) — the same one main uses — rather
 *  than re-deriving the condition/action shape here. */
export function rulesUsingTag(rules: readonly Rule[], tagId: string): number {
  return rules.filter((r) => ruleUsesTag(r, tagId)).length
}

/** How many rules use a template (T-17). Delegates to the shared `ruleUsesTemplate` predicate. */
export function rulesUsingTemplate(rules: readonly Rule[], templateId: string): number {
  return rules.filter((r) => ruleUsesTemplate(r, templateId)).length
}

/** How many rules that use a template could no longer see it in `workspaceId` — the rules main
 *  refuses a template scope change for (§1.4). The same shared predicates main runs. */
export function rulesLosingTemplate(
  rules: readonly Rule[],
  templateId: string,
  workspaceId: string | null
): number {
  return rules.filter(
    (r) => ruleUsesTemplate(r, templateId) && !inRuleScope(r.workspaceId, workspaceId)
  ).length
}

const LOG_PREFIX = '[claude-watcher][rules]'

/** Resolves whether it worked (the startup toast names the failures). Never rejects. */
export async function loadRules(): Promise<boolean> {
  try {
    rulesStore.getState().hydrate(await window.rules.list())
    return true
  } catch {
    console.warn(`${LOG_PREFIX} code=rules_load_failed`)
    rulesStore.getState().markLoadFailed()
    return false
  }
}

/** Rethrows: the Rules form maps `rule_bad_pattern` etc. to copy. */
export async function saveRule(req: RuleSaveRequest): Promise<Rule> {
  const result = await window.rules.save(req)
  rulesStore.getState().hydrate(result)
  return result.saved
}

/** Rethrows: the Rules dialog error line shows it. */
export async function removeRule(id: string): Promise<void> {
  rulesStore.getState().hydrate(await window.rules.remove(id))
}

/** Logs a code and RETHROWS: the Rules dialog says so on its error line (spec 2026-09-29 §2.5 — a
 *  refused move used to be console-only). The list stays as main last sent it. */
export async function moveRule(id: string, toIndex: number): Promise<void> {
  try {
    rulesStore.getState().hydrate(await window.rules.move(id, toIndex))
  } catch (err) {
    console.warn(`${LOG_PREFIX} code=rules_move_failed`)
    throw err
  }
}

/** "Used by 2 rules. Change or delete them first." — the Tags and Templates dialogs' refusal copy
 *  for `tag_in_use` / `template_in_use` (T-16, T-17). */
export function usedByRulesCopy(count: number): string {
  return count === 1
    ? 'Used by 1 rule. Change or delete it first.'
    : `Used by ${count} rules. Change or delete them first.`
}
