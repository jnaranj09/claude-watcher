// Rules — the main-owned rule list (spec §1.2). ARRAY ORDER IS RUN ORDER (T-14): a new rule goes
// last, an update keeps its place, and `move` is the only reorder. Its own file, so a corrupt rules
// blob can never reset another store. NEVER log a rule value (names are operator text, patterns can
// hold paths) — codes only.
//
// Integrity (§1.4, T-11, T-23): `save` refuses a rule that references a tag or template that does
// not exist or that its scope cannot see, or whose regex does not compile. A STORED rule in that
// state (a hand edit, a reset catalog) is not refused — it is reported in `brokenIds` and never
// fires. The catalogs are reached through injected lookups (the repo's DI style), never imports.
//
// Reference/scope logic (ruleUsesTag / ruleUsesTemplate / inRuleScope) lives ONCE in
// `../../shared/rules/ruleRefs.ts` — this store calls it rather than repeating the comparison
// (later phases — the engine, the rules UI — import the same module).
import { randomUUID } from 'node:crypto'
import {
  EMPTY_RULES_FILE,
  RULES_FILE_VERSION,
  RulesFileSchema,
  type Rule,
  type RuleCondition,
  type RuleSaveRequest,
  type RulesFile
} from '../../shared/schemas/rule'
import type { RulesListResult, RulesSaveResult } from '../../shared/ipc/contract'
import { patternCompiles } from '../../shared/rules/matchText'
import { inRuleScope, ruleUsesTag, ruleUsesTemplate } from '../../shared/rules/ruleRefs'
import {
  createInMemoryBlobStore,
  loadPersistedOrReset,
  type PersistedBlobStore
} from './persistedBlob'
import type { TagRuleRef } from './tags'
import type { TemplateRuleRef } from './templates'

export type RulesBlobStore = PersistedBlobStore<RulesFile>

/** Error messages thrown across the IPC seam; the renderer maps them back to copy. */
export const RULE_ERROR = {
  notFound: 'rule_not_found',
  badPattern: 'rule_bad_pattern',
  refMissing: 'rule_ref_missing',
  refOutOfScope: 'rule_ref_out_of_scope'
} as const
type RuleProblem = (typeof RULE_ERROR)[keyof typeof RULE_ERROR]

/** What a rule can point at — its scope — or null when it does not exist. */
export type ScopedLookup = (id: string) => { workspaceId: string | null } | null

export interface RulesStoreOptions {
  blobStore?: RulesBlobStore
  log?: (message: string) => void
  newId?: () => string
  /** The tag catalog. index.ts binds it late (the tags store); the default knows no tag. */
  lookupTag?: ScopedLookup
  /** The templates store, same. */
  lookupTemplate?: ScopedLookup
}

export interface RulesStore {
  /** In RUN order. */
  list(): Rule[]
  get(id: string): Rule | null
  /** The list + the ids of rules that can never fire (T-23). */
  view(): RulesListResult
  /** Throws RULE_ERROR.notFound / refMissing / refOutOfScope / badPattern. Trusts its typed input —
   *  the IPC handler (rulesIpc.ts) is the parse boundary. */
  save(input: RuleSaveRequest): RulesSaveResult
  /** Unknown id is a no-op (idempotent). */
  remove(id: string): RulesListResult
  /** Puts the rule at FINAL index `toIndex` (clamped). Throws RULE_ERROR.notFound. */
  move(id: string, toIndex: number): RulesListResult
  /** Workspaces — delete every rule scoped to `workspaceId` (the delete cascade). */
  removeByWorkspace(workspaceId: string): number
  /** The rules using a tag, in a condition or an action — the tags store's T-16 / §1.4 checks. */
  refsToTag(tagId: string): TagRuleRef[]
  /** How many rules use a template (T-17). */
  countTemplateRefs(templateId: string): number
  /** The rules using a template, with their scope — the templates store's §1.4 scope check. */
  refsToTemplate(templateId: string): TemplateRuleRef[]
}

const LOG_PREFIX = '[claude-watcher][rules]'
const NOTHING: ScopedLookup = () => null

export function createRulesStore(options: RulesStoreOptions = {}): RulesStore {
  const blobStore = options.blobStore ?? createInMemoryBlobStore<RulesFile>()
  const log = options.log ?? ((message: string): void => console.warn(message))
  const newId = options.newId ?? randomUUID
  const lookupTag = options.lookupTag ?? NOTHING
  const lookupTemplate = options.lookupTemplate ?? NOTHING

  const loaded = loadPersistedOrReset<RulesFile>({
    blobStore,
    parse: (raw) => RulesFileSchema.parse(raw),
    fallback: () => EMPTY_RULES_FILE,
    onProblem: (code) => log(`${LOG_PREFIX} code=rules_${code}`)
  })
  let rules: Rule[] = [...loaded.rules]
  persist()

  function persist(): void {
    try {
      blobStore.write({ version: RULES_FILE_VERSION, rules })
    } catch {
      log(`${LOG_PREFIX} code=rules_write_failed`)
    }
  }

  /** T-11 — a rule may reference only a tag/template its own scope can see. */
  function refProblem(
    target: { workspaceId: string | null } | null,
    ruleWorkspaceId: string | null
  ): RuleProblem | null {
    if (target === null) return RULE_ERROR.refMissing
    if (!inRuleScope(ruleWorkspaceId, target.workspaceId)) return RULE_ERROR.refOutOfScope
    return null
  }

  /** Why one condition could never hold, or null. A `switch` on the discriminant (rather than a
   *  chained ternary) so TS narrows each variant's fields cleanly. */
  function conditionProblem(
    condition: RuleCondition,
    ruleWorkspaceId: string | null
  ): RuleProblem | null {
    switch (condition.kind) {
      case 'has-tag':
      case 'lacks-tag':
        return refProblem(lookupTag(condition.tagId), ruleWorkspaceId)
      case 'template':
        return refProblem(lookupTemplate(condition.templateId), ruleWorkspaceId)
      case 'folder':
      case 'name':
        return patternCompiles(condition) ? null : RULE_ERROR.badPattern
    }
  }

  /** Why a rule could never run, or null. Shared by `save` (refuse) and `view` (report broken). */
  function problem(rule: Pick<Rule, 'workspaceId' | 'conditions' | 'actions'>): RuleProblem | null {
    for (const condition of rule.conditions) {
      const found = conditionProblem(condition, rule.workspaceId)
      if (found !== null) return found
    }
    for (const action of rule.actions) {
      const found = refProblem(lookupTag(action.tagId), rule.workspaceId)
      if (found !== null) return found
    }
    return null
  }

  function list(): Rule[] {
    return [...rules]
  }

  function get(id: string): Rule | null {
    return rules.find((r) => r.id === id) ?? null
  }

  function view(): RulesListResult {
    return { rules: list(), brokenIds: rules.filter((r) => problem(r) !== null).map((r) => r.id) }
  }

  function save(input: RuleSaveRequest): RulesSaveResult {
    const index = input.id === undefined ? -1 : rules.findIndex((r) => r.id === input.id)
    if (input.id !== undefined && index === -1) throw new Error(RULE_ERROR.notFound)
    const found = problem(input)
    if (found !== null) throw new Error(found)
    const saved: Rule = {
      id: input.id ?? newId(),
      name: input.name,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions
    }
    rules = index === -1 ? [...rules, saved] : rules.map((r, i) => (i === index ? saved : r))
    persist()
    return { saved, ...view() }
  }

  function remove(id: string): RulesListResult {
    if (!rules.some((r) => r.id === id)) return view()
    rules = rules.filter((r) => r.id !== id)
    persist()
    return view()
  }

  function move(id: string, toIndex: number): RulesListResult {
    const rule = get(id)
    if (rule === null) throw new Error(RULE_ERROR.notFound)
    const rest = rules.filter((r) => r.id !== id)
    const at = Math.min(toIndex, rest.length)
    rules = [...rest.slice(0, at), rule, ...rest.slice(at)]
    persist()
    return view()
  }

  function removeByWorkspace(workspaceId: string): number {
    const before = rules.length
    rules = rules.filter((r) => r.workspaceId !== workspaceId)
    const removed = before - rules.length
    if (removed > 0) persist()
    return removed
  }

  function refsToTag(tagId: string): TagRuleRef[] {
    return rules
      .filter((r) => ruleUsesTag(r, tagId))
      .map((r) => ({ ruleWorkspaceId: r.workspaceId }))
  }

  function countTemplateRefs(templateId: string): number {
    return rules.filter((r) => ruleUsesTemplate(r, templateId)).length
  }

  function refsToTemplate(templateId: string): TemplateRuleRef[] {
    return rules
      .filter((r) => ruleUsesTemplate(r, templateId))
      .map((r) => ({ ruleWorkspaceId: r.workspaceId }))
  }

  return {
    list,
    get,
    view,
    save,
    remove,
    move,
    removeByWorkspace,
    refsToTag,
    countTemplateRefs,
    refsToTemplate
  }
}
