// Rules — the per-window ENGINE (spec §2, Approach A). `handleDelta` in src/main/window/watchFeed.ts
// feeds it every reducer delta, with the tracker's column for that id BEFORE and AFTER the tracker saw it.
// The tracker stays the ONLY component that knows columns; the engine reads the edge from it.
//
//   - A real column change re-arms the time rules for the NEW column FIRST, then runs the
//     matching column-change rules. Arming only reads workspaceId/column/enteredColumnAt — never
//     the tags a rule write changes — so if the write throws, the new column is still armed and
//     the old column's timers are still cancelled (never left stale to fire early later, T-19).
//   - A first sighting (a launch, or claude's new id after /clear) only arms the time rules. Launch
//     rules are NOT run here: they ran at spawn (launchTags.ts, T-21).
//   - Same column — including the tag delta this engine itself writes — does nothing (T-3, T-19).
//   - Tags are written through `setTags` (index.ts: reducer.setTags → handleDelta), LAST, so the
//     renderer always receives the status first and the tags second.
//
// Lifetime (spec §2.6, settled while planning): one engine per WINDOW, created and disposed with
// that window's reducer. The reducer — session truth — is per window, so the engine lives exactly as
// long as the sessions it tags.
import type { Column, ReducerWatchEventsPayload } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'
import { sameTagSet } from '../../shared/tags/tagScope'
import { applyRules, subjectOf, type RuleEvent, type RulesSnapshot } from './evaluateRules'
import { createRuleTimers } from './ruleTimers'

export interface RulesEngineOptions {
  getRules: () => RulesSnapshot
  getSession: (id: string) => Session | undefined
  columnOf: (id: string) => Column | undefined
  enteredColumnAt: (id: string) => number | undefined
  /** Write a card's new tag list (index.ts: reducer.setTags(...).forEach(handleDelta)). */
  setTags: (sessionId: string, tagIds: string[]) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Log sink — id + code ONLY. Defaults to console.warn. */
  log?: (message: string) => void
}

export interface RulesEngine {
  /** Called LAST in handleDelta. `before` / `after` are `tracker.columnOf(id)` around the tracker's
   *  own `onDelta` for this delta. Never throws. */
  afterDelta(
    delta: ReducerWatchEventsPayload,
    before: Column | undefined,
    after: Column | undefined
  ): void
  onWorkspaceMoved(sessionId: string): void
  onRuleSaved(ruleId: string): void
  onRulesRemoved(): void
  dispose(): void
}

const LOG_PREFIX = '[claude-watcher][rules]'

export function createRulesEngine(options: RulesEngineOptions): RulesEngine {
  const log = options.log ?? ((message: string): void => console.warn(message))

  const timers = createRuleTimers({
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.setTimer !== undefined ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer !== undefined ? { clearTimer: options.clearTimer } : {}),
    getRules: options.getRules,
    cardOf: (id) => {
      const session = options.getSession(id)
      const column = options.columnOf(id)
      const enteredColumnAt = options.enteredColumnAt(id)
      if (session === undefined || column === undefined || enteredColumnAt === undefined) {
        return undefined
      }
      return { workspaceId: session.workspaceId, column, enteredColumnAt }
    },
    fire,
    log
  })

  /** Run one event's rules against the card as it is NOW and write the result if it changed. */
  function write(sessionId: string, event: RuleEvent): void {
    const session = options.getSession(sessionId)
    if (session === undefined) return
    const next = applyRules(options.getRules(), event, subjectOf(session))
    if (!sameTagSet(next, session.tagIds)) options.setTags(sessionId, next)
  }

  /** A time rule came due. A column change would have cancelled it, so the card is still in the
   *  rule's column — re-checked anyway, then the conditions are read against the CURRENT card
   *  (spec §2.3 step 3). It never re-arms (T-18). */
  function fire(sessionId: string, ruleId: string): void {
    const rule = options.getRules().rules.find((r) => r.id === ruleId)
    if (rule === undefined) return
    const trigger = rule.trigger
    if (trigger.kind !== 'time-in-column' || options.columnOf(sessionId) !== trigger.column) return
    write(sessionId, { kind: 'time-in-column', ruleId })
  }

  function afterDelta(
    delta: ReducerWatchEventsPayload,
    before: Column | undefined,
    after: Column | undefined
  ): void {
    const { event } = delta
    try {
      if (event.type === 'session.removed') {
        timers.onRemoved(event.id)
        return
      }
      if (event.type !== 'session.updated' || after === undefined) return
      if (before === undefined) {
        // First sighting: a launch (its launch rules already ran at spawn) or /clear's new id.
        timers.onColumnEntry(event.id)
        return
      }
      if (before === after) return // same column — no rule, no timer (T-3, T-19)
      // Arm BEFORE the write: arming only reads workspaceId/column/enteredColumnAt (never the
      // tags `write` changes), so if `write` throws below, the new column's time rules are
      // already armed and the old column's are already cancelled — never left stale (T-19).
      timers.onColumnEntry(event.id)
      write(event.id, { kind: 'column-change', from: before, to: after })
    } catch {
      log(`${LOG_PREFIX} id=${event.id} code=rules_failed`)
    }
  }

  return {
    afterDelta,
    onWorkspaceMoved: (sessionId) => timers.onWorkspaceMoved(sessionId),
    onRuleSaved: (ruleId) => timers.onRuleSaved(ruleId),
    onRulesRemoved: () => timers.onRulesRemoved(),
    dispose: () => timers.dispose()
  }
}
