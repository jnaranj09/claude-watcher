// Story 3.5 (SM-2) — the ONE acknowledge action, two consequences (FROZEN-5).
//
// Story 3.4's `boardStore.acknowledge(id)` clears in-app emphasis (renderer view-state —
// UNCHANGED, stays renderer-owned). Story 3.5 adds the telemetry signal ALONGSIDE it:
// this helper pairs the two calls in ONE place so call sites stay DRY and the pure
// store action does NOT carry an IPC side-effect (state.md: boardStore stays pure
// view-state; no IPC side-effect inside the action). [story 3.5 FROZEN-5]
//
// The renderer passes `acknowledgedAt` as `Date.now()`; MAIN owns the duration math
// (it has `enteredColumnAt` from the Story-1.2 tracker). The telemetry signal is
// fire-and-continue — a rejected invoke (e.g. invalid arg at the MAIN boundary) is
// caught + code-logged; the in-app acknowledge still takes effect. [never-crash]
import { boardStore } from '../stores/boardStore'

/**
 * Acknowledge a session: two consequences fired from ONE call site.
 *  1. `boardStore.acknowledge(id)` — clears in-app emphasis (renderer view-state).
 *  2. `window.telemetry.acknowledge(id, Date.now())` — signals the acknowledge moment
 *     to MAIN for telemetry (MAIN computes the wait duration from the tracker).
 *
 * Do NOT call `boardStore.acknowledge` directly from call sites that should also
 * record telemetry — use this helper instead so the two consequences are always paired.
 * The boardStore action itself is UNCHANGED and stays pure renderer view-state.
 */
export function acknowledgeSession(sessionId: string): void {
  // 1. Clear in-app emphasis (renderer view-state — pure, no IPC).
  boardStore.getState().acknowledge(sessionId)

  // 2. Signal the acknowledge to MAIN for telemetry (the IPC side-effect). Fire-and-continue:
  // the promise is intentionally not awaited (the operator's acknowledge is not blocked on
  // telemetry). A rejection is caught + code-logged (never-crash).
  window.telemetry.acknowledge(sessionId, Date.now()).catch(() => {
    // Code-only log — never log the sessionId value (it is an opaque UUID, but the rule is
    // uniform: Guardrail #6 applies to all external input, and this is a best-effort log).
    console.warn('[c9watch][telemetry] code=telemetry_acknowledge_failed')
  })
}
