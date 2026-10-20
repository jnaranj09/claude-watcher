// The planner proposals (spec 2026-10-19 goals, Model): the split a planner session suggested with
// `propose_split`, waiting for the operator's Accept or Reject in the Goals sheet. Memory only (a
// conversation artefact; the tasks are the record), one per planner session: a new
// `propose_split` replaces it. It follows the planner card on `/clear` and goes with it
// (`window/cardState.ts`). The goals store's view reads `list()`, and `onChange` pushes that view.
import type { Proposal } from '../../shared/schemas/goal'

export interface Proposals {
  /** Stores `p` for its planner session, replacing any proposal that session had. */
  set(p: Proposal): void
  get(plannerSessionId: string): Proposal | null
  /** Accept, Reject, or the planner card went away. Nothing stored: nothing announced. */
  clear(plannerSessionId: string): void
  /** `/clear` gave the planner a new id: its proposal now belongs to `newId`. */
  rebind(oldId: string, newId: string): void
  list(): Proposal[]
}

export function createProposals(
  onChange: () => void,
  log: (message: string) => void = (message) => console.warn(message)
): Proposals {
  const byPlanner = new Map<string, Proposal>()

  /** A listener that throws never undoes the change. */
  function announce(): void {
    try {
      onChange()
    } catch {
      log('[claude-watcher][goals] code=proposals_listener_failed')
    }
  }

  return {
    set(p) {
      // Re-inserted, so the newest proposal lists last.
      byPlanner.delete(p.plannerSessionId)
      byPlanner.set(p.plannerSessionId, p)
      announce()
    },
    get(plannerSessionId) {
      return byPlanner.get(plannerSessionId) ?? null
    },
    clear(plannerSessionId) {
      if (byPlanner.delete(plannerSessionId)) announce()
    },
    rebind(oldId, newId) {
      const p = byPlanner.get(oldId)
      if (oldId === newId || p === undefined) return
      byPlanner.delete(oldId)
      byPlanner.set(newId, { ...p, plannerSessionId: newId })
      announce()
    },
    list() {
      return [...byPlanner.values()]
    }
  }
}
