// Story 3.2 (FR-11) — the LAUNCHED-SET, born here (AC: #4; F5).
//
// The launched-set is main's authoritative `Set<string>` of session `id`s the Cockpit
// LAUNCHED — the single source of truth for app-launched-vs-external. It is PER-RUN: it
// lives in memory only, dies with the app (app-launched sessions die with the app —
// FR-13/Epic-4), and is NEVER persisted. It starts EMPTY at construction (never seeded
// from a prior run).
//
// WHEN an id ENTERS the set: a launched session's stable `id` enters the set at mint
// (`launchService.mintSpawn`, at each actual pty spawn), before the synthesized card's first delta
// ships. A launch whose pty never spawns never enters the set (no false membership).
//
// SCOPE BOUNDARY (F1/F5) — Story 3.2 POPULATES this set; it does NOT yet FILTER on it. The
// board+attention app-launched-only filter that CONSUMES `has(id)` is Story 3.3. Until 3.3
// wires that filter at the ship/emit chokepoint, the board still shows ALL sessions. We
// expose `has(id)` + a read-only `snapshot()` so Story 3.3 consumes the set without reshaping
// it; nothing here gates board deltas or attention emission on membership.
//
// App-global (NOT per-window), mirroring the app-global terminal manager (index.ts:91): the
// set keys by the stable session `id` (UUID), which is window-independent. [Source: story 3.2
// Task 4; F5; epics.md Story 3.3 AC line 432; src/main/index.ts:85-96 (app-global precedent)]

/** The launched-set surface. `add` is idempotent (a re-added id is a no-op). `has` is the
 *  membership query Story 3.3 consumes. `snapshot` returns a defensive copy for diagnostics/
 *  consumers (never the live set — callers can't mutate the authority). */
export interface LaunchedSet {
  /** Record a launched session's stable `id` — called at each mint (`mintSpawn`).
   *  Idempotent. */
  add(id: string): void
  /** Whether a session `id` was launched by the Cockpit (the app-launched-vs-external query
   *  Story 3.3 consumes as the board+attention filter). */
  has(id: string): boolean
  /** A defensive copy of the launched ids (diagnostics / tests / a future consumer). */
  snapshot(): ReadonlySet<string>
  /** Current membership count (diagnostics / tests). */
  size(): number
}

/**
 * Build a fresh, EMPTY launched-set (per-run; never seeded). The app constructs ONE app-global
 * instance (index.ts), mirroring the app-global terminal manager. Tests construct an isolated
 * instance per case.
 */
export function createLaunchedSet(): LaunchedSet {
  const ids = new Set<string>()
  return {
    add(id: string): void {
      // A blank id should never reach here (the join keys on a validated session id), but be
      // defensive — never record a blank membership.
      if (id.length === 0) return
      ids.add(id)
    },
    has(id: string): boolean {
      return ids.has(id)
    },
    snapshot(): ReadonlySet<string> {
      return new Set(ids)
    },
    size(): number {
      return ids.size
    }
  }
}
