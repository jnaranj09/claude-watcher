// Rules — the TIME-IN-COLUMN timer owner (spec §2.3). One per window (inside the rules engine),
// with the same injected timer seam as attentionReminders.ts.
//
//   - A timer is armed ONLY on a real column entry, a workspace move, or a rule save. Same-column
//     deltas — more Working hooks, NeedsAttention ↔ NeedsPermission, a rename, a tag change — have
//     NO path to `arm` (T-19): a stream of hooks can never push a timer forward.
//   - Due at max(enteredColumnAt, the rule's last save, the card's last move) + minutes.
//   - It fires ONCE per stay (T-18): firing never re-arms; the next column entry does.
//   - never-crash: nothing throws out of a call or a timer. never-log-the-value: ids + codes only.
import type { Column } from '../../shared/ipc/contract'
import type { Rule } from '../../shared/schemas/rule'
import { rulesInScope, type RulesSnapshot } from './evaluateRules'

const MINUTE_MS = 60_000

/** What the timers need to know about a live card. */
export interface TimedCard {
  workspaceId: string
  column: Column
  enteredColumnAt: number
}

export interface RuleTimersOptions {
  /** Epoch-millis clock — inject for determinism; defaults to Date.now. */
  now?: () => number
  /** Timer seam — a PAIR, used only when both are given (attentionReminders.ts F2). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  getRules: () => RulesSnapshot
  /** The card now, or undefined once it is gone. */
  cardOf: (sessionId: string) => TimedCard | undefined
  /** A time rule came due. The engine re-checks the card and applies the rule. */
  fire: (sessionId: string, ruleId: string) => void
  /** Log sink — id + code ONLY. Defaults to console.warn. */
  log?: (message: string) => void
}

export interface RuleTimers {
  /** A real column entry, or the first sight of a card: cancel its timers, arm one per in-scope
   *  time rule for the column it is in now. */
  onColumnEntry(sessionId: string): void
  /** The card moved workspace: its clock restarts now, for the new workspace's rules (spec §5). */
  onWorkspaceMoved(sessionId: string): void
  /** A rule was saved: re-arm it for every live card, anchored at now (T-13). */
  onRuleSaved(ruleId: string): void
  /** Rules were deleted: cancel every timer whose rule is no longer in the list. */
  onRulesRemoved(): void
  onRemoved(sessionId: string): void
  armedCount(): number
  /** Clear every timer (window teardown). Idempotent. */
  dispose(): void
}

const LOG_PREFIX = '[claude-watcher][rules]'

export function createRuleTimers(options: RuleTimersOptions): RuleTimers {
  const now = options.now ?? Date.now
  const { setTimer, clearTimer } =
    options.setTimer !== undefined && options.clearTimer !== undefined
      ? { setTimer: options.setTimer, clearTimer: options.clearTimer }
      : {
          setTimer: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
          clearTimer: (handle: unknown): void =>
            clearTimeout(handle as ReturnType<typeof setTimeout>)
        }
  const log = options.log ?? ((message: string): void => console.warn(message))

  /** sessionId → ruleId → timer handle. */
  const armed = new Map<string, Map<string, unknown>>()
  /** Every card seen and not yet removed — a rule save re-arms each of them. */
  const cards = new Set<string>()
  const ruleAnchor = new Map<string, number>()
  const moveAnchor = new Map<string, number>()

  function cancel(sessionId: string, keep: (ruleId: string) => boolean = () => false): void {
    const byRule = armed.get(sessionId)
    if (byRule === undefined) return
    for (const [ruleId, handle] of [...byRule]) {
      if (keep(ruleId)) continue
      clearTimer(handle)
      byRule.delete(ruleId)
    }
    if (byRule.size === 0) armed.delete(sessionId)
  }

  function arm(sessionId: string, card: TimedCard, rule: Rule): void {
    const trigger = rule.trigger
    if (trigger.kind !== 'time-in-column' || trigger.column !== card.column) return
    const start = Math.max(
      card.enteredColumnAt,
      ruleAnchor.get(rule.id) ?? 0,
      moveAnchor.get(sessionId) ?? 0
    )
    const delay = Math.max(0, start + trigger.minutes * MINUTE_MS - now())
    const handle = setTimer(() => due(sessionId, rule.id), delay)
    const byRule = armed.get(sessionId) ?? new Map<string, unknown>()
    byRule.set(rule.id, handle)
    armed.set(sessionId, byRule)
  }

  function armAll(sessionId: string): void {
    const card = options.cardOf(sessionId)
    if (card === undefined) return
    const { rules, brokenIds } = options.getRules()
    for (const rule of rulesInScope(rules, card.workspaceId)) {
      if (!brokenIds.has(rule.id)) arm(sessionId, card, rule)
    }
  }

  function due(sessionId: string, ruleId: string): void {
    // Fired: this stay is done for this rule (T-18). Only the next column entry arms it again.
    const byRule = armed.get(sessionId)
    byRule?.delete(ruleId)
    if (byRule?.size === 0) armed.delete(sessionId)
    try {
      options.fire(sessionId, ruleId)
    } catch {
      log(`${LOG_PREFIX} id=${sessionId} code=rule_timer_failed`)
    }
  }

  function guarded(sessionId: string, body: () => void): void {
    try {
      body()
    } catch {
      log(`${LOG_PREFIX} id=${sessionId} code=rule_timer_failed`)
    }
  }

  function onColumnEntry(sessionId: string): void {
    guarded(sessionId, () => {
      cards.add(sessionId)
      cancel(sessionId)
      armAll(sessionId)
    })
  }

  function onWorkspaceMoved(sessionId: string): void {
    guarded(sessionId, () => {
      moveAnchor.set(sessionId, now())
      cancel(sessionId)
      armAll(sessionId)
    })
  }

  function onRuleSaved(ruleId: string): void {
    guarded(ruleId, () => {
      ruleAnchor.set(ruleId, now())
      const { rules, brokenIds } = options.getRules()
      for (const sessionId of [...cards]) {
        const card = options.cardOf(sessionId)
        if (card === undefined) {
          onRemoved(sessionId)
          continue
        }
        cancel(sessionId, (id) => id !== ruleId)
        if (brokenIds.has(ruleId)) continue
        // Scope check delegates to Task 4's own "rules that apply to a card in workspace W"
        // helper (evaluateRules.ts#rulesInScope, itself backed by ruleRefs.ts#inRuleScope) —
        // never re-derive the null-is-global comparison inline here.
        const rule = rulesInScope(rules, card.workspaceId).find((r) => r.id === ruleId)
        if (rule !== undefined) arm(sessionId, card, rule)
      }
    })
  }

  function onRulesRemoved(): void {
    guarded('(rules)', () => {
      const alive = new Set(options.getRules().rules.map((r) => r.id))
      for (const id of [...ruleAnchor.keys()]) if (!alive.has(id)) ruleAnchor.delete(id)
      for (const sessionId of [...armed.keys()]) cancel(sessionId, (ruleId) => alive.has(ruleId))
    })
  }

  function onRemoved(sessionId: string): void {
    cards.delete(sessionId)
    moveAnchor.delete(sessionId)
    cancel(sessionId)
  }

  function armedCount(): number {
    let n = 0
    for (const byRule of armed.values()) n += byRule.size
    return n
  }

  function dispose(): void {
    for (const sessionId of [...armed.keys()]) cancel(sessionId)
    cards.clear()
    moveAnchor.clear()
    ruleAnchor.clear()
  }

  return {
    onColumnEntry,
    onWorkspaceMoved,
    onRuleSaved,
    onRulesRemoved,
    onRemoved,
    armedCount,
    dispose
  }
}
