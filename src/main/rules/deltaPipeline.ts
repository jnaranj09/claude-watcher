// Rules — the delta-pipeline ORDER, extracted so it is unit-tested directly. index.ts's
// handleDelta cannot be imported by any test (module-level Electron side effects — see
// launchSynthesis.ts's note on the same limit), so the order this task depends on lives HERE
// instead, and index.ts's handleDelta calls it: this function owns exactly the three steps that
// must happen in this order for the rules engine to see the right edge (spec §2.2):
//
//   1. read the tracker's column for this delta's id BEFORE the tracker sees the delta,
//   2. let the tracker see it (mutates its column map, returns any raised attention events),
//   3. read the column AFTER.
//
// Then it ships the delta (the pre-Phase-2 behavior: reminders, correlate, tray, enrich+send, the
// raisedEvents loop) and ONLY THEN runs the rules engine's afterDelta — so a rule's tag write goes
// out as its OWN, LATER delta, never bundled into the one that just shipped (T-3: no loops).
import type { Column, ReducerWatchEventsPayload } from '../../shared/ipc/contract'

export interface ColumnEdge {
  before: Column | undefined
  after: Column | undefined
}

export interface DeltaPipelineDeps<TRaised> {
  /** tracker.columnOf — read before and after `onTrackerDelta`, only for a `session.updated`
   *  event (removed/raised events carry no column edge). */
  columnOf: (id: string) => Column | undefined
  /** tracker.onDelta(delta, snapshot) — must run BETWEEN the before/after reads. */
  onTrackerDelta: (delta: ReducerWatchEventsPayload) => TRaised
  /** Everything the delta needs to reach the renderer: reminders, correlate, tray, enrich+ship,
   *  the raisedEvents loop. Runs BEFORE the rules engine, and fully returns (including any loop
   *  over raised events) before `afterRules` runs. */
  ship: (raised: TRaised, edge: ColumnEdge) => void
  /** Rules (spec §2.2) — runs LAST, once `ship` has fully returned. */
  afterRules: (edge: ColumnEdge) => void
}

export function runDeltaPipeline<TRaised>(
  delta: ReducerWatchEventsPayload,
  deps: DeltaPipelineDeps<TRaised>
): void {
  const isUpdated = delta.event.type === 'session.updated'
  const before = isUpdated ? deps.columnOf(delta.event.id) : undefined
  const raised = deps.onTrackerDelta(delta)
  const after = isUpdated ? deps.columnOf(delta.event.id) : undefined
  const edge: ColumnEdge = { before, after }
  deps.ship(raised, edge)
  deps.afterRules(edge)
}
