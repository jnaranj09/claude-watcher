// Story 4.2 (FR-14) — the PURE liveness compute for the Quit-guard.
//
// Returns the set of app-launched sessions that are STILL PRESENT in the live
// reducer maps across all windows, with the `Working` subset counted separately.
//
// This is EXACTLY the mirror of `computeBadgeCount` (badge.ts) extended to also
// carry the per-session detail the modal needs:
//   - membership: launched-set ∩ live-reducer-map (SAME single-source as the board)
//   - classification: `columnForStatus` (SAME classifier as the board/badge — never
//     re-enumerate statuses; an unknown status → needs-you = live)
//   - "Working" subset: sessions in the `working` column (agent is actively running).
//     These are the agents that could be killed mid-flight. We name them explicitly
//     so the modal can highlight "N agents are still working." alongside the total.
//
// PURE + TOTAL: no now(), no Electron, no map mutation, no logging — never throws.
// Identity keyed by `id` (NEVER pid; state.md / CLAUDE.md identity rule).
//
// DI-seamed: takes the reducer maps + the launched-set predicate as injected args,
// so unit tests inject fakes without importing Electron (AR-11).
//
// [Source: story 4.2 Task 1.2; ARCH-FORK-1 (option A — app-global reducers map);
//  src/main/kde/badge.ts (launched∩map∩classifier precedent);
//  src/main/c9watch/columns.ts (columnForStatus — REUSE);
//  src/main/pty/launchedSet.ts (has/snapshot — REUSE);
//  .claude/rules/state.md (session truth = main, identity = id)]

import { columnForStatus } from '../c9watch/columns'
import type { Column } from '../../shared/ipc/contract'
import type { Session } from '../../shared/schemas/session'

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** A single live-launched session entry for the Quit-guard modal. */
export interface LiveLaunchedSession {
  /** Stable session id (UUID). Identity key — NEVER pid. */
  id: string
  sessionName: string
  status: string
  column: Column
}

/** The result of the liveness compute. */
export interface LiveLaunchedSessions {
  /** Total live app-launched sessions (launched-set ∩ present). */
  total: number
  /**
   * How many of those are in the `working` column (actively running — agent is
   * doing something; could be killed mid-flight). Highlighted in the modal.
   */
  workingCount: number
  /** Per-session detail for the modal list. */
  sessions: LiveLaunchedSession[]
}

/** Minimal Reducer surface needed by this fn (so tests can inject a trimmed fake). */
export interface ReducerLike {
  snapshotMap(): ReadonlyMap<string, Session>
}

/** DI seam — what main injects. */
export interface ComputeDeps {
  /** Iterator over all live per-window reducer instances. */
  reducers: Iterable<ReducerLike>
  /** Membership predicate — the launched-set. (id) => boolean. */
  isLaunched: (id: string) => boolean
}

// ---------------------------------------------------------------------------
// The pure compute
// ---------------------------------------------------------------------------

/**
 * Compute live app-launched sessions across all windows.
 *
 * Live = launched-set ∩ present in any window's reducer map (a session that
 * exited/was-removed is absent from the map, so it is NOT live). Working subset
 * via `columnForStatus`. Identity keyed by `id`.
 *
 * Pure + total — never throws, never logs a value. [Source: story 4.2 Task 1.2]
 */
export function computeLiveLaunchedSessions(deps: ComputeDeps): LiveLaunchedSessions {
  // Merge maps across all windows into ONE id-keyed view (dedup by id — a session
  // cannot be present in two windows simultaneously, but the merge is safe either way
  // because the same id produces the same session in any window).
  const merged = new Map<string, Session>()
  for (const reducer of deps.reducers) {
    for (const [id, session] of reducer.snapshotMap()) {
      if (!merged.has(id)) merged.set(id, session)
    }
  }

  const sessions: LiveLaunchedSession[] = []
  let workingCount = 0

  for (const session of merged.values()) {
    // Membership: launched-set gate — the SAME source as the board + attention.
    if (!deps.isLaunched(session.id)) continue
    // Classification: SAME classifier the board uses → can never drift.
    const column = columnForStatus(session.status)
    if (column === 'working') workingCount++
    sessions.push({
      id: session.id,
      sessionName: session.sessionName,
      status: session.status,
      column
    })
  }

  return { total: sessions.length, workingCount, sessions }
}
